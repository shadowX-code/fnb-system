-- Staging only: disposable fixture; original business/audit evidence is rolled back.
begin;
select set_config('request.jwt.claim.sub','b6ee4db2-0f37-4b3e-a3ee-fa804ec5e6cd',true);
do $$
declare actor uuid:=payroll_admin_actor(); ent uuid; outlet uuid; emp uuid; profile uuid; run uuid;
 pub uuid; roster uuid; request uuid; leave_id uuid; employees uuid[]:='{}'; i int; day date;
 t payroll_payable_time_versions%rowtype; original jsonb; result jsonb; input jsonb; corrected jsonb;
 policy payroll_paid_holiday_policy_versions%rowtype; snapshot_hash text; leave_hash text; source jsonb; quote jsonb; comp uuid; period uuid; basis jsonb;
begin
 select md5(coalesce(jsonb_agg(to_jsonb(s) order by to_jsonb(s)::text)::text,'')) into snapshot_hash from payroll_run_calculation_snapshots s;
 select md5(coalesce(jsonb_agg(to_jsonb(l) order by l.id)::text,'')) into leave_hash from crew_approved_leaves l;
 insert into legal_entities(legal_company_name,company_registration_no,registered_address,created_by_employee_id,updated_by_employee_id)
 values('QA rollback Payroll projection gaps','QA-'||gen_random_uuid(),'Staging disposable',actor,actor) returning id into ent;
 insert into outlets(name,code,state_code) values('QA rollback projection gaps','QA-'||substr(gen_random_uuid()::text,1,8),'MY-08') returning id into outlet;
 perform set_config('feedx.payroll_command','yes',true);
 insert into payroll_outlet_state_versions(outlet_id,effective_from,state_code) values(outlet,'2026-09-01','MY-08');
 insert into crew_leave_policies(outlet_id,leave_type,annual_days,balance_enforced,entitlement_method,proration_rule)
 values(outlet,'unpaid',0,false,'unlimited','none');
 insert into crew_leave_policy_versions(policy_id,effective_from,eligible_employment_types,entitlement_method,proration_rule,annual_days,balance_enforced,carry_forward_enabled,max_carry_forward_days,source_kind,reason,recorded_by)
 select id,'2026-09-01',array['full_time'],'unlimited','none',0,false,false,0,'admin_change','QA verified terms',auth.uid() from crew_leave_policies where outlet_id=outlet;
 perform payroll_monthly_rule_confirm();
 insert into duty_roster_publications(outlet_id,week_start_date,week_end_date,revision,published_by) values(outlet,'2026-08-31','2026-09-06',1,auth.uid()) returning id into pub;
 for i in 1..3 loop
  insert into employees(full_name,employee_code,legal_entity_id,workplace,position,employment_type,employment_status,joined_date,birthday)
  values('QA rollback projection gaps '||i,'QA-'||substr(gen_random_uuid()::text,1,8),ent,'QA rollback projection gaps','Service Crew','full_time','active','2026-09-01','1990-01-01') returning id into emp;
  employees:=array_append(employees,emp);
  perform employee_employment_assignment_save(emp,'2026-09-01',jsonb_build_object('employment_type','full_time','employment_status','active','position','Service Crew','workplace','QA rollback projection gaps','legal_entity_id',ent),'QA verified employment',null,'QA rollback');
  profile:=payroll_profile_create(emp,'2026-09-01',case when i=3 then 'hourly' else 'monthly' end,case when i=3 then 8 else 1800 end,'MYR','QA compensation',null,outlet,false,false,false,false);
  foreach day in array array['2026-09-01'::date,'2026-09-02'::date] loop
   insert into duty_roster_published_entries(publication_id,outlet_id,employee_id,roster_date,start_time,end_time,break_minutes,entry_type,outlet_name_snapshot,published_at)
   values(pub,outlet,emp,day,'09:00','18:00',60,'working','QA rollback projection gaps',now()) returning id into roster;
   if day='2026-09-02' then
    insert into crew_attendance_records(employee_id,outlet_id,clock_in_at,clock_out_at,clock_in_source,clock_out_source,status,scheduled_roster_entry_id,scheduled_roster_publication_id,scheduled_start_at,scheduled_end_at,scheduled_published_at,scheduled_entry_type)
    values(emp,outlet,(day+'09:00'::time) at time zone 'Asia/Kuala_Lumpur',(day+'18:00'::time) at time zone 'Asia/Kuala_Lumpur','admin','admin','completed',roster,pub,(day+'09:00'::time) at time zone 'Asia/Kuala_Lumpur',(day+'18:00'::time) at time zone 'Asia/Kuala_Lumpur',now(),'working');
   end if;
  end loop;
  if i=2 then
   insert into crew_leave_requests(employee_id,employment_outlet_id,leave_type,start_date,end_date,requested_days,reason,submitted_by,status,reviewed_at,reviewed_by)
   values(emp,outlet,'unpaid','2026-09-01','2026-09-01',1,'QA approved unpaid Leave',emp,'approved',now(),auth.uid()) returning id into request;
   insert into crew_approved_leaves(request_id,employee_id,employment_outlet_id,leave_type,start_date,end_date,duration_type,approved_by)
   values(request,emp,outlet,'unpaid','2026-09-01','2026-09-01','full_day',auth.uid()) returning id into leave_id;
  end if;
 end loop;
 run:=payroll_run_create(ent,'2026-09-01','2026-09-30','QA projection gaps');
 perform payroll_time_reconcile(ent,'2026-09-01','2026-09-30');
 result:=payroll_calculation_project(run,employees[1]);
 assert (result->>'gross_earnings')::numeric=1800,'Unresolved attendance inferred salary deduction';
 select * into t from payroll_payable_time_versions where employee_id=employees[1] and work_date='2026-09-01' order by revision desc limit 1;
 original:=to_jsonb(t);
 input:=jsonb_build_object('request_id',gen_random_uuid(),'run_id',run,'time_version_id',t.id,'correction',false,'action','reject','approved_minutes',0,'extra_minutes',0,'classification','non_payable','reason','QA full-day unpaid absence confirmed');
 corrected:=payroll_time_decision_save(input); perform payroll_time_decision_save(input);
 result:=payroll_calculation_project(run,employees[1]);
 assert result->>'status'='ready',result->'issues';
 assert (result->>'gross_earnings')::numeric=1740,'Unpaid absence did not use 1800 / 30 x 29';
 assert (result->>'non_statutory_deductions')::numeric=0,'Absence deducted twice';
 basis:=result#>'{inputs,monthly_entitlement}';
 assert (basis->>'unpaid_absence_days')::int=1 and (basis->>'unpaid_leave_days')::int=0,'Absence impersonated Leave';
 assert basis->'unpaid_absence_dates'=jsonb_build_array('2026-09-01') and (basis->>'unpaid_absence_reduction')::numeric=60,'Absence evidence missing';
 assert basis#>>'{confirmed_unpaid_absences,0,time_version_id}'=corrected->>'id','Decision not pinned';
 assert not exists(select 1 from crew_approved_leaves where employee_id=employees[1]),'Payroll created Leave';
 assert original=(select to_jsonb(v) from payroll_payable_time_versions v where id=t.id),'Prior decision rewritten';
 assert (select count(*) from payroll_payable_time_versions where employee_id=employees[1] and work_date='2026-09-01')=2,'Retry duplicated decision';
 -- Correction restores normal salary and changes the canonical calculation fingerprint.
 original:=result;
 corrected:=payroll_time_decision_save(input||jsonb_build_object('request_id',gen_random_uuid(),'time_version_id',corrected->>'id','correction',true,'action','adjust','approved_minutes',480,'classification','regular','reason','QA supporting attendance restores normal day'));
 result:=payroll_calculation_project(run,employees[1]);
 assert (result->>'gross_earnings')::numeric=1800 and result->>'status'='ready','Normal Monthly day deduction';
 assert result->>'input_fingerprint' is distinct from original->>'input_fingerprint','Correction did not invalidate calculation';
 assert (select count(*) from payroll_payable_time_versions where employee_id=employees[1] and work_date='2026-09-01')=3,'Correction history lost';
 result:=payroll_calculation_project(run,employees[2]);
 assert (result->>'gross_earnings')::numeric=1740 and (result->>'non_statutory_deductions')::numeric=0,'Leave calendar rule changed';
 basis:=result#>'{inputs,monthly_entitlement}';
 assert (basis->>'unpaid_leave_days')::int=1 and (basis->>'unpaid_absence_days')::int=0,'Leave became absence';
 -- Hourly rejection remains zero, normal approved hours still feed Regular earnings.
 select * into t from payroll_payable_time_versions where employee_id=employees[3] and work_date='2026-09-01' order by revision desc limit 1;
 perform payroll_time_decision_save(input||jsonb_build_object('request_id',gen_random_uuid(),'time_version_id',t.id,'correction',false));
 result:=payroll_calculation_project(run,employees[3]);
 assert (result->>'gross_earnings')::numeric=64 and result->>'status'='ready','Hourly zero/approved-hours regression';
 assert (select sum((x->>'amount')::numeric) from jsonb_array_elements(payroll_earning_groups(result)) x)=(result->>'gross_earnings')::numeric,'Gross aggregation mismatch';
 -- Exact Monthly RM1800 / confirmed 8.50h Company PH preview, no statutory profile.
 select * into policy from payroll_paid_holiday_policy_versions
   where 'f5e7dade-80ce-44fe-8110-80cb1f045b29'::uuid=any(legal_entity_ids) order by revision desc limit 1;
 assert policy.id is not null,'Existing labelled QA published policy missing';
 perform payroll_paid_holiday_policy_save('QA rollback PH projection',policy.calendar_version_id,policy.selected_holiday_ids,array[ent],'{}',null,true,null,gen_random_uuid());
 perform payroll_ph_policy_save(ent,'2026-09-01','additional_pay','QA Company PH default');
 insert into duty_roster_publications(outlet_id,week_start_date,week_end_date,revision,published_by) values(outlet,'2026-09-14','2026-09-20',1,auth.uid()) returning id into pub;
 insert into duty_roster_published_entries(publication_id,outlet_id,employee_id,roster_date,start_time,end_time,break_minutes,entry_type,outlet_name_snapshot,published_at)
 values(pub,outlet,employees[1],'2026-09-16','09:00','17:30',0,'working','QA rollback projection gaps',now());
 perform payroll_time_reconcile(ent,'2026-09-16','2026-09-16');
 quote:=payroll_ph_treatment_preview(jsonb_build_object('run_id',run,'employee_id',employees[1],'date','2026-09-16','treatment_model','unified_v1','decision','adjust','approved_minutes',510,'extra_minutes',0,'treatment','company'));
 assert quote#>>'{pay_preview,determinate}'='true' and (quote#>>'{pay_preview,public_holiday_allowance}')::numeric=69.23,'Canonical 1800 / 26 allowance hidden';
 assert jsonb_array_length(quote->'warnings')>0,'Compliance warning erased';
 input:=jsonb_build_object('request_id',gen_random_uuid(),'run_id',run,'employee_id',employees[1],'date','2026-09-16','treatment_model','unified_v1','decision','adjust','approved_minutes',510,'extra_minutes',0,'treatment','company','reason','QA verified 8.50h attendance','context_fingerprint',quote->>'context_fingerprint','quote_fingerprint',quote->>'quote_fingerprint');
 perform payroll_ph_statutory_confirm(input);
 quote:=payroll_ph_treatment_preview(input||jsonb_build_object('decision','keep_approved'));
 assert quote#>>'{pay_preview,determinate}'='true' and (quote#>>'{pay_preview,public_holiday_allowance}')::numeric=69.23,'Confirmed preview hidden';
 result:=payroll_calculation_project(run,employees[1]);
 assert exists(select 1 from jsonb_array_elements(result->'lines') line where line->>'code'='company_ph_benefit' and (line->>'amount')::numeric=69.23),'Saved earning disagrees with preview';
 -- Missing PH OT evidence affects only OT/total; known Company allowance remains visible.
 quote:=payroll_ph_treatment_preview(input||jsonb_build_object('extra_minutes',30));
 assert quote->'issues' ? 'ph_ot_statutory_evidence_required','OT unexpectedly priced without evidence';
 assert quote#>>'{pay_preview,determinate}'='false' and quote#>>'{pay_preview,allowance_determinate}'='true','Independent allowance unresolved';
 assert (quote#>>'{pay_preview,public_holiday_allowance}')::numeric=69.23 and quote#>>'{pay_preview,ph_ot}' is null and quote#>>'{pay_preview,payroll_change}' is null,'Incomplete OT total looked final';
 -- Reuse the original Sep1 correction command for the source-change control.
 select * into t from payroll_payable_time_versions where employee_id=employees[1] and work_date='2026-09-01' order by revision desc limit 1;
 input:=jsonb_build_object('request_id',gen_random_uuid(),'run_id',run,'time_version_id',t.id,'correction',true,'action','reject','approved_minutes',0,'extra_minutes',0,'classification','non_payable','reason','QA full-day absence correction');
 corrected:=jsonb_build_object('id',t.id);
 -- Genuine source change invalidates an absence, rather than charging against stale evidence.
 select * into t from payroll_payable_time_versions where id=(corrected->>'id')::uuid;
 corrected:=payroll_time_decision_save(input||jsonb_build_object('request_id',gen_random_uuid(),'time_version_id',t.id,'correction',true));
 update duty_roster_published_entries set start_time='10:00' where employee_id=employees[1] and roster_date='2026-09-01';
 result:=payroll_calculation_project(run,employees[1]);
 assert (result#>>'{inputs,monthly_entitlement,payable_basic_salary}')::numeric=1800 and exists(select 1 from jsonb_array_elements_text(result->'issues') issue where issue like 'stale_time_evidence:%'),'Stale absence charged salary';
 -- Private helpers stay private; no finalized evidence is recalculated or rewritten.
 assert not has_function_privilege('authenticated','payroll_monthly_entitlement(uuid,uuid,uuid)','execute'),'Entitlement exposed';
 assert not has_function_privilege('authenticated','payroll_calculation_project(uuid,uuid)','execute'),'Calculation exposed';
 assert snapshot_hash=(select md5(coalesce(jsonb_agg(to_jsonb(s) order by to_jsonb(s)::text)::text,'')) from payroll_run_calculation_snapshots s),'Finalized evidence changed';
 assert leave_hash=(select md5(coalesce(jsonb_agg(to_jsonb(l) order by l.id)::text,'')) from crew_approved_leaves l where employee_id<>employees[2]),'Existing Leave evidence changed';
end $$;
select 'PASS: unpaid absence/Leave/normal/Hourly salary, append-only correction/retry/fingerprint, genuine stale guard, Gross, private grants and finalized evidence' result;
rollback;
