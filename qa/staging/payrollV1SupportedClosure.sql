-- Approved isolated Staging fixture only. No payment and no real employee changes.
-- Master creation is fixture setup; all Payroll mutations use canonical commands.
begin;
select set_config('request.jwt.claim.sub',(select e.auth_user_id::text from public.employees e
  join public.roles r on r.id=e.role_id where lower(r.name)='owner'
  and e.enable_system_login and e.access_state='active' limit 1),true);
do $$
declare actor uuid:=public.payroll_admin_actor(); ent uuid; outlet uuid; emp uuid;
  profile uuid; original uuid; corrected uuid; result jsonb; pcb_request uuid:=gen_random_uuid();
  pcb_id uuid; component uuid; original_hash text; snapshot_hash text;
begin
  if exists(select 1 from public.legal_entities where company_registration_no='QA-P4-V1-20260927') then
    raise exception 'Fixture already exists; inspect instead of repeating'; end if;
  insert into public.legal_entities(legal_company_name,company_registration_no,registered_address,
    created_by_employee_id,updated_by_employee_id)
    values('QA ONLY Statutory V1 Supported Closure','QA-P4-V1-20260927','STAGING ONLY - no payment',actor,actor) returning id into ent;
  insert into public.outlets(name,code,state_code) values('QA ONLY P4 Supported Workplace','QA-P4-0927','MY-08') returning id into outlet;
  perform set_config('feedx.payroll_command','yes',true);
  insert into public.payroll_outlet_state_versions(outlet_id,effective_from,state_code)
    values(outlet,'2026-01-01','MY-08');
  insert into public.employees(full_name,employee_code,legal_entity_id,workplace,joined_date,birthday,nationality,
    enable_system_login,access_state)
    values('QA ONLY P4 Supported Employee','QA-P4-V1-0927',ent,'QA ONLY P4 Supported Workplace',
      '2026-01-01','1990-01-01','Malaysia',false,'no_access') returning id into emp;
  result:=public.payroll_initial_setup_read(emp,'2026-01-01','{"epf":true,"socso":true,"eis":true,"pcb":true}');
  result:=public.payroll_initial_setup_confirm(emp,'2026-01-01','monthly',3250,'MYR',
    '{"epf":true,"socso":true,"eis":true,"pcb":true}',result->>'fingerprint');
  profile:=(result->>'profile_id')::uuid;
  original:=public.payroll_run_create(ent,'2026-06-01','2026-06-30','QA ONLY supported statutory closure - no payment');
  perform public.payroll_run_calculate(original);
  result:=public.payroll_statutory_project(original,emp);
  if not(result->'issues' ? 'pcb_manual_confirmation_missing') or result->>'net_pay' is not null then
    raise exception 'Missing PCB must block: %',result; end if;
  pcb_id:=public.payroll_run_pcb_confirm(pcb_request,original,emp,50,null,'Synthetic QA amount - not tax advice','QA approved confirmation');
  if pcb_id<>public.payroll_run_pcb_confirm(pcb_request,original,emp,50,null,'Synthetic QA amount - not tax advice','QA approved confirmation') then
    raise exception 'PCB retry did not return original evidence'; end if;
  perform public.payroll_run_statutory_calculate(original);
  result:=public.payroll_statutory_project(original,emp);
  if result->>'status'<>'ready' or (result->>'net_pay')::numeric<>2818.25
    or (result->>'total_employer_cost')::numeric<>3737.35 then
    raise exception 'Supported original expected Net2818.25/Cost3737.35: %',result; end if;
  perform public.payroll_run_transition(original,'review_required','QA evidence reviewed');
  perform public.payroll_run_transition(original,'ready','QA supported schemes and PCB complete');
  perform public.payroll_run_transition(original,'finalized','QA ONLY immutable supported statutory record - no payment');
  select md5(s.result::text) into original_hash from public.payroll_run_statutory_snapshots s where run_id=original and employee_id=emp;
  if original_hash is null then raise exception 'Statutory final snapshot missing'; end if;
  corrected:=public.payroll_run_create(ent,'2026-06-01','2026-06-30','QA ONLY corrected historical entitlement and PCB - no payment',original);
  component:=public.payroll_component_save(null,'qa_p4_entitlement_0927','QA ONLY Historical Entitlement Correction','earning',
    'included','included','included','included',true,'QA isolated historical entitlement correction',null);
  perform public.payroll_draft_adjustment_save(gen_random_uuid(),corrected,emp,'add',null,component,100,'QA corrected historical entitlement');
  perform public.payroll_run_calculate(corrected);
  result:=public.payroll_statutory_project(corrected,emp);
  if not(result->'issues' ? 'pcb_manual_confirmation_missing') then raise exception 'Correction must require its own PCB'; end if;
  perform public.payroll_run_pcb_confirm(gen_random_uuid(),corrected,emp,55,null,'Synthetic corrected QA amount','QA explicit corrected PCB');
  perform public.payroll_run_statutory_calculate(corrected);
  result:=public.payroll_statutory_project(corrected,emp);
  if result->>'status'<>'ready' or (result->>'net_pay')::numeric<>2901.55
    or (result->>'total_employer_cost')::numeric<>3852.35 then
    raise exception 'Corrected expected Net2901.55/Cost3852.35: %',result; end if;
  perform public.payroll_run_transition(corrected,'review_required','QA correction reviewed');
  perform public.payroll_run_transition(corrected,'ready','QA correction statutory and PCB complete');
  perform public.payroll_run_transition(corrected,'finalized','QA ONLY immutable corrected statutory record - no payment');
  if original_hash<>(select md5(s.result::text) from public.payroll_run_statutory_snapshots s where run_id=original and employee_id=emp) then
    raise exception 'Original final statutory evidence changed'; end if;
  select md5(s.result::text) into snapshot_hash from public.payroll_run_statutory_snapshots s where run_id=corrected and employee_id=emp;
  perform public.payroll_compensation_adjust(profile,'2026-08-01','monthly',3400,'MYR','QA later setup verifies snapshot immutability');
  if snapshot_hash<>(select md5(s.result::text) from public.payroll_run_statutory_snapshots s where run_id=corrected and employee_id=emp) then
    raise exception 'Later setup changed finalized evidence'; end if;
  if not exists(select 1 from public.payroll_periods where current_finalized_run_id=corrected)
    or (select count(*) from public.payroll_events where run_id in(original,corrected) and event_type='run_finalized')<>2
    or (select count(*) from public.payroll_run_pcb_confirmations where run_id=original and employee_id=emp)<>1 then
    raise exception 'Current revision or exactly-once evidence failed'; end if;
end $$;
commit;
