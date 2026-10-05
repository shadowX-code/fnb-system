-- Staging only. Disposable synthetic source evidence; every command rolls back.
begin;
select set_config('request.jwt.claim.sub','b6ee4db2-0f37-4b3e-a3ee-fa804ec5e6cd',true);
do $$
declare actor uuid:=payroll_admin_actor(); ent uuid; outlet uuid; emp uuid; profile uuid;
 run uuid; pub uuid; roster uuid; day date; i integer; count_days integer; employees uuid[]:='{}';
 result jsonb; prep jsonb; source jsonb; requirement jsonb; t payroll_payable_time_versions%rowtype;
 request uuid; leave_id uuid; frozen text; before_decisions integer; input jsonb;
begin
 select md5(coalesce(string_agg(to_jsonb(s)::text,'' order by s.run_id,s.employee_id),'')) into frozen from payroll_run_calculation_snapshots s;
 insert into legal_entities(legal_company_name,company_registration_no,registered_address,created_by_employee_id,updated_by_employee_id)
 values('QA rollback monthly time semantics','QA-'||gen_random_uuid(),'Disposable Staging fixture',actor,actor) returning id into ent;
 insert into outlets(name,code,state_code) values('QA rollback monthly time workplace','QA-'||substr(gen_random_uuid()::text,1,8),'MY-08') returning id into outlet;
 perform set_config('feedx.payroll_command','yes',true);
 insert into payroll_outlet_state_versions(outlet_id,effective_from,state_code) values(outlet,'2026-01-01','MY-08');
 -- Explicit disposable historical Leave-policy evidence for this new QA outlet.
 insert into crew_leave_policies(outlet_id,leave_type,annual_days,balance_enforced,entitlement_method,proration_rule)
 values(outlet,'unpaid',0,false,'unlimited','none') on conflict(outlet_id,leave_type) do nothing;
 insert into crew_leave_policy_versions(policy_id,effective_from,eligible_employment_types,entitlement_method,proration_rule,
 annual_days,balance_enforced,carry_forward_enabled,max_carry_forward_days,source_kind,reason,recorded_by)
 select id,'2026-01-01',array['full_time'],'unlimited','none',0,false,false,0,'admin_change','Disposable verified QA terms',auth.uid()
 from crew_leave_policies where outlet_id=outlet and leave_type='unpaid';
 perform payroll_monthly_rule_confirm();
 for i in 1..6 loop
  insert into employees(full_name,employee_code,legal_entity_id,workplace,position,employment_type,employment_status,joined_date,birthday)
  values('QA rollback monthly time '||i,'QA-'||substr(gen_random_uuid()::text,1,8),ent,'QA rollback monthly time workplace','Service Crew','full_time','active',case when i=6 then '2026-01-16'::date else '2026-01-01'::date end,'1990-01-01') returning id into emp;
  employees:=array_append(employees,emp);
  perform employee_employment_assignment_save(emp,case when i=6 then '2026-01-16'::date else '2026-01-01'::date end,jsonb_build_object('employment_type','full_time','employment_status','active','position','Service Crew','workplace','QA rollback monthly time workplace','legal_entity_id',ent),'Disposable verified employment',null,'QA rollback');
  profile:=payroll_profile_create(emp,case when i=6 then '2026-01-16'::date else '2026-01-01'::date end,case when i=4 then 'hourly' else 'monthly' end,case when i=4 then 8 else 3100 end,'MYR','Disposable verified compensation',null,outlet,false,false,false,false);
  count_days:=case i when 3 then 25 when 4 then 2 when 5 then 1 when 6 then 0 else 26 end;
  for day in select generate_series('2026-01-05'::date,'2026-01-05'::date+count_days-1,interval '1 day')::date loop
   select id into pub from duty_roster_publications where outlet_id=outlet and week_start_date=date_trunc('week',day)::date;
   if pub is null then
    insert into duty_roster_publications(outlet_id,week_start_date,week_end_date,revision,published_by)
    values(outlet,date_trunc('week',day)::date,date_trunc('week',day)::date+6,1,auth.uid()) returning id into pub;
   end if;
   insert into duty_roster_published_entries(publication_id,outlet_id,employee_id,roster_date,start_time,end_time,break_minutes,entry_type,outlet_name_snapshot,published_at)
   values(pub,outlet,emp,day,'09:00','18:00',60,'working','QA rollback monthly time workplace',now()) returning id into roster;
   if i in (1,4) then
    insert into crew_attendance_records(employee_id,outlet_id,clock_in_at,clock_out_at,clock_in_source,clock_out_source,status,scheduled_roster_entry_id,scheduled_roster_publication_id,scheduled_start_at,scheduled_end_at,scheduled_published_at,scheduled_entry_type)
    values(emp,outlet,(day+'09:00'::time) at time zone 'Asia/Kuala_Lumpur',(day+'18:00'::time) at time zone 'Asia/Kuala_Lumpur','admin','admin','completed',roster,pub,(day+'09:00'::time) at time zone 'Asia/Kuala_Lumpur',(day+'18:00'::time) at time zone 'Asia/Kuala_Lumpur',now(),'working');
   end if;
  end loop;
  if i=5 then
   insert into crew_leave_requests(employee_id,employment_outlet_id,leave_type,start_date,end_date,requested_days,reason,submitted_by,status,reviewed_at,reviewed_by)
   values(emp,outlet,'unpaid','2026-01-05','2026-01-05',1,'Disposable approved unpaid leave',emp,'approved',now(),auth.uid()) returning id into request;
   insert into crew_approved_leaves(request_id,employee_id,employment_outlet_id,leave_type,start_date,end_date,duration_type,approved_by)
   values(request,emp,outlet,'unpaid','2026-01-05','2026-01-05','full_day',auth.uid()) returning id into leave_id;
  end if;
 end loop;
 run:=payroll_run_create(ent,'2026-01-01','2026-01-31','Disposable exception-driven review');
 -- No daily reconciliation or approval is needed for complete Monthly attendance.
 result:=payroll_calculation_project(run,employees[1]);
 assert result->>'status'='ready',result->'issues';
 assert (result->>'gross_earnings')::numeric=3100,'Monthly salary changed';
 assert not exists(select 1 from jsonb_array_elements(result->'time_review') d where (d->>'required')::boolean),'Normal Monthly attendance required hours approval';
 assert not exists(select 1 from payroll_payable_time_versions where employee_id=employees[1]),'Read created time history';
 -- Verified partial employment automatically uses the existing calendar-day authority.
 result:=payroll_calculation_project(run,employees[6]);
 assert result->>'status'='ready',result->'issues';
 assert (result->>'gross_earnings')::numeric=1600,'Partial employment pricing changed';
 -- Reproduce the shown 26/25 missing-punch pattern truthfully: still unresolved.
 result:=payroll_calculation_project(run,employees[2]);
 assert (select count(*) from jsonb_array_elements(result->'time_review') d where d->>'state'='unreconciled')=26,'Missing attendance inferred';
 result:=payroll_calculation_project(run,employees[3]);
 assert (select count(*) from jsonb_array_elements(result->'time_review') d where d->>'state'='unreconciled')=25,'Missing attendance inferred';
 -- Hourly complete source still requires approved payable-hours evidence.
 result:=payroll_calculation_project(run,employees[4]);
 assert exists(select 1 from jsonb_array_elements_text(result->'issues') issue where issue like 'unreconciled_time:%'),'Hourly authority bypassed';
 -- Approved full-day unpaid Leave reduces Monthly Basic once, without daily review.
 result:=payroll_calculation_project(run,employees[5]);
 assert result->>'status'='ready',result->'issues';
 assert (result->>'gross_earnings')::numeric=3000 and (result->>'non_statutory_deductions')::numeric=0,'Approved unpaid Leave double-counted';
 assert not exists(select 1 from jsonb_array_elements(result->'time_review') d where (d->>'required')::boolean),'Approved leave needs redundant decision';
 perform payroll_time_reconcile(ent,'2026-01-01','2026-01-31');
 result:=payroll_calculation_project(run,employees[4]);
 assert result->>'status'='ready' and (result->>'gross_earnings')::numeric=128,'Hourly auto-approved hours regression';
 prep:=payroll_run_preparation_read(run);
 assert (select (m->>'time_exception_count')::int from jsonb_array_elements(prep->'results') m where m->>'employee_id'=employees[2]::text)=26,'Monthly missing-punch count';
 assert (select (m->>'time_exception_count')::int from jsonb_array_elements(prep->'results') m where m->>'employee_id'=employees[3]::text)=25,'Monthly missing-punch count';
 -- Explicit authorized absence confirmation remains append-only and fast.
 select * into t from payroll_payable_time_versions where employee_id=employees[2] and work_date='2026-01-05' order by revision desc limit 1;
 before_decisions:=(select count(*) from payroll_payable_time_versions where employee_id=employees[2]);
 input:=jsonb_build_object('request_id',gen_random_uuid(),'run_id',run,'time_version_id',t.id,'correction',false,'action','adjust','approved_minutes',480,'extra_minutes',0,'classification','regular','reason','QA attendance confirmed from independent evidence');
 result:=payroll_time_decision_save(input); perform payroll_time_decision_save(input);
 assert (select count(*) from payroll_payable_time_versions where employee_id=employees[2])=before_decisions+1,'Retry duplicated decision';
 assert result#>>'{row,review_state,state}'='ready','Save/read-back state';
 assert exists(select 1 from payroll_payable_time_versions where id=t.id and status='review_required'),'Prior evidence rewritten';
 -- Real source-reconciliation command on a disposable Monthly day remains explicit.
 select * into t from payroll_payable_time_versions where employee_id=employees[1] and work_date='2026-01-05' order by revision desc limit 1;
 result:=payroll_time_decision_save(jsonb_build_object('request_id',gen_random_uuid(),'run_id',run,'time_version_id',t.id,'correction',true,'action','adjust','approved_minutes',480,'extra_minutes',0,'classification','regular','reason','Disposable explicit attendance confirmation'));
 select * into t from payroll_payable_time_versions where id=(result->>'id')::uuid;
 update crew_attendance_records set clock_out_at=clock_out_at+interval '5 minutes' where employee_id=employees[1] and scheduled_start_at='2026-01-05 09:00+08';
 source:=payroll_time_evidence(employees[1],'2026-01-05');
 assert jsonb_array_length(source->'issue_codes')=0,'Control should remain otherwise complete';
 assert payroll_time_requirement(source,to_jsonb(t))->>'state'='source_updated','Manual decision accepted changed Attendance';
 result:=payroll_time_source_reconcile(run,t.id,source->>'source_fingerprint');
 assert result#>>'{row,status}'='review_required','Reconciliation approved time';
 result:=payroll_time_requirement(source,result->'row');
 assert result->>'state'='review_required','Reconciliation bypassed explicit correction';
 result:=payroll_time_decision_save(input); -- original request remains retry-safe
 -- Same clean source becoming stale underneath an explicit decision still requires review.
 source:=t.evidence||jsonb_build_object('source_fingerprint','changed');
 requirement:=payroll_time_requirement(source,result->'row');
 assert requirement->>'state'='source_updated','Genuine source protection bypassed';
 -- Reconciliation is not approval, even if the new Monthly evidence is clean.
 source:=payroll_time_evidence(employees[1],'2026-01-05');
 requirement:=payroll_time_requirement(source,jsonb_build_object('id',gen_random_uuid(),'status','review_required','source_fingerprint',source->>'source_fingerprint','decision_reason','Source updated; explicit decision required'));
 assert requirement->>'state'='review_required','Reconciliation auto-approved a pending correction';
 -- PH is not a generic time exception even when missing punches remain unresolved.
 source:=source||jsonb_build_object('classification','public_holiday','paid_holiday_policy',jsonb_build_object('status','paid_holiday'));
 assert payroll_time_requirement(source,result->'row')->>'state'='ph_review','PH duplicate review';
 -- OT/short hours/conflicts remain decisions; unsupported leave units remain pricing blockers.
 source:=payroll_time_evidence(employees[1],'2026-01-05')||jsonb_build_object('issue_codes',jsonb_build_array('extra_time'),'extra_candidate_minutes',60);
 assert (payroll_time_requirement(source,null)->>'required')::boolean,'OT inferred';
 source:=source||jsonb_build_object('issue_codes',jsonb_build_array('early_departure'));
 assert (payroll_time_requirement(source,null)->>'required')::boolean,'Pay-impacting short time ignored';
 update crew_approved_leaves set duration_type='half_day',half_day_period='am' where id=leave_id;
 result:=payroll_calculation_project(run,employees[5]);
 assert result->'issues' ? 'unpaid_half_day_policy_required','Unsupported leave unit inferred';
 assert frozen=(select md5(coalesce(string_agg(to_jsonb(s)::text,'' order by s.run_id,s.employee_id),'')) from payroll_run_calculation_snapshots s),'Frozen evidence changed';
 assert not has_function_privilege('authenticated','payroll_time_requirement(jsonb,jsonb)','execute'),'Private helper exposed';
end $$;
select 'PASS: Monthly clean/26+25 missing punches/unpaid Leave, Hourly approval, PH separation, fast save/retry/history, OT/short-time/unsupported units, frozen evidence' result;
rollback;
