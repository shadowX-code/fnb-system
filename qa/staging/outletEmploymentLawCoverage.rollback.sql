-- Staging only: disposable fixture; original business/audit evidence is rolled back.
begin;
select set_config('request.jwt.claim.sub','b6ee4db2-0f37-4b3e-a3ee-fa804ec5e6cd',true);
do $$
declare actor uuid:=payroll_admin_actor(); ent uuid; outlet uuid; emp uuid; profile uuid; run uuid;
 pub uuid; roster uuid; request uuid; leave_id uuid; employees uuid[]:='{}'; i int; day date;
 t payroll_payable_time_versions%rowtype; original jsonb; result jsonb; input jsonb; corrected jsonb;
 policy payroll_paid_holiday_policy_versions%rowtype; snapshot_hash text; leave_hash text; source jsonb; quote jsonb; comp uuid; period uuid; basis jsonb; groups jsonb; draft jsonb; final jsonb; before_versions jsonb; before_statutory jsonb; evidence jsonb; command_result jsonb; denied boolean; frozen_run uuid; law_id uuid; later_id uuid; corrected_id uuid; law_request uuid; prior_hash text; ph_hash text; hourly_before jsonb; state_outlet uuid;
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
 select id into period from payroll_periods where id=(select period_id from payroll_runs where id=run);
 select v.id into comp from payroll_compensation_versions v join payroll_profiles p on p.id=v.profile_id where p.employee_id=employees[1] order by v.effective_from desc limit 1;
 assert (payroll_monthly_entitlement(employees[1],period,comp)#>>'{basis,unpaid_absence_reduction}')::numeric=60,'Unpaid absence reduction missing';
 groups:=payroll_earning_groups(result);
 assert groups#>>'{0,label}'='Basic Salary' and (groups#>>'{0,amount}')::numeric=1800,'Partial contractual salary omitted';
 assert groups#>>'{1,label}'='Unpaid Absence' and groups#>>'{1,amount}' is null and groups#>>'{1,calculation_state}'='review_required','Unverified adjustment priced or omitted';
 assert payroll_lindung_wages(result->'lines')->>'wage_base' is null,'Contractual presentation became a statutory wage base';
 draft:=payroll_payslip_document('{"employee_name":"QA ONLY Partial Salary"}','2026-09-01','2026-09-30',null,result,'{"net_pay":null,"lines":[]}',true);
 assert draft->>'gross_earnings' is null and draft#>>'{earnings,0,label}'='Basic Salary' and (draft#>>'{earnings,0,amount}')::numeric=1800,'Draft partial evidence / pending Gross lost';


 -- Reproduce Lee's facts without copying any Production records.
 select md5(coalesce(jsonb_agg(to_jsonb(v) order by v.id)::text,'')) into prior_hash from payroll_payable_time_versions v where employee_id=employees[1];
 select md5(coalesce(jsonb_agg(to_jsonb(v) order by v.id)::text,'')) into ph_hash from payroll_public_holidays v;
 hourly_before:=payroll_calculation_project(run,employees[3]);
 law_request:=gen_random_uuid();
 perform set_config('role','authenticated',true);
 later_id:=outlet_employment_law_coverage_confirm(outlet,'2026-10-03','unresolved','QA later evidence','QA preserve later observation',gen_random_uuid(),null);
 law_id:=outlet_employment_law_coverage_confirm(outlet,'2026-09-01','peninsular_labuan','QA verified September legal coverage','QA explicit historical confirmation',law_request,null);
 assert outlet_employment_law_coverage_confirm(outlet,'2026-09-01','peninsular_labuan','QA verified September legal coverage','QA explicit historical confirmation',law_request,null)=law_id,'Retry duplicated evidence';
 assert jsonb_array_length(outlet_employment_law_coverage_read(outlet)->'history')=2,'Audit history missing or duplicated';
 denied:=false;
 begin perform outlet_employment_law_coverage_confirm(outlet,'2026-09-01','sarawak','QA evidence','QA changed payload',law_request,null); exception when invalid_parameter_value then denied:=true; end;
 assert denied,'Reused request accepted changed evidence';
 denied:=false;
 begin perform outlet_employment_law_coverage_confirm(outlet,'2026-09-01','sabah','QA evidence','QA concurrent correction',gen_random_uuid(),null); exception when serialization_failure then denied:=true; end;
 assert denied,'Concurrent revision guard failed';
 perform set_config('role','postgres',true);
 assert outlet_employment_law_coverage_at(outlet,'2026-08-31')->>'coverage'='unresolved','Pre-confirmation coverage inferred';
 assert outlet_employment_law_coverage_at(outlet,'2026-09-01')->>'revision_id'=law_id::text,'Historical law coverage not effective';
 assert outlet_employment_law_coverage_at(outlet,'2026-10-03')->>'revision_id'=later_id::text,'Historical confirmation overwrote later evidence';
 result:=payroll_calculation_project(run,employees[1]);
 assert result->>'status'='ready' and (result->>'gross_earnings')::numeric=1740,'Confirmed unpaid absence did not resolve to 1740';
 assert (payroll_monthly_entitlement(employees[1],period,comp)#>>'{basis,unpaid_absence_reduction}')::numeric=60,'Unpaid absence reduction missing';
 groups:=payroll_earning_groups(result);
 assert exists(select 1 from jsonb_array_elements(groups) x where x->>'label'='Basic Salary' and (x->>'amount')::numeric=1800),'Contractual salary changed';
 assert exists(select 1 from jsonb_array_elements(groups) x where x->>'label'='Unpaid Absence' and (x->>'amount')::numeric=-60),'Separate deduction/reconciliation missing';
 result:=payroll_calculation_project(run,employees[2]);
 assert result->>'status'='ready' and (result->>'gross_earnings')::numeric=1740,'Approved unpaid Leave did not resolve';
 assert payroll_calculation_project(run,employees[3])=hourly_before,'Hourly calculation changed';
 assert (select md5(coalesce(jsonb_agg(to_jsonb(v) order by v.id)::text,'')) from payroll_payable_time_versions v where employee_id=employees[1])=prior_hash,'Time decisions/evidence changed';
 assert not exists(select 1 from payroll_outlet_state_versions where outlet_id=outlet and effective_from<='2026-09-30'),'Historical state was created';
 -- Same-date corrections append, never overwrite; unsupported scopes fail closed.
 perform set_config('role','authenticated',true);
 corrected_id:=outlet_employment_law_coverage_confirm(outlet,'2026-09-01','sabah','QA evidence','QA correction to Sabah',gen_random_uuid(),law_id);
 perform set_config('role','postgres',true);
 assert (select supersedes_id from outlet_employment_law_coverage_versions where id=corrected_id)=law_id,'Correction lineage lost';
 assert payroll_calculation_project(run,employees[1])->'issues' ? 'monthly_proration_jurisdiction_requires_review','Sabah improperly priced';
 perform set_config('role','authenticated',true);
 corrected_id:=outlet_employment_law_coverage_confirm(outlet,'2026-09-01','sarawak','QA evidence','QA correction to Sarawak',gen_random_uuid(),corrected_id);
 perform set_config('role','postgres',true);
 assert payroll_calculation_project(run,employees[1])->'issues' ? 'monthly_proration_jurisdiction_requires_review','Sarawak improperly priced';
 perform set_config('role','authenticated',true);
 corrected_id:=outlet_employment_law_coverage_confirm(outlet,'2026-09-01','unresolved','QA evidence','QA unresolved coverage',gen_random_uuid(),corrected_id);
 perform set_config('role','postgres',true);
 assert payroll_calculation_project(run,employees[1])->'issues' ? 'monthly_proration_jurisdiction_requires_review','Unresolved improperly priced';
 perform set_config('role','authenticated',true);
 corrected_id:=outlet_employment_law_coverage_confirm(outlet,'2026-09-01','peninsular_labuan','QA evidence','QA restore verified scope',gen_random_uuid(),corrected_id);
 perform set_config('role','postgres',true);
 assert (payroll_calculation_project(run,employees[1])->>'gross_earnings')::numeric=1740,'Corrected legal coverage not effective';
 -- Existing dated state is sufficient, with no legal coverage inferred/backfilled.
 insert into outlets(name,code,state_code) values('QA ONLY dated scope control','QA-'||substr(gen_random_uuid()::text,1,8),'MY-08') returning id into state_outlet;
 insert into payroll_outlet_state_versions(outlet_id,state_code,effective_from,actor_employee_id) values(state_outlet,'MY-08','2026-09-01',actor);
 assert outlet_employment_law_coverage_at(state_outlet,'2026-09-01')->>'coverage'='peninsular_labuan','Dated state fallback failed';
 assert not exists(select 1 from outlet_employment_law_coverage_versions where outlet_id=state_outlet),'State evidence backfilled law revisions';
 insert into payroll_outlet_state_versions(outlet_id,state_code,effective_from,actor_employee_id) values(state_outlet,'MY-15','2026-09-15',actor);
 assert outlet_employment_law_coverage_at(state_outlet,'2026-09-15')->>'coverage'='peninsular_labuan','Labuan unsupported';
 insert into payroll_outlet_state_versions(outlet_id,state_code,effective_from,actor_employee_id) values(state_outlet,'MY-12','2026-09-20',actor);
 assert outlet_employment_law_coverage_at(state_outlet,'2026-09-20')->>'coverage'='sabah','State exclusion lost';
 assert not has_function_privilege('authenticated','outlet_employment_law_coverage_at(uuid,date)','execute'),'Private resolver exposed';
 assert not has_table_privilege('authenticated','outlet_employment_law_coverage_versions','insert'),'Direct table insert exposed';
 denied:=false;
 begin update outlet_employment_law_coverage_versions set reason='overwrite' where id=law_id; exception when object_not_in_prerequisite_state then denied:=true; end;
 assert denied,'History was mutable';
 perform set_config('request.jwt.claim.sub','df540974-8945-46b2-8186-8699de24c14c',true);
 denied:=false;
 begin perform outlet_employment_law_coverage_confirm(outlet,'2026-09-01','peninsular_labuan','QA','QA',gen_random_uuid(),corrected_id); exception when insufficient_privilege then denied:=true; end;
 assert denied,'Non-Admin/out-of-scope confirmation accepted';
 denied:=false;
 begin perform outlet_employment_law_coverage_read(outlet); exception when insufficient_privilege then denied:=true; end;
 assert denied,'Non-Admin/out-of-scope history read accepted';
 perform set_config('request.jwt.claim.sub','',true);
 denied:=false;
 begin perform outlet_employment_law_coverage_confirm(outlet,'2026-09-01','peninsular_labuan','QA','QA',gen_random_uuid(),corrected_id); exception when insufficient_privilege then denied:=true; end;
 assert denied,'Anonymous confirmation accepted';
 perform set_config('request.jwt.claim.sub','b6ee4db2-0f37-4b3e-a3ee-fa804ec5e6cd',true);
 assert (select md5(coalesce(jsonb_agg(to_jsonb(s) order by to_jsonb(s)::text)::text,'')) from payroll_run_calculation_snapshots s)=snapshot_hash,'Finalized evidence changed';
 assert (select md5(coalesce(jsonb_agg(to_jsonb(v) order by v.id)::text,'')) from payroll_public_holidays v)=ph_hash,'PH authority/evidence changed';
end $$;
select 'PASS: Lee-style Monthly absence, Leave, Hourly, dated legal coverage/state fallback, exclusions, retry/concurrency, append/audit, frozen evidence' as contract;
rollback;
