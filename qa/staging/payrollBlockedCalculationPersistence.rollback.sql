-- Staging only: disposable fixture; original business/audit evidence is rolled back.
begin;
select set_config('request.jwt.claim.sub','b6ee4db2-0f37-4b3e-a3ee-fa804ec5e6cd',true);
do $$
declare actor uuid:=payroll_admin_actor(); ent uuid; outlet uuid; emp uuid; profile uuid; run uuid;
 pub uuid; roster uuid; request uuid; leave_id uuid; employees uuid[]:='{}'; i int; day date;
 t payroll_payable_time_versions%rowtype; original jsonb; result jsonb; input jsonb; corrected jsonb;
 policy payroll_paid_holiday_policy_versions%rowtype; snapshot_hash text; leave_hash text; source jsonb; quote jsonb; comp uuid; period uuid; basis jsonb; groups jsonb; draft jsonb; final jsonb; before_versions jsonb; before_statutory jsonb; evidence jsonb; command_result jsonb; denied boolean; frozen_run uuid;
begin
 select md5(coalesce(jsonb_agg(to_jsonb(s) order by to_jsonb(s)::text)::text,'')) into snapshot_hash from payroll_run_calculation_snapshots s;
 select md5(coalesce(jsonb_agg(to_jsonb(l) order by l.id)::text,'')) into leave_hash from crew_approved_leaves l;
 insert into legal_entities(legal_company_name,company_registration_no,registered_address,created_by_employee_id,updated_by_employee_id)
 values('QA rollback Payroll projection gaps','QA-'||gen_random_uuid(),'Staging disposable',actor,actor) returning id into ent;
 insert into outlets(name,code,state_code) values('QA rollback projection gaps','QA-'||substr(gen_random_uuid()::text,1,8),'MY-08') returning id into outlet;
 perform set_config('feedx.payroll_command','yes',true);

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
 assert (result->>'gross_earnings')::numeric=1800,'Clean full-month salary changed before an unpaid decision exists';
 perform payroll_run_calculate_core(run,employees[1]);
 select jsonb_agg(to_jsonb(c) order by revision) into before_versions from payroll_run_calculation_versions c where run_id=run and employee_id=employees[1];
 select coalesce(jsonb_agg(to_jsonb(s) order by revision),'[]') into before_statutory from payroll_run_statutory_versions s where run_id=run and employee_id=employees[1];
 select * into t from payroll_payable_time_versions where employee_id=employees[1] and work_date='2026-09-01' order by revision desc limit 1;
 original:=to_jsonb(t);
 input:=jsonb_build_object('request_id',gen_random_uuid(),'run_id',run,'time_version_id',t.id,'correction',false,'action','reject','approved_minutes',0,'extra_minutes',0,'classification','non_payable','reason','QA full-day unpaid absence confirmed');
 corrected:=payroll_time_decision_save(input); perform payroll_time_decision_save(input);
 result:=payroll_calculation_project(run,employees[1]);
 -- This disposable fixture starts without verified statutory geography, reproducing Lee's blocker.
 -- No existing geography/evidence is changed or deleted.
 result:=payroll_calculation_project(run,employees[1]);
 assert result->>'status'='review_required' and result->'issues' ? 'monthly_proration_jurisdiction_requires_review','Missing geography must remain blocking';
 assert result->>'gross_earnings' is null and result#>>'{lines,0,amount}' is null,'Unverified net salary priced';
 assert (result#>>'{lines,0,contractual_amount}')::numeric=1800,'Canonical contractual salary evidence missing';
 groups:=payroll_earning_groups(result);
 assert groups#>>'{0,label}'='Basic Salary' and (groups#>>'{0,amount}')::numeric=1800,'Partial contractual salary omitted';
 assert groups#>>'{1,label}'='Unpaid Absence' and groups#>>'{1,amount}' is null and groups#>>'{1,calculation_state}'='review_required','Unverified adjustment priced or omitted';
 assert payroll_lindung_wages(result->'lines')->>'wage_base' is null,'Contractual presentation became a statutory wage base';
 draft:=payroll_payslip_document('{"employee_name":"QA ONLY Partial Salary"}','2026-09-01','2026-09-30',null,result,'{"net_pay":null,"lines":[]}',true);
 assert draft->>'gross_earnings' is null and draft#>>'{earnings,0,label}'='Basic Salary' and (draft#>>'{earnings,0,amount}')::numeric=1800,'Draft partial evidence / pending Gross lost';

 -- The actual authenticated command succeeds twice; no invalid versions/audits are appended.
 perform set_config('role','authenticated',true);
 command_result:=payroll_employee_recalculate(run,employees[1]);
 assert command_result#>>'{calculation,blocked}'='1' and command_result#>>'{calculation,created}'='0','Blocked calculation attempted persistence';
 assert command_result#>>'{statutory,blocked}'='1','Old wages were reused for statutory calculation';
 command_result:=payroll_employee_recalculate(run,employees[1]);
 evidence:=payroll_run_evidence_read(run);
 assert (select value->>'persistence_state' from jsonb_array_elements(evidence#>'{calculation,results}') where value->>'employee_id'=employees[1]::text)='blocked','Blocked current evidence missing';
 assert (select value->>'is_stale' from jsonb_array_elements(evidence#>'{calculation,results}') where value->>'employee_id'=employees[1]::text)='false','Settled evidence is falsely updating';
 assert (select value#>>'{earning_groups,0,amount}' from jsonb_array_elements(evidence#>'{calculation,results}') where value->>'employee_id'=employees[1]::text)='1800.00','Known salary lost';
 assert (select value->>'gross_earnings' from jsonb_array_elements(evidence#>'{calculation,results}') where value->>'employee_id'=employees[1]::text) is null,'Old Gross leaked';
 assert (select value->>'net_pay' from jsonb_array_elements(evidence#>'{statutory,results}') where value->>'employee_id'=employees[1]::text) is null,'Old statutory Net leaked';
 assert (select value->>'persistence_state' from jsonb_array_elements(evidence#>'{calculation,results}') where value->>'employee_id'=employees[2]::text)='blocked','Blocked employee without a prior version omitted';
 assert (payroll_run_calculation_read(run)->'results')=(evidence#>'{calculation,results}'),'Legacy read differs';
 assert (payroll_run_statutory_read(run)->'results')=(evidence#>'{statutory,results}'),'Legacy statutory read differs';
 assert payroll_run_calculation_readiness(run)->>'ready'='false','Finalize earnings gate weakened';
 assert payroll_run_statutory_readiness(run)->>'ready'='false','Finalize statutory gate weakened';
 perform set_config('role','postgres',true);
 assert not has_function_privilege('authenticated','payroll_calculation_has_totals(jsonb)','execute'),'Private predicate exposed';
 assert not payroll_calculation_has_totals('{"gross_earnings":1}'),'Missing required totals accepted';
 denied:=false;
 begin perform payroll_employee_recalculate(run,gen_random_uuid()); exception when insufficient_privilege then denied:=true; end;
 assert denied,'Run membership guard weakened';
 select id into frozen_run from payroll_runs where status in ('finalized','paid') limit 1;
 if frozen_run is not null then
  denied:=false;
  begin perform payroll_run_calculate(frozen_run); exception when object_not_in_prerequisite_state then denied:=true; end;
  assert denied,'Finalized recalculation accepted';
 end if;
 assert (select jsonb_agg(to_jsonb(c) order by revision) from payroll_run_calculation_versions c where run_id=run and employee_id=employees[1])=before_versions,'Valid versions changed';
 assert (select coalesce(jsonb_agg(to_jsonb(s) order by revision),'[]') from payroll_run_statutory_versions s where run_id=run and employee_id=employees[1])=before_statutory,'Statutory versions changed';
 -- Only the disposable fixture gains explicit dated geography; the Leave employee becomes resolvable.
 insert into payroll_outlet_state_versions(outlet_id,state_code,effective_from,actor_employee_id) values(outlet,'MY-08','2026-09-01',actor);
 perform payroll_time_reconcile(ent,'2026-09-01','2026-09-30');
 result:=payroll_calculation_project(run,employees[2]);
 assert result->>'status'='ready' and (result->>'gross_earnings')::numeric=1740,'Normal resolved calculation regression';
 perform set_config('role','authenticated',true);
 command_result:=payroll_employee_recalculate(run,employees[2]);
 assert command_result#>>'{calculation,created}'='1','Resolved version not persisted';
 command_result:=payroll_employee_recalculate(run,employees[2]);
 assert command_result#>>'{calculation,unchanged}'='1','Retry duplicated resolved history';
 perform set_config('role','postgres',true);
 assert (select gross_earnings from payroll_run_calculation_versions where run_id=run and employee_id=employees[2] order by revision desc limit 1)=1740,'Persisted Gross differs';
 assert (select md5(coalesce(jsonb_agg(to_jsonb(s) order by to_jsonb(s)::text)::text,'')) from payroll_run_calculation_snapshots s)=snapshot_hash,'Finalized snapshots changed';
end $$;
select 'PASS: blocked authenticated Retry, current evidence/readiness, prior versions preserved, resolved append/retry, frozen snapshots' as contract;
rollback;
