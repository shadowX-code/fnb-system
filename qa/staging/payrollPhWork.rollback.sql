-- Isolated source setup; every change rolls back. No real employee/source data.
begin;
select set_config('request.jwt.claim.sub','b6ee4db2-0f37-4b3e-a3ee-fa804ec5e6cd',true);
do $$
#variable_conflict use_variable
declare actor uuid:=public.payroll_admin_actor(); entity_id uuid; outlet_id uuid; employee_id uuid;
 monthly_id uuid; hourly_id uuid; profile_id uuid; run_id uuid; holiday_id uuid; calendar_id uuid;
 publication_id uuid; roster_id uuid; time_id uuid; result jsonb; projected jsonb; decision_id uuid;
 request_id uuid; request_leave uuid; entitlement_id uuid; original text; snapshot_hash text; corrected uuid;
 i integer; prior_calendar uuid; policy_id uuid;
begin
 insert into public.legal_entities(legal_company_name,company_registration_no,registered_address,created_by_employee_id,updated_by_employee_id)
 values('QA rollback PH company','QA-'||gen_random_uuid(),'Rollback only',actor,actor) returning id into entity_id;
 insert into public.outlets(name,code,state_code) values('QA rollback PH workplace','QA-'||substr(gen_random_uuid()::text,1,8),'MY-08') returning id into outlet_id;
 insert into public.payroll_outlet_state_versions(outlet_id,effective_from,state_code) values(outlet_id,'2026-01-01','MY-08');
 holiday_id:=public.payroll_holiday_save('2026-08-31','QA ONLY rollback PH','national','User-approved synthetic QA source; not an official annual calendar');
 select id into prior_calendar from public.payroll_holiday_calendar_versions where year=2026 order by revision desc limit 1;
 calendar_id:=public.payroll_holiday_calendar_save(2026,jsonb_build_array(jsonb_build_object('holiday_id',holiday_id,'kind','required','source_reference','QA ONLY synthetic source')),
 'QA ONLY approved synthetic calendar',true,true,prior_calendar,gen_random_uuid());
 perform public.payroll_paid_holiday_policy_save('QA ONLY paid holiday policy',calendar_id,array[holiday_id],array[entity_id],'{}',null,true,null,gen_random_uuid());
 policy_id:=public.payroll_ph_policy_save(entity_id,'2026-01-01','additional_pay','Rollback QA company benefit');
 for i in 1..2 loop
  insert into public.employees(full_name,employee_code,legal_entity_id,workplace,joined_date,birthday)
  values('QA rollback PH '||i,'QA-'||substr(gen_random_uuid()::text,1,8),entity_id,'QA rollback PH workplace','2026-01-01','1990-01-01') returning id into employee_id;
  if i=1 then monthly_id:=employee_id; else hourly_id:=employee_id; end if;
  result:=public.payroll_initial_setup_read(employee_id,'2026-01-01','{"epf":true,"socso":true,"eis":true,"pcb":false}');
  result:=public.payroll_initial_setup_confirm(employee_id,'2026-01-01',case i when 1 then 'monthly' else 'hourly' end,
   case i when 1 then 2600 else 15 end,'MYR','{"epf":true,"socso":true,"eis":true,"pcb":false}',result->>'fingerprint');
 end loop;
 run_id:=public.payroll_run_create(entity_id,'2026-08-01','2026-08-31','Rollback PH lifecycle');
 insert into public.duty_roster_publications(outlet_id,week_start_date,week_end_date,revision,published_by)
 values(outlet_id,'2026-08-31','2026-09-06',1,auth.uid()) returning id into publication_id;
 foreach employee_id in array array[monthly_id,hourly_id] loop
  insert into public.duty_roster_published_entries(publication_id,outlet_id,employee_id,roster_date,start_time,end_time,break_minutes,entry_type,outlet_name_snapshot,published_at)
  values(publication_id,outlet_id,employee_id,'2026-08-31','09:00','15:00',60,'working','QA rollback PH workplace',now()) returning id into roster_id;
  insert into public.crew_attendance_records(employee_id,outlet_id,clock_in_at,clock_out_at,clock_in_source,clock_out_source,status,
   scheduled_roster_entry_id,scheduled_roster_publication_id,scheduled_start_at,scheduled_end_at,scheduled_published_at,scheduled_entry_type)
  values(employee_id,outlet_id,'2026-08-31 09:00+08','2026-08-31 15:00+08','admin','admin','completed',
   roster_id,publication_id,'2026-08-31 09:00+08','2026-08-31 15:00+08',now(),'working');
 end loop;
 select md5(jsonb_build_array((select jsonb_agg(to_jsonb(e)) from public.duty_roster_published_entries e where e.publication_id=publication_id),
  (select jsonb_agg(to_jsonb(a)) from public.crew_attendance_records a where a.employee_id in (monthly_id,hourly_id)))::text) into original;
 perform public.payroll_time_reconcile(entity_id,'2026-08-31','2026-08-31');
 foreach employee_id in array array[monthly_id,hourly_id] loop
  select id into time_id from public.payroll_payable_time_versions t where t.employee_id=employee_id order by revision desc limit 1;
  perform public.payroll_time_decide(time_id,'approve',300,0,'public_holiday','QA confirmed five payable PH hours');
  projected:=public.payroll_ph_work_project(run_id,employee_id,'2026-08-31');
  if projected is null or projected->>'issue'<>'ph_treatment_confirmation_required' then raise exception 'PH work projection: %',projected; end if;
  if (projected->>'additional_amount')::numeric<>(case when employee_id=monthly_id then 100 else 75 end) then raise exception 'Company formula incorrect: %',projected; end if;
  request_id:=gen_random_uuid();
  decision_id:=public.payroll_ph_work_confirm(run_id,employee_id,'2026-08-31','additional_pay',projected->>'source_fingerprint',request_id,null);
  if decision_id<>public.payroll_ph_work_confirm(run_id,employee_id,'2026-08-31','additional_pay',projected->>'source_fingerprint',request_id,null) then raise exception 'Retry duplicated decision'; end if;
  if (select count(*) from public.payroll_events where details->>'decision_id'=decision_id::text)<>1 then raise exception 'Audit duplicate'; end if;
  result:=public.payroll_calculation_project(run_id,employee_id);
  if result->>'status'<>'ready' or (result->>'gross_earnings')::numeric<>(case when employee_id=monthly_id then 2700 else 150 end) then raise exception 'PH calculation incorrect: %',result; end if;
  result:=public.payroll_statutory_project(run_id,employee_id);
  if result->>'status'<>'ready' then raise exception 'PH statutory unresolved: %',result; end if;
  if exists(select 1 from jsonb_array_elements(result->'lines') l where l->>'scheme'='epf' and
   (l->>'wage_base')::numeric<>(case when employee_id=monthly_id then 2600 else 75 end)) then raise exception 'EPF company benefit double counted: %',result; end if;
  if exists(select 1 from jsonb_array_elements(result->'lines') l where l->>'scheme' in ('socso','eis') and
   (l->>'wage_base')::numeric<>(case when employee_id=monthly_id then 2700 else 150 end)) then raise exception 'PERKESO PH wage base incorrect: %',result; end if;
 end loop;
 if public.payroll_ph_work_project(run_id,monthly_id,'2026-08-30') is not null then raise exception 'Non-worked/non-PH treatment created'; end if;
 projected:=public.payroll_ph_work_project(run_id,monthly_id,'2026-08-31');
 perform public.payroll_ph_work_confirm(run_id,monthly_id,'2026-08-31','replacement_leave',projected->>'source_fingerprint',gen_random_uuid(),null);
 select g.entitlement_id into entitlement_id from public.crew_replacement_leave_grants g where g.employee_id=monthly_id;
 if (public.crew_leave_entitlement_balance(entitlement_id,'2026-09-01')->>'available')::numeric<>1 then raise exception 'Replacement grant missing'; end if;
 if (public.payroll_calculation_project(run_id,monthly_id)->>'gross_earnings')::numeric<>2600 then raise exception 'Leave retained additional pay'; end if;
 projected:=public.payroll_ph_work_project(run_id,monthly_id,'2026-08-31');
 perform public.payroll_ph_work_confirm(run_id,monthly_id,'2026-08-31','additional_pay',projected->>'source_fingerprint',gen_random_uuid(),null);
 if (public.crew_leave_entitlement_balance(entitlement_id,'2026-09-01')->>'available')::numeric<>0 then raise exception 'Switch did not revoke Leave'; end if;
 projected:=public.payroll_ph_work_project(run_id,monthly_id,'2026-08-31');
 perform public.payroll_ph_work_confirm(run_id,monthly_id,'2026-08-31','replacement_leave',projected->>'source_fingerprint',gen_random_uuid(),null);
 -- Request source fixture; actual approval, consumption and audit use canonical
 -- Leave review. No opaque Crew credentials or existing access records change.
 insert into public.crew_leave_requests(employee_id,employment_outlet_id,leave_type,start_date,end_date,requested_days,reason,submitted_by)
 values(monthly_id,outlet_id,'replacement','2026-09-01','2026-09-01',1,'QA replacement consumption',monthly_id) returning id into request_leave;
 perform public.crew_leave_review(request_leave,'approve',null);
 projected:=public.payroll_ph_work_project(run_id,monthly_id,'2026-08-31');
 begin
  perform public.payroll_ph_work_confirm(run_id,monthly_id,'2026-08-31','additional_pay',projected->>'source_fingerprint',gen_random_uuid(),null);
  raise exception 'Consumed Leave switched unsafely';
 exception when object_not_in_prerequisite_state then null; end;
 if (public.crew_leave_entitlement_balance(entitlement_id,'2027-01-01')->>'entitled')::numeric<>0 then raise exception 'Replacement Leave carried forward'; end if;
 perform public.payroll_run_transition(run_id,'review_required','QA review');
 perform public.payroll_run_transition(run_id,'ready','QA ready');
 perform public.payroll_run_transition(run_id,'finalized','QA immutable benefit');
 select md5(calculation::text) into snapshot_hash from public.payroll_run_calculation_snapshots where payroll_run_calculation_snapshots.run_id=run_id and payroll_run_calculation_snapshots.employee_id=monthly_id;
 if public.payroll_ph_work_read(run_id,monthly_id)->0->'decision'->>'treatment'<>'replacement_leave' then raise exception 'Frozen treatment missing'; end if;
 begin
  perform public.payroll_ph_work_confirm(run_id,monthly_id,'2026-08-31','additional_pay',projected->>'source_fingerprint',gen_random_uuid(),null);
  raise exception 'Finalized treatment changed';
 exception when object_not_in_prerequisite_state then null; end;
 if original<>(select md5(jsonb_build_array((select jsonb_agg(to_jsonb(e)) from public.duty_roster_published_entries e where e.publication_id=publication_id),
  (select jsonb_agg(to_jsonb(a)) from public.crew_attendance_records a where a.employee_id in (monthly_id,hourly_id)))::text)) then raise exception 'Roster/Attendance source changed'; end if;
 if snapshot_hash<>(select md5(calculation::text) from public.payroll_run_calculation_snapshots s where s.run_id=run_id and s.employee_id=monthly_id) then raise exception 'Frozen payroll changed'; end if;
 perform set_config('request.jwt.claim.sub','',true);
 begin perform public.payroll_ph_work_read(run_id,monthly_id); raise exception 'Anonymous PH read allowed'; exception when insufficient_privilege then null; end;
end $$;
select 'PH company benefit / canonical Leave / immutable snapshot rollback contracts PASS' result;
rollback;
