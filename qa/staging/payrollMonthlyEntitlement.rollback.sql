-- Staging-only fixture setup in a rollback transaction; no persistent employee,
-- outlet, leave or payroll evidence. Commands under test use real Admin authority.
begin;
select set_config('request.jwt.claim.sub',(select auth_user_id::text from public.employees e
  join public.roles r on r.id=e.role_id where lower(r.name)='owner' and e.enable_system_login
  and e.access_state='active' limit 1),true);
do $$
declare v_actor uuid:=public.payroll_admin_actor(); v_entity uuid; v_outlet uuid;
  v_employee uuid; v_profile uuid; v_comp uuid; v_period uuid; v_run uuid;
  v_request uuid; v_leave uuid; v_result jsonb; v_full jsonb; v_before text; v_snapshot text;
  v_publication uuid; v_roster uuid; v_roster_hash text;
  v_joiner uuid; v_join_profile uuid; v_pcb uuid;
begin
  insert into public.legal_entities(legal_company_name,company_registration_no,registered_address,
    created_by_employee_id,updated_by_employee_id) values('QA rollback monthly entitlement',
    'QA-ROLLBACK-'||gen_random_uuid(),'Disposable rollback evidence',v_actor,v_actor) returning id into v_entity;
  insert into public.outlets(name,code,state_code) values('QA rollback monthly workplace',
    'QA-'||substr(gen_random_uuid()::text,1,8),'MY-08') returning id into v_outlet;
  -- Canonical geography history starts at creation. Explicit earlier fixture
  -- evidence is test setup only, never a production/current-state backfill.
  insert into public.payroll_outlet_state_versions(outlet_id,effective_from,state_code)
    values(v_outlet,'2026-01-01','MY-08');
  insert into public.employees(full_name,employee_code,legal_entity_id,workplace,joined_date,birthday)
    values('QA rollback monthly employee','QA-'||substr(gen_random_uuid()::text,1,8),v_entity,
      'QA rollback monthly workplace','2026-01-01','1990-01-01') returning id into v_employee;
  v_result:=public.payroll_initial_setup_read(v_employee,'2026-01-01','{"epf":true,"socso":true,"eis":true,"pcb":false}');
  v_result:=public.payroll_initial_setup_confirm(v_employee,'2026-01-01','monthly',3000,'MYR',
    '{"epf":true,"socso":true,"eis":true,"pcb":false}',v_result->>'fingerprint');
  v_profile:=(v_result->>'profile_id')::uuid;
  select id into v_comp from public.payroll_compensation_versions where profile_id=v_profile;
  v_run:=public.payroll_run_create(v_entity,'2026-06-01','2026-06-30','Disposable rollback run');
  select period_id into v_period from public.payroll_runs where id=v_run;
  v_full:=public.payroll_calculation_project(v_run,v_employee);
  if v_full->>'gross_earnings'<>'3000.00' or v_full->>'status'<>'ready' then
    raise exception 'Full-month regression: %',v_full;
  end if;
  perform public.payroll_monthly_rule_confirm();
  perform public.payroll_monthly_rule_confirm();
  if (select count(*) from public.payroll_events where rule_version_id=(select id from
    public.payroll_pay_rule_versions where rule_code='monthly_proration'))<>1 then
    raise exception 'Rule confirmation duplicated audit';
  end if;
  -- Employment date variation is isolated fixture setup, not a Payroll mutation.
  update public.employees set joined_date='2026-06-11' where id=v_employee;
  v_result:=public.payroll_calculation_project(v_run,v_employee);
  if (v_result->>'gross_earnings')::numeric<>2000 or v_result->>'status'<>'ready' then
    raise exception 'Mid-month join: %',v_result;
  end if;
  update public.employees set joined_date='2026-01-01',resigned_date='2026-06-20' where id=v_employee;
  v_result:=public.payroll_calculation_project(v_run,v_employee);
  if (v_result->>'gross_earnings')::numeric<>2000 then raise exception 'Termination proration: %',v_result; end if;
  update public.employees set resigned_date=null where id=v_employee;
  -- Minimum approved-leave source fixture. It does not impersonate a Crew token.
  insert into public.crew_leave_requests(employee_id,employment_outlet_id,leave_type,start_date,end_date,
    requested_days,reason,submitted_by,status,reviewed_at,reviewed_by) values(v_employee,v_outlet,'unpaid','2026-06-10','2026-06-11',
    2,'Rollback unpaid-leave source',v_employee,'approved',now(),auth.uid()) returning id into v_request;
  insert into public.crew_approved_leaves(request_id,employee_id,employment_outlet_id,leave_type,
    start_date,end_date,duration_type,approved_by) values(v_request,v_employee,v_outlet,'unpaid',
    '2026-06-10','2026-06-11','full_day',auth.uid()) returning id into v_leave;
  select md5(to_jsonb(l)::text) into v_before from public.crew_approved_leaves l where id=v_leave;
  v_result:=public.payroll_calculation_project(v_run,v_employee);
  if (v_result->>'gross_earnings')::numeric<>2800 or v_result->>'status'<>'ready'
    or (v_result->>'non_statutory_deductions')::numeric<>0 then
    raise exception 'Unpaid without roster must reduce Basic once: %',v_result;
  end if;
  if v_before<>(select md5(to_jsonb(l)::text) from public.crew_approved_leaves l where id=v_leave) then
    raise exception 'Source leave changed'; end if;
  if v_result->'inputs'->'monthly_entitlement'->>'unpaid_days'<>'2' then raise exception 'Unpaid days absent'; end if;
  insert into public.duty_roster_publications(outlet_id,week_start_date,week_end_date,revision,published_by)
    values(v_outlet,'2026-06-08','2026-06-14',1,auth.uid()) returning id into v_publication;
  insert into public.duty_roster_published_entries(publication_id,outlet_id,employee_id,roster_date,
    start_time,end_time,break_minutes,entry_type,outlet_name_snapshot,published_at)
    values(v_publication,v_outlet,v_employee,'2026-06-10','09:00','18:00',60,'shift',
      'QA rollback monthly workplace',now()) returning id into v_roster;
  select md5(to_jsonb(r)::text) into v_roster_hash from public.duty_roster_published_entries r where id=v_roster;
  v_result:=public.payroll_calculation_project(v_run,v_employee);
  if (v_result->>'gross_earnings')::numeric<>2800 or v_result->>'status'<>'ready' then
    raise exception 'Unpaid with roster must use same calendar entitlement: %',v_result; end if;
  if v_roster_hash<>(select md5(to_jsonb(r)::text) from public.duty_roster_published_entries r where id=v_roster) then
    raise exception 'Published roster changed'; end if;
  begin
    perform public.payroll_compensation_adjust(v_profile,'2026-06-15','monthly',3200,'MYR','Rollback salary change');
    v_result:=public.payroll_calculation_project(v_run,v_employee);
    if not (v_result->'issues' ? 'monthly_rate_change_requires_proration_policy') then
      raise exception 'Salary blending was not blocked'; end if;
    raise exception using errcode='ZX001',message='Rollback salary-change subcase';
  exception when sqlstate 'ZX001' then null; end;
  -- A real joiner can establish compensation/statutory setup on the joining
  -- date, not an invented pre-employment date. All projections use that cutoff.
  insert into public.employees(full_name,employee_code,legal_entity_id,workplace,joined_date,birthday)
    values('QA rollback monthly joiner','QA-'||substr(gen_random_uuid()::text,1,8),v_entity,
      'QA rollback monthly workplace','2026-06-11','1990-01-01') returning id into v_joiner;
  v_result:=public.payroll_initial_setup_read(v_joiner,'2026-06-11','{"epf":true,"socso":true,"eis":true,"pcb":true}');
  v_result:=public.payroll_initial_setup_confirm(v_joiner,'2026-06-11','monthly',3000,'MYR',
    '{"epf":true,"socso":true,"eis":true,"pcb":true}',v_result->>'fingerprint');
  v_join_profile:=(v_result->>'profile_id')::uuid;
  v_pcb:=public.payroll_run_pcb_confirm(gen_random_uuid(),v_run,v_joiner,0,null,null,'Rollback manual PCB');
  perform public.payroll_employee_recalculate(v_run,v_joiner);
  v_result:=public.payroll_statutory_project(v_run,v_joiner);
  if v_result->>'status'<>'ready' or exists(select 1 from jsonb_array_elements(v_result->'lines') l
      where l->>'scheme' in ('epf','socso','eis') and (l->>'wage_base')::numeric<>2000) then
    raise exception 'Joining-date setup/statutory basis: %',v_result; end if;
  v_result:=public.payroll_run_preparation_read(v_run);
  if not exists(select 1 from jsonb_array_elements(v_result->'results') r where r->>'employee_id'=v_joiner::text
      and r->'statutory_setup'->>'complete'='true') then raise exception 'Joiner preparation contradiction: %',v_result; end if;
  perform public.payroll_employee_recalculate(v_run,v_employee);
  v_result:=public.payroll_statutory_project(v_run,v_employee);
  if v_result->>'status'<>'ready' or exists(select 1 from jsonb_array_elements(v_result->'lines') l
      where l->>'scheme' in ('epf','socso','eis') and (l->>'wage_base')::numeric<>2800) then
    raise exception 'Actual wages must feed each statutory base: %',v_result; end if;
  perform public.payroll_run_transition(v_run,'review_required','Rollback evidence review');
  perform public.payroll_run_transition(v_run,'ready','Rollback readiness');
  perform public.payroll_run_transition(v_run,'finalized','Rollback Finalize gate');
  select md5(calculation::text) into v_snapshot from public.payroll_run_calculation_snapshots
    where run_id=v_run and employee_id=v_employee;
  -- Unsupported units stay blocked rather than silently retaining full pay.
  update public.crew_approved_leaves set duration_type='half_day',end_date=start_date,half_day_period='am' where id=v_leave;
  v_result:=public.payroll_calculation_project(v_run,v_employee);
  if v_result->>'status'<>'review_required' or not (v_result->'issues' ? 'unpaid_half_day_policy_required') then
    raise exception 'Half-day did not fail closed: %',v_result; end if;
  if v_snapshot is distinct from (select md5(calculation::text) from public.payroll_run_calculation_snapshots
      where run_id=v_run and employee_id=v_employee) then raise exception 'Finalized snapshot changed'; end if;
end; $$;
select 'PASS: full month, join/termination, unpaid with/without roster, source immutability, blocked salary blend, joining-date setup/PCB/preparation, net Basic statutory bases, Ready/Finalize, frozen snapshots, unsupported units; all fixtures rolled back' result;
rollback;
