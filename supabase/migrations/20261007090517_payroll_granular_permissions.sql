-- Payroll workflow grants replace broad manage authority. Existing scopes and business contracts are retained.
begin;

insert into public.permissions(code,module,description,requires_restaurant_outlet_scope) values ('payroll.setup','Payroll','Create and correct effective compensation and recurring employee components.',false),('payroll.statutory','Payroll','Confirm effective statutory setup, PCB and reusable PH statutory evidence.',false),('payroll.prepare','Payroll','Create and prepare open Payroll Runs, including governed correction Runs.',false),('payroll.review_time','Payroll','Review, correct and reconcile open payable-time evidence.',false),('payroll.treat_ph','Payroll','Confirm and correct open Public Holiday occurrence treatments.',false),('payroll.adjust','Payroll','Append and reverse open Run component adjustments.',false),('payroll.configure','Payroll','Configure components, wage classifications, pricing rules and default PH treatment.',false),('payroll.configure_holidays','Payroll','Capture and review official sources, proposed dates and calendar/policy drafts.',false),('payroll.publish_holidays','Payroll','Publish/retire paid-holiday authority and confirm additional gazetted entitlement; calendar configuration is also required.',false),('payroll.record_payment','Payroll','Record and reverse settlement evidence for current finalized Payroll.',false) on conflict(code) do update set description=excluded.description;

create temporary table payroll_grant_split_before on commit drop as
 select r.id role_id,r.name,r.outlet_access_type,
 (select coalesce(jsonb_agg(p.code order by p.code),'[]') from public.role_permissions rp join public.permissions p on p.id=rp.permission_id where rp.role_id=r.id) permissions,
 (select coalesce(jsonb_agg(ro.outlet_id order by ro.outlet_id),'[]') from public.role_outlets ro where ro.role_id=r.id) outlets
 from public.roles r where exists(select 1 from public.role_permissions rp join public.permissions p on p.id=rp.permission_id where rp.role_id=r.id and p.code='payroll.manage');
insert into public.role_permissions(role_id,permission_id)
 select b.role_id,p.id from payroll_grant_split_before b cross join public.permissions p
 where p.code in ('payroll.setup','payroll.statutory','payroll.prepare','payroll.review_time','payroll.treat_ph','payroll.adjust','payroll.configure','payroll.configure_holidays','payroll.publish_holidays','payroll.record_payment' ) on conflict do nothing;
delete from public.role_permissions where permission_id=(select id from public.permissions where code='payroll.manage');
insert into public.audit_logs(action,module,user_name,description,metadata)
 select 'payroll_permissions_split','access-control','System migration','Replace broad Payroll manage with equivalent workflow grants',
 jsonb_build_object('migration','20261007083230','role_id',b.role_id,'before',to_jsonb(b),'after',jsonb_build_object('permissions',(select jsonb_agg(p.code order by p.code) from public.role_permissions rp join public.permissions p on p.id=rp.permission_id where rp.role_id=b.role_id),'outlets',b.outlets,'outlet_access_type',b.outlet_access_type)) from payroll_grant_split_before b;
-- Retain the old catalog ID for immutable historical references; new role saves cannot grant it.

create or replace function public.payroll_can_recalculate_entity(p_legal_entity_id uuid) returns boolean
 language sql stable security definer set search_path=public as $$
 select exists(select 1 from unnest(array['payroll.setup','payroll.statutory','payroll.prepare','payroll.review_time','payroll.treat_ph','payroll.adjust','payroll.configure','payroll.configure_holidays','payroll.publish_holidays' ]::text[]) permission where public.payroll_can_manage_entity(p_legal_entity_id,permission)); $$;
revoke all on function public.payroll_can_recalculate_entity(uuid) from public,anon;
grant execute on function public.payroll_can_recalculate_entity(uuid) to authenticated;

do $patch$ declare d text:=pg_get_functiondef('public.payroll_annual_holiday_read(integer)'::regprocedure); begin
 if md5(d)<>'9f8ee60ce947cb3a34dccabb9e8446e7' then raise exception 'Payroll authority definition drift: payroll_annual_holiday_read'; end if;

 d:=replace(d,$before0$ into result;
 return result || jsonb_build_object('additional_entries',(select coalesce(jsonb_agg(entry order by confirmed_at,id),'[]') from public.payroll_additional_holiday_confirmations where year=p_year));
$before0$,$after0$ into result;
 return result || jsonb_build_object('can_publish',(result->>'can_manage')::boolean and public.current_user_has_permission('payroll.publish_holidays')) || jsonb_build_object('additional_entries',(select coalesce(jsonb_agg(entry order by confirmed_at,id),'[]') from public.payroll_additional_holiday_confirmations where year=p_year));
$after0$);

 d:=replace(d,$before1$ and ph.effective_from<=case when p_year=extract(year from timezone('Asia/Kuala_Lumpur',now())::date)::integer then timezone('Asia/Kuala_Lumpur',now())::date else make_date(p_year,1,1) end)),
 'can_manage',public.current_user_has_permission('payroll.manage') and public.current_user_has_all_outlet_access()
$before1$,$after1$ and ph.effective_from<=case when p_year=extract(year from timezone('Asia/Kuala_Lumpur',now())::date)::integer then timezone('Asia/Kuala_Lumpur',now())::date else make_date(p_year,1,1) end)),
 'can_manage',public.current_user_has_permission('payroll.configure_holidays') and public.current_user_has_all_outlet_access()
$after1$);

 execute d; end $patch$;

do $patch$ declare d text:=pg_get_functiondef('public.payroll_compensation_adjust(uuid,date,text,numeric,text,text,uuid,uuid)'::regprocedure); begin
 if md5(d)<>'516f99a803e2cd95aae28eba97a3e439' then raise exception 'Payroll authority definition drift: payroll_compensation_adjust'; end if;

 d:=replace(d,$before0$  select * into v_profile from public.payroll_profiles where id=p_profile_id for update;
  if v_profile.id is null or not public.payroll_can_access_employee(v_profile.employee_id,'payroll.manage') then
$before0$,$after0$  select * into v_profile from public.payroll_profiles where id=p_profile_id for update;
  if v_profile.id is null or not public.payroll_can_access_employee(v_profile.employee_id,'payroll.setup') then
$after0$);

 execute d; end $patch$;

do $patch$ declare d text:=pg_get_functiondef('public.payroll_component_create(text,text,text,text,text,text,text,text)'::regprocedure); begin
 if md5(d)<>'aa887306bb5a56e009316c4982659aa1' then raise exception 'Payroll authority definition drift: payroll_component_create'; end if;

 d:=replace(d,$before0$begin
  if not public.current_user_has_permission('payroll.manage')
$before0$,$after0$begin
  if not public.current_user_has_permission('payroll.configure')
$after0$);

 execute d; end $patch$;

do $patch$ declare d text:=pg_get_functiondef('public.payroll_component_save(uuid,text,text,text,text,text,text,text,boolean,text,text)'::regprocedure); begin
 if md5(d)<>'64ef663e50594d229afcd93d02a70fbe' then raise exception 'Payroll authority definition drift: payroll_component_save'; end if;

 d:=replace(d,$before0$begin
 if not public.current_user_has_permission('payroll.manage') or not exists(select 1 from public.employees e
$before0$,$after0$begin
 if not public.current_user_has_permission('payroll.configure') or not exists(select 1 from public.employees e
$after0$);

 execute d; end $patch$;

do $patch$ declare d text:=pg_get_functiondef('public.payroll_component_update(uuid,text,text,text,text,text,boolean,text,text)'::regprocedure); begin
 if md5(d)<>'1675ad687c38cd0329fc91f196c19577' then raise exception 'Payroll authority definition drift: payroll_component_update'; end if;

 d:=replace(d,$before0$begin
  if not public.current_user_has_permission('payroll.manage')
$before0$,$after0$begin
  if not public.current_user_has_permission('payroll.configure')
$after0$);

 execute d; end $patch$;

do $patch$ declare d text:=pg_get_functiondef('public.payroll_epf_component_classify(uuid,date,text,text,text)'::regprocedure); begin
 if md5(d)<>'44d2b4095bce4b88ec921a5fd60557b2' then raise exception 'Payroll authority definition drift: payroll_epf_component_classify'; end if;

 d:=replace(d,$before0$begin
  if not public.current_user_has_permission('payroll.manage')
$before0$,$after0$begin
  if not public.current_user_has_permission('payroll.configure')
$after0$);

 execute d; end $patch$;

do $patch$ declare d text:=pg_get_functiondef('public.payroll_foundation_read(uuid,uuid)'::regprocedure); begin
 if md5(d)<>'51bfa08ebd7b2a11764cb42bed221fb2' then raise exception 'Payroll authority definition drift: payroll_foundation_read'; end if;

 d:=replace(d,$before0$        where e.auth_user_id=auth.uid() and lower(r.name) in ('owner','admin')),
      'holidays',public.current_user_has_permission('payroll.manage')
$before0$,$after0$        where e.auth_user_id=auth.uid() and lower(r.name) in ('owner','admin')),
      'holidays',public.current_user_has_permission('payroll.configure_holidays')
$after0$);

 d:=replace(d,$before1$    'components',v_components,'holidays',v_holidays,'outlets',v_outlets,'periods',v_periods,
    'settings_authority',jsonb_build_object(
      'components',public.current_user_has_permission('payroll.manage') and exists(
$before1$,$after1$    'components',v_components,'holidays',v_holidays,'outlets',v_outlets,'periods',v_periods,
    'settings_authority',jsonb_build_object('ph_default',public.current_user_has_all_outlet_access(),
      'components',public.current_user_has_permission('payroll.configure') and exists(
$after1$);

 execute d; end $patch$;

do $patch$ declare d text:=pg_get_functiondef('public.payroll_holiday_save(date,text,text,text,uuid,text,uuid)'::regprocedure); begin
 if md5(d)<>'3740e2149488fa41214fc9c596b4a52d' then raise exception 'Payroll authority definition drift: payroll_holiday_save'; end if;

 d:=replace(d,$before0$begin
  if not public.current_user_has_permission('payroll.manage')
$before0$,$after0$begin
  if not public.current_user_has_permission('payroll.configure_holidays')
$after0$);

 execute d; end $patch$;

do $patch$ declare d text:=pg_get_functiondef('public.payroll_holiday_settings_actor()'::regprocedure); begin
 if md5(d)<>'4cb49c8f122266158da638321675cb7d' then raise exception 'Payroll authority definition drift: payroll_holiday_settings_actor'; end if;

 d:=replace(d,$before0$begin
  if not public.current_user_has_permission('payroll.manage')
$before0$,$after0$begin
  if not public.current_user_has_permission('payroll.configure_holidays')
$after0$);

 execute d; end $patch$;

do $patch$ declare d text:=pg_get_functiondef('public.payroll_holiday_update(uuid,date,text,text,text,text,uuid,boolean,text)'::regprocedure); begin
 if md5(d)<>'96dc638c31ff5f4c94f9a4bcc68a52df' then raise exception 'Payroll authority definition drift: payroll_holiday_update'; end if;

 d:=replace(d,$before0$begin
  if not public.current_user_has_permission('payroll.manage')
$before0$,$after0$begin
  if not public.current_user_has_permission('payroll.configure_holidays')
$after0$);

 execute d; end $patch$;

do $patch$ declare d text:=pg_get_functiondef('public.payroll_initial_setup_confirm(uuid,date,text,numeric,text,jsonb,text,date)'::regprocedure); begin
 if md5(d)<>'7a1c3815f9e175e610a0eef06e59302a' then raise exception 'Payroll authority definition drift: payroll_initial_setup_confirm'; end if;

 d:=replace(d,$before0$ perform public.payroll_admin_actor();
 if not public.payroll_can_access_employee(p_employee_id,'payroll.manage') then
$before0$,$after0$ perform public.payroll_admin_actor();
 if not public.payroll_can_access_employee(p_employee_id,'payroll.setup') then
$after0$);

 execute d; end $patch$;

do $patch$ declare d text:=pg_get_functiondef('public.payroll_lindung_setup_confirm(uuid,jsonb,text,uuid)'::regprocedure); begin
 if md5(d)<>'3b384028ae6e584a98190fee6e4387c1' then raise exception 'Payroll authority definition drift: payroll_lindung_setup_confirm'; end if;

 d:=replace(d,$before0$ select employee.* into e from public.payroll_profiles p join public.employees employee on employee.id=p.employee_id where p.id=p_profile_id;
 if e.id is null or not public.payroll_can_access_employee(e.id,'payroll.manage') then
$before0$,$after0$ select employee.* into e from public.payroll_profiles p join public.employees employee on employee.id=p.employee_id where p.id=p_profile_id;
 if e.id is null or not public.payroll_can_access_employee(e.id,'payroll.statutory') then
$after0$);

 execute d; end $patch$;

do $patch$ declare d text:=pg_get_functiondef('public.payroll_lindung_setup_preview(uuid,date,jsonb,boolean)'::regprocedure); begin
 if md5(d)<>'b4ade21c596d3431d8d5d8de6f889751' then raise exception 'Payroll authority definition drift: payroll_lindung_setup_preview'; end if;

 d:=replace(d,$before0$ perform public.payroll_admin_actor();
 if not public.payroll_can_access_employee((select employee_id from public.payroll_profiles where id=p_profile_id),'payroll.manage') then raise exception using errcode='42501',message='Payroll LINDUNG setup scope denied.';end if;
$before0$,$after0$ perform public.payroll_admin_actor();
 if not public.payroll_can_access_employee((select employee_id from public.payroll_profiles where id=p_profile_id),'payroll.statutory') then raise exception using errcode='42501',message='Payroll LINDUNG setup scope denied.';end if;
$after0$);

 execute d; end $patch$;

do $patch$ declare d text:=pg_get_functiondef('public.payroll_lindung_validate_intent(uuid,jsonb,uuid)'::regprocedure); begin
 if md5(d)<>'0ceaa288785934433cd9a71e83fb0fca' then raise exception 'Payroll authority definition drift: payroll_lindung_validate_intent'; end if;

 d:=replace(d,$before0$  raise exception using errcode='22023',message='Designated contributing employer is missing.'; end if;
 if entity is not null and not public.payroll_can_manage_entity(entity,'payroll.manage') then
$before0$,$after0$  raise exception using errcode='22023',message='Designated contributing employer is missing.'; end if;
 if entity is not null and not public.payroll_can_manage_entity(entity,'payroll.statutory') then
$after0$);

 d:=replace(d,$before1$ select employee.* into e from public.payroll_profiles p join public.employees employee on employee.id=p.employee_id where p.id=p_profile_id;
 if e.id is null or not public.payroll_can_access_employee(e.id,'payroll.manage') then raise exception using errcode='42501',message='Payroll LINDUNG setup scope denied.';end if;
$before1$,$after1$ select employee.* into e from public.payroll_profiles p join public.employees employee on employee.id=p.employee_id where p.id=p_profile_id;
 if e.id is null or not public.payroll_can_access_employee(e.id,'payroll.statutory') then raise exception using errcode='42501',message='Payroll LINDUNG setup scope denied.';end if;
$after1$);

 execute d; end $patch$;

do $patch$ declare d text:=pg_get_functiondef('public.payroll_monthly_rule_confirm()'::regprocedure); begin
 if md5(d)<>'20a11ae3e9b687b849fd937c6347f8d9' then raise exception 'Payroll authority definition drift: payroll_monthly_rule_confirm'; end if;

 d:=replace(d,$before0$begin
  if not public.current_user_has_permission('payroll.manage') or not exists
$before0$,$after0$begin
  if not public.current_user_has_permission('payroll.configure') or not exists
$after0$);

 execute d; end $patch$;

do $patch$ declare d text:=pg_get_functiondef('public.payroll_payment_read(uuid,uuid)'::regprocedure); begin
 if md5(d)<>'9c8813461ca9ceea1ef552ffd76c1ea2' then raise exception 'Payroll authority definition drift: payroll_payment_read'; end if;

 d:=replace(d,$before0$ return jsonb_build_object('current',p.current_finalized_run_id=p_run_id,
  'can_record',p.current_finalized_run_id=p_run_id and public.payroll_can_manage_entity(p.legal_entity_id,'payroll.manage'),
$before0$,$after0$ return jsonb_build_object('current',p.current_finalized_run_id=p_run_id,
  'can_record',p.current_finalized_run_id=p_run_id and public.payroll_can_manage_entity(p.legal_entity_id,'payroll.record_payment'),
$after0$);

 execute d; end $patch$;

do $patch$ declare d text:=pg_get_functiondef('public.payroll_payment_record(uuid,uuid,uuid,text,numeric,date,text,text,uuid)'::regprocedure); begin
 if md5(d)<>'ed4230983044767d31e7e1a4b8abc80e' then raise exception 'Payroll authority definition drift: payroll_payment_record'; end if;

 d:=replace(d,$before0$ select period.* into p from public.payroll_runs r join public.payroll_periods period on period.id=r.period_id where r.id=p_run_id for update of period;
 if not coalesce(public.payroll_can_manage_entity(p.legal_entity_id,'payroll.manage'),false) then raise exception using errcode='42501',message='Payroll settlement permission required.'; end if;
$before0$,$after0$ select period.* into p from public.payroll_runs r join public.payroll_periods period on period.id=r.period_id where r.id=p_run_id for update of period;
 if not coalesce(public.payroll_can_manage_entity(p.legal_entity_id,'payroll.record_payment'),false) then raise exception using errcode='42501',message='Payroll settlement permission required.'; end if;
$after0$);

 execute d; end $patch$;

do $patch$ declare d text:=pg_get_functiondef('public.payroll_ph_policy_save(uuid,date,text,text)'::regprocedure); begin
 if md5(d)<>'98d2f9f9c40e91b8b9ee36191ab536b0' then raise exception 'Payroll authority definition drift: payroll_ph_policy_save'; end if;

 d:=replace(d,$before0$begin
 if not public.payroll_can_manage_entity(p_legal_entity_id,'payroll.manage') then
$before0$,$after0$begin
 if not public.payroll_can_manage_entity(p_legal_entity_id,'payroll.configure') then
$after0$);

 execute d; end $patch$;

do $patch$ declare d text:=pg_get_functiondef('public.payroll_ph_profile_save(jsonb)'::regprocedure); begin
 if md5(d)<>'db99671307675c9727cdabfa1c90f5a1' then raise exception 'Payroll authority definition drift: payroll_ph_profile_save'; end if;

 d:=replace(d,$before0$ insert into payroll_events(event_type,profile_id,actor_employee_id,reason,details) values('ph_pay_profile_confirmed',profile,actor,p_input->>'reason',jsonb_build_object('revision_id',result,'supersedes_id',previous.id,'effective_from',day));
 for r in select x.id from payroll_runs x join payroll_periods p on p.id=x.period_id where x.status in ('draft','review_required') and p.period_end>=day and (next_date is null or p.period_start<next_date) and payroll_can_access_run_employee(x.id,emp,'payroll.manage') order by x.id for update of x loop perform payroll_employee_recalculate(r.id,emp); end loop;
$before0$,$after0$ insert into payroll_events(event_type,profile_id,actor_employee_id,reason,details) values('ph_pay_profile_confirmed',profile,actor,p_input->>'reason',jsonb_build_object('revision_id',result,'supersedes_id',previous.id,'effective_from',day));
 for r in select x.id from payroll_runs x join payroll_periods p on p.id=x.period_id where x.status in ('draft','review_required') and p.period_end>=day and (next_date is null or p.period_start<next_date) and payroll_can_access_run_employee(x.id,emp,'payroll.statutory') order by x.id for update of x loop perform payroll_employee_recalculate(r.id,emp); end loop;
$after0$);

 d:=replace(d,$before1$begin
 if not payroll_can_access_employee(emp,'payroll.manage') then raise insufficient_privilege using message='PH Pay Profile authority denied'; end if;
$before1$,$after1$begin
 if not payroll_can_access_employee(emp,'payroll.statutory') then raise insufficient_privilege using message='PH Pay Profile authority denied'; end if;
$after1$);

 execute d; end $patch$;

do $patch$ declare d text:=pg_get_functiondef('public.payroll_ph_statutory_confirm(jsonb)'::regprocedure); begin
 if md5(d)<>'03592a621c2f4e6cc2fd46311bc3106d' then raise exception 'Payroll authority definition drift: payroll_ph_statutory_confirm'; end if;

 d:=replace(d,$before0$ select * into r from payroll_runs where id=(p_input->>'run_id')::uuid for update;
 if r.id is null or not payroll_can_access_run_employee(r.id,emp,'payroll.manage') then raise insufficient_privilege using message='Payroll PH review authority denied.'; end if;
$before0$,$after0$ select * into r from payroll_runs where id=(p_input->>'run_id')::uuid for update;
 if r.id is null or not payroll_can_access_run_employee(r.id,emp,'payroll.treat_ph') then raise insufficient_privilege using message='Payroll PH review authority denied.'; end if;
$after0$);

 execute d; end $patch$;

do $patch$ declare d text:=pg_get_functiondef('public.payroll_ph_wage_evidence_save(jsonb)'::regprocedure); begin
 if md5(d)<>'ebb87d575f53186018619f4fff604418' then raise exception 'Payroll authority definition drift: payroll_ph_wage_evidence_save'; end if;

 d:=replace(d,$before0$ insert into payroll_events(event_type,profile_id,actor_employee_id,reason,details) values('ph_historical_wages_confirmed',profile,actor,p_input->>'reason',jsonb_build_object('revision_id',v.id,'supersedes_id',previous.id,'period_start',month));
 for r in select x.id from payroll_runs x join payroll_periods p on p.id=x.period_id where x.status in ('draft','review_required') and p.period_start=(month+interval '1 month')::date and payroll_can_access_run_employee(x.id,emp,'payroll.manage') order by x.id for update of x loop perform payroll_employee_recalculate(r.id,emp); end loop;
$before0$,$after0$ insert into payroll_events(event_type,profile_id,actor_employee_id,reason,details) values('ph_historical_wages_confirmed',profile,actor,p_input->>'reason',jsonb_build_object('revision_id',v.id,'supersedes_id',previous.id,'period_start',month));
 for r in select x.id from payroll_runs x join payroll_periods p on p.id=x.period_id where x.status in ('draft','review_required') and p.period_start=(month+interval '1 month')::date and payroll_can_access_run_employee(x.id,emp,'payroll.statutory') order by x.id for update of x loop perform payroll_employee_recalculate(r.id,emp); end loop;
$after0$);

 d:=replace(d,$before1$begin
 if not payroll_can_access_employee(emp,'payroll.manage') or not payroll_can_manage_entity(entity,'payroll.manage') then raise insufficient_privilege using message='Historical PH wage authority denied'; end if;
$before1$,$after1$begin
 if not payroll_can_access_employee(emp,'payroll.statutory') or not payroll_can_manage_entity(entity,'payroll.statutory') then raise insufficient_privilege using message='Historical PH wage authority denied'; end if;
$after1$);

 execute d; end $patch$;

do $patch$ declare d text:=pg_get_functiondef('public.payroll_ph_work_confirm(uuid,uuid,date,text,text,uuid,text)'::regprocedure); begin
 if md5(d)<>'2b9d4a6e6559ffff22bb931a6048e3db' then raise exception 'Payroll authority definition drift: payroll_ph_work_confirm'; end if;

 d:=replace(d,$before0$ select * into p from public.payroll_periods where id=r.period_id;
 if not public.payroll_can_manage_entity(p.legal_entity_id,'payroll.manage') or not exists
$before0$,$after0$ select * into p from public.payroll_periods where id=r.period_id;
 if not public.payroll_can_manage_entity(p.legal_entity_id,'payroll.treat_ph') or not exists
$after0$);

 execute d; end $patch$;

do $patch$ declare d text:=pg_get_functiondef('public.payroll_profile_create(uuid,date,text,numeric,text,text,uuid,uuid,boolean,boolean,boolean,boolean)'::regprocedure); begin
 if md5(d)<>'5566dbb191d91c9aab199cb4d8c97c1f' then raise exception 'Payroll authority definition drift: payroll_profile_create'; end if;

 d:=replace(d,$before0$    raise exception using errcode='42501',message='Payroll profile scope denied.';
  end if;
$before0$,$after0$    raise exception using errcode='42501',message='Payroll profile scope denied.';
  end if;
  if (p_epf is not null or p_socso is not null or p_eis is not null or p_pcb is not null) and not public.payroll_can_access_employee(p_employee_id,'payroll.statutory') then raise insufficient_privilege using message='Statutory setup authority required.'; end if;
$after0$);

 d:=replace(d,$before1$begin
  if not public.payroll_can_access_employee(p_employee_id,'payroll.manage') then
$before1$,$after1$begin
  if not public.payroll_can_access_employee(p_employee_id,'payroll.setup') then
$after1$);

 execute d; end $patch$;

do $patch$ declare d text:=pg_get_functiondef('public.payroll_recurring_adjust(uuid,uuid,date,numeric,boolean,text)'::regprocedure); begin
 if md5(d)<>'fc6430f449ffabaf2de7811f02b1356b' then raise exception 'Payroll authority definition drift: payroll_recurring_adjust'; end if;

 d:=replace(d,$before0$  select * into v_profile from public.payroll_profiles where id=p_profile_id for update;
  if v_profile.id is null or not public.payroll_can_access_employee(v_profile.employee_id,'payroll.manage') then
$before0$,$after0$  select * into v_profile from public.payroll_profiles where id=p_profile_id for update;
  if v_profile.id is null or not public.payroll_can_access_employee(v_profile.employee_id,'payroll.setup') then
$after0$);

 execute d; end $patch$;

do $patch$ declare d text:=pg_get_functiondef('public.payroll_rule_publish(text,text,date,numeric,integer,text,text)'::regprocedure); begin
 if md5(d)<>'0de6d3f533c1f49c605893c71021b0eb' then raise exception 'Payroll authority definition drift: payroll_rule_publish'; end if;

 d:=replace(d,$before0$begin
  if not public.current_user_has_permission('payroll.manage')
$before0$,$after0$begin
  if not public.current_user_has_permission('payroll.configure')
$after0$);

 execute d; end $patch$;

do $patch$ declare d text:=pg_get_functiondef('public.payroll_run_calculate_core(uuid,uuid)'::regprocedure); begin
 if md5(d)<>'5efd06a216b67fd800f424cbcf725f06' then raise exception 'Payroll authority definition drift: payroll_run_calculate_core'; end if;

 d:=replace(d,$before0$  select * into v_period from public.payroll_periods where id=v_run.period_id;
  if not public.payroll_can_manage_entity(v_period.legal_entity_id,'payroll.manage') then
$before0$,$after0$  select * into v_period from public.payroll_periods where id=v_run.period_id;
  if not public.payroll_can_recalculate_entity(v_period.legal_entity_id) then
$after0$);

 execute d; end $patch$;

do $patch$ declare d text:=pg_get_functiondef('public.payroll_run_component_add(uuid,uuid,uuid,uuid,numeric,text)'::regprocedure); begin
 if md5(d)<>'997fc6a244327cfe0b6522f7ada7636a' then raise exception 'Payroll authority definition drift: payroll_run_component_add'; end if;

 d:=replace(d,$before0$  select * into v_period from public.payroll_periods where id=v_run.period_id;
  if not public.payroll_can_manage_entity(v_period.legal_entity_id,'payroll.manage')
    or not public.payroll_can_access_run_employee(p_run_id,p_employee_id,'payroll.manage') then
$before0$,$after0$  select * into v_period from public.payroll_periods where id=v_run.period_id;
  if not public.payroll_can_manage_entity(v_period.legal_entity_id,'payroll.adjust')
    or not public.payroll_can_access_run_employee(p_run_id,p_employee_id,'payroll.adjust') then
$after0$);

 execute d; end $patch$;

do $patch$ declare d text:=pg_get_functiondef('public.payroll_run_component_reverse(uuid,uuid,text)'::regprocedure); begin
 if md5(d)<>'4d7c4d8d3f42d08274015eb42b84b5f6' then raise exception 'Payroll authority definition drift: payroll_run_component_reverse'; end if;

 d:=replace(d,$before0$  select * into v_period from public.payroll_periods where id=v_run.period_id;
  if not public.payroll_can_manage_entity(v_period.legal_entity_id,'payroll.manage')
    or not public.payroll_can_access_run_employee(v_source.run_id,v_source.employee_id,'payroll.manage') then
$before0$,$after0$  select * into v_period from public.payroll_periods where id=v_run.period_id;
  if not public.payroll_can_manage_entity(v_period.legal_entity_id,'payroll.adjust')
    or not public.payroll_can_access_run_employee(v_source.run_id,v_source.employee_id,'payroll.adjust') then
$after0$);

 execute d; end $patch$;

do $patch$ declare d text:=pg_get_functiondef('public.payroll_run_create(uuid,date,date,text,uuid)'::regprocedure); begin
 if md5(d)<>'cb7cb316991076f4a82c4b64ec24cb15' then raise exception 'Payroll authority definition drift: payroll_run_create'; end if;

 d:=replace(d,$before0$begin
  if not public.payroll_can_manage_entity(p_legal_entity_id,'payroll.manage') then
$before0$,$after0$begin
  if not public.payroll_can_manage_entity(p_legal_entity_id,'payroll.prepare') then
$after0$);

 execute d; end $patch$;

do $patch$ declare d text:=pg_get_functiondef('public.payroll_run_pcb_confirm(uuid,uuid,uuid,numeric,text,text,text)'::regprocedure); begin
 if md5(d)<>'173ef2c7b666a08d85569c3a57d22167' then raise exception 'Payroll authority definition drift: payroll_run_pcb_confirm'; end if;

 d:=replace(d,$before0$  select * into v_period from public.payroll_periods where id=v_run.period_id;
  if not public.payroll_can_manage_entity(v_period.legal_entity_id,'payroll.manage')
    or not public.payroll_can_access_run_employee(p_run_id,p_employee_id,'payroll.manage') then
$before0$,$after0$  select * into v_period from public.payroll_periods where id=v_run.period_id;
  if not public.payroll_can_manage_entity(v_period.legal_entity_id,'payroll.statutory')
    or not public.payroll_can_access_run_employee(p_run_id,p_employee_id,'payroll.statutory') then
$after0$);

 execute d; end $patch$;

do $patch$ declare d text:=pg_get_functiondef('public.payroll_run_statutory_calculate_core(uuid,uuid)'::regprocedure); begin
 if md5(d)<>'a579446f003d1ad79c6ff3444c481955' then raise exception 'Payroll authority definition drift: payroll_run_statutory_calculate_core'; end if;

 d:=replace(d,$before0$  select * into v_period from public.payroll_periods where id=v_run.period_id;
  if not public.payroll_can_manage_entity(v_period.legal_entity_id,'payroll.manage') then
$before0$,$after0$  select * into v_period from public.payroll_periods where id=v_run.period_id;
  if not public.payroll_can_recalculate_entity(v_period.legal_entity_id) then
$after0$);

 execute d; end $patch$;

do $patch$ declare d text:=pg_get_functiondef('public.payroll_run_transition(uuid,text,text)'::regprocedure); begin
 if md5(d)<>'937b0ca547e9971855321a924ffe1b53' then raise exception 'Payroll authority definition drift: payroll_run_transition'; end if;

 d:=replace(d,$before0$  if not public.payroll_can_manage_entity(v_period.legal_entity_id,
    case when p_next_status='finalized' then 'payroll.finalize' else 'payroll.manage' end) then
$before0$,$after0$  if not public.payroll_can_manage_entity(v_period.legal_entity_id,
    case when p_next_status='finalized' then 'payroll.finalize' else 'payroll.prepare' end) then
$after0$);

 execute d; end $patch$;

do $patch$ declare d text:=pg_get_functiondef('public.payroll_statutory_adjust(uuid,date,boolean,boolean,boolean,boolean,text)'::regprocedure); begin
 if md5(d)<>'8707253f77560a367171b0d40e3b2fd9' then raise exception 'Payroll authority definition drift: payroll_statutory_adjust'; end if;

 d:=replace(d,$before0$  select * into v_profile from public.payroll_profiles where id=p_profile_id for update;
  if v_profile.id is null or not public.payroll_can_access_employee(v_profile.employee_id,'payroll.manage') then
$before0$,$after0$  select * into v_profile from public.payroll_profiles where id=p_profile_id for update;
  if v_profile.id is null or not public.payroll_can_access_employee(v_profile.employee_id,'payroll.statutory') then
$after0$);

 execute d; end $patch$;

do $patch$ declare d text:=pg_get_functiondef('public.payroll_statutory_input_adjust(uuid,date,text,text,text,jsonb,text,text)'::regprocedure); begin
 if md5(d)<>'2339b7965804caf4d0a213250575100d' then raise exception 'Payroll authority definition drift: payroll_statutory_input_adjust'; end if;

 d:=replace(d,$before0$  select * into v_profile from public.payroll_profiles where id=p_profile_id for update;
  if v_profile.id is null or not public.payroll_can_access_employee(v_profile.employee_id,'payroll.manage') then
$before0$,$after0$  select * into v_profile from public.payroll_profiles where id=p_profile_id for update;
  if v_profile.id is null or not public.payroll_can_access_employee(v_profile.employee_id,'payroll.statutory') then
$after0$);

 execute d; end $patch$;

do $patch$ declare d text:=pg_get_functiondef('public.payroll_statutory_setup_confirm(uuid,date,jsonb,jsonb,text,text,text)'::regprocedure); begin
 if md5(d)<>'ab1d211578c2654112c8d9e23c1c5ba0' then raise exception 'Payroll authority definition drift: payroll_statutory_setup_confirm'; end if;

 d:=replace(d,$before0$ select employee_id into employee from public.payroll_profiles where id=p_profile_id for update;
 if employee is null or not public.payroll_can_access_employee(employee,'payroll.manage') then
$before0$,$after0$ select employee_id into employee from public.payroll_profiles where id=p_profile_id for update;
 if employee is null or not public.payroll_can_access_employee(employee,'payroll.statutory') then
$after0$);

 execute d; end $patch$;

do $patch$ declare d text:=pg_get_functiondef('public.payroll_statutory_setup_confirm(uuid,date,jsonb,jsonb,text,text,text,jsonb,text,uuid)'::regprocedure); begin
 if md5(d)<>'63a8abc93685f34214917283491876d2' then raise exception 'Payroll authority definition drift: payroll_statutory_setup_confirm'; end if;

 d:=replace(d,$before0$ select employee.* into e from public.payroll_profiles p join public.employees employee on employee.id=p.employee_id where p.id=p_profile_id for update of p;
 if e.id is null or not public.payroll_can_access_employee(e.id,'payroll.manage') then
$before0$,$after0$ select employee.* into e from public.payroll_profiles p join public.employees employee on employee.id=p.employee_id where p.id=p_profile_id for update of p;
 if e.id is null or not public.payroll_can_access_employee(e.id,'payroll.statutory') then
$after0$);

 execute d; end $patch$;

do $patch$ declare d text:=pg_get_functiondef('public.payroll_time_decide(uuid,text,integer,integer,text,text)'::regprocedure); begin
 if md5(d)<>'5badd07972d386d49525762927998429' then raise exception 'Payroll authority definition drift: payroll_time_decide'; end if;

 d:=replace(d,$before0$  if v_current.id is null then raise exception using errcode='P0002',message='Payable time not found.'; end if;
  if not public.payroll_can_access_employee(v_current.employee_id,'payroll.manage') then
$before0$,$after0$  if v_current.id is null then raise exception using errcode='P0002',message='Payable time not found.'; end if;
  if not public.payroll_can_access_employee(v_current.employee_id,'payroll.review_time') then
$after0$);

 execute d; end $patch$;

do $patch$ declare d text:=pg_get_functiondef('public.payroll_time_decision_save(jsonb)'::regprocedure); begin
 if md5(d)<>'6ea0c74ba0c4cb5d54d6253534dcda69' then raise exception 'Payroll authority definition drift: payroll_time_decision_save'; end if;

 d:=replace(d,$before0$  or t.evidence->>'legal_entity_id' is distinct from p.legal_entity_id::text
  or not public.payroll_can_access_run_employee(r.id,t.employee_id,'payroll.manage') then
$before0$,$after0$  or t.evidence->>'legal_entity_id' is distinct from p.legal_entity_id::text
  or not public.payroll_can_access_run_employee(r.id,t.employee_id,'payroll.review_time') then
$after0$);

 execute d; end $patch$;

do $patch$ declare d text:=pg_get_functiondef('public.payroll_time_decision_status(jsonb)'::regprocedure); begin
 if md5(d)<>'a72c0c8c4a6bc004a84d9502216290b7' then raise exception 'Payroll authority definition drift: payroll_time_decision_status'; end if;

 d:=replace(d,$before0$ select * into t from payroll_payable_time_versions where id=(p_input->>'time_version_id')::uuid;
 if t.id is null or not payroll_can_access_run_employee((p_input->>'run_id')::uuid,t.employee_id,'payroll.manage') then
$before0$,$after0$ select * into t from payroll_payable_time_versions where id=(p_input->>'time_version_id')::uuid;
 if t.id is null or not payroll_can_access_run_employee((p_input->>'run_id')::uuid,t.employee_id,'payroll.review_time') then
$after0$);

 execute d; end $patch$;

do $patch$ declare d text:=pg_get_functiondef('public.payroll_time_reconcile(uuid,date,date)'::regprocedure); begin
 if md5(d)<>'ea5789f188680c4d91e9c7d155e85eca' then raise exception 'Payroll authority definition drift: payroll_time_reconcile'; end if;

 d:=replace(d,$before0$  for v_profile in select p.id profile_id,p.employee_id from public.payroll_profiles p
    where public.payroll_can_access_employee(p.employee_id,'payroll.manage')
$before0$,$after0$  for v_profile in select p.id profile_id,p.employee_id from public.payroll_profiles p
    where (public.payroll_can_access_employee(p.employee_id,'payroll.prepare') or public.payroll_can_access_employee(p.employee_id,'payroll.review_time'))
$after0$);

 d:=replace(d,$before1$begin
  if not public.payroll_can_manage_entity(p_legal_entity_id,'payroll.manage') then
$before1$,$after1$begin
  if not (public.payroll_can_manage_entity(p_legal_entity_id,'payroll.prepare') or public.payroll_can_manage_entity(p_legal_entity_id,'payroll.review_time')) then
$after1$);

 execute d; end $patch$;

do $patch$ declare d text:=pg_get_functiondef('public.payroll_time_source_reconcile(uuid,uuid,text)'::regprocedure); begin
 if md5(d)<>'687bcec66b3bcfab22aba3118857e693' then raise exception 'Payroll authority definition drift: payroll_time_source_reconcile'; end if;

 d:=replace(d,$before0$  or source->>'profile_id' is distinct from old.profile_id::text
  or not payroll_can_access_employee(old.employee_id,'payroll.manage') then
$before0$,$after0$  or source->>'profile_id' is distinct from old.profile_id::text
  or not payroll_can_access_employee(old.employee_id,'payroll.review_time') then
$after0$);

 d:=replace(d,$before1$  or old.evidence->>'legal_entity_id' is distinct from period.legal_entity_id::text
  or not payroll_can_access_run_employee(r.id,old.employee_id,'payroll.manage') then
$before1$,$after1$  or old.evidence->>'legal_entity_id' is distinct from period.legal_entity_id::text
  or not payroll_can_access_run_employee(r.id,old.employee_id,'payroll.review_time') then
$after1$);

 execute d; end $patch$;

do $patch$ declare d text:=pg_get_functiondef('public.payroll_additional_holiday_confirm(uuid,text,text,uuid)'::regprocedure); begin
 if md5(d)<>'dcd5aef54b0344dad3ae065bb7140b0b' then raise exception 'Payroll authority definition drift: payroll_additional_holiday_confirm'; end if;

 d:=replace(d,$before0$begin
$before0$,$after0$begin
 if not public.current_user_has_permission('payroll.publish_holidays') then raise insufficient_privilege using message='Publish Payroll Holiday Calendar authority required.'; end if;
$after0$);

 execute d; end $patch$;

do $patch$ declare d text:=pg_get_functiondef('public.payroll_holiday_calendar_retire(uuid,text)'::regprocedure); begin
 if md5(d)<>'b2c08a3ca779de6c79790f3411153abb' then raise exception 'Payroll authority definition drift: payroll_holiday_calendar_retire'; end if;

 d:=replace(d,$before0$begin
$before0$,$after0$begin
 if not public.current_user_has_permission('payroll.publish_holidays') then raise insufficient_privilege using message='Publish Payroll Holiday Calendar authority required.'; end if;
$after0$);

 execute d; end $patch$;

do $patch$ declare d text:=pg_get_functiondef('public.payroll_holiday_calendar_save(integer,jsonb,text,boolean,boolean,uuid,uuid)'::regprocedure); begin
 if md5(d)<>'66eac4f98cbe7cb70238e5e55f7073ee' then raise exception 'Payroll authority definition drift: payroll_holiday_calendar_save'; end if;

 d:=replace(d,$before0$begin
$before0$,$after0$begin
 if p_publish and not public.current_user_has_permission('payroll.publish_holidays') then raise insufficient_privilege using message='Publish Payroll Holiday Calendar authority required.'; end if;
$after0$);

 execute d; end $patch$;

do $patch$ declare d text:=pg_get_functiondef('public.payroll_holiday_candidate_publish(uuid,integer)'::regprocedure); begin
 if md5(d)<>'88a0100391db6289853279630f119174' then raise exception 'Payroll authority definition drift: payroll_holiday_candidate_publish'; end if;

 d:=replace(d,$before0$begin
$before0$,$after0$begin
 if not public.current_user_has_permission('payroll.publish_holidays') then raise insufficient_privilege using message='Publish Payroll Holiday Calendar authority required.'; end if;
$after0$);

 execute d; end $patch$;

do $patch$ declare d text:=pg_get_functiondef('public.payroll_holiday_import(integer,jsonb,boolean,uuid,uuid)'::regprocedure); begin
 if md5(d)<>'2e1479832bf019bb6c88c16ab9d7a496' then raise exception 'Payroll authority definition drift: payroll_holiday_import'; end if;

 d:=replace(d,$before0$begin
$before0$,$after0$begin
 if p_publish and not public.current_user_has_permission('payroll.publish_holidays') then raise insufficient_privilege using message='Publish Payroll Holiday Calendar authority required.'; end if;
$after0$);

 execute d; end $patch$;

do $patch$ declare d text:=pg_get_functiondef('public.payroll_holiday_operation_publish(jsonb)'::regprocedure); begin
 if md5(d)<>'144d309bc770cfec5f2f94176402021d' then raise exception 'Payroll authority definition drift: payroll_holiday_operation_publish'; end if;

 d:=replace(d,$before0$begin
$before0$,$after0$begin
 if not public.current_user_has_permission('payroll.publish_holidays') then raise insufficient_privilege using message='Publish Payroll Holiday Calendar authority required.'; end if;
$after0$);

 execute d; end $patch$;

do $patch$ declare d text:=pg_get_functiondef('public.payroll_paid_holiday_default_save(uuid,uuid[],uuid,uuid)'::regprocedure); begin
 if md5(d)<>'a03dc93daf18d55fee3a4e1a46ce0c38' then raise exception 'Payroll authority definition drift: payroll_paid_holiday_default_save'; end if;

 d:=replace(d,$before0$begin
$before0$,$after0$begin
 if not public.current_user_has_permission('payroll.publish_holidays') then raise insufficient_privilege using message='Publish Payroll Holiday Calendar authority required.'; end if;
$after0$);

 execute d; end $patch$;

do $patch$ declare d text:=pg_get_functiondef('public.payroll_paid_holiday_policy_save(text,uuid,uuid[],uuid[],uuid[],text,boolean,uuid,uuid)'::regprocedure); begin
 if md5(d)<>'df8d95d4e8dd1753f94127727ed101aa' then raise exception 'Payroll authority definition drift: payroll_paid_holiday_policy_save'; end if;

 d:=replace(d,$before0$begin
$before0$,$after0$begin
 if p_publish and not public.current_user_has_permission('payroll.publish_holidays') then raise insufficient_privilege using message='Publish Payroll Holiday Calendar authority required.'; end if;
$after0$);

 execute d; end $patch$;

do $patch$ declare d text:=pg_get_functiondef('public.payroll_ph_default_policy_save(date,text,text)'::regprocedure); begin
 if md5(d)<>'fcfa5cb0f743c709d3580d873f4208ff' then raise exception 'Payroll authority definition drift: payroll_ph_default_policy_save'; end if;

 d:=replace(d,$before0$begin
$before0$,$after0$begin
 if not public.current_user_has_permission('payroll.configure') or not public.current_user_has_all_outlet_access() or not exists(select 1 from public.employees e join public.roles r on r.id=e.role_id where e.id=a and lower(r.name) in ('owner','admin')) then raise insufficient_privilege using message='Default PH policy configuration authority required.'; end if;
$after0$);

 d:=replace(d,$before1$AS $function$
declare a uuid:=public.payroll_holiday_settings_actor(); le record; ids jsonb:='[]';
$before1$,$after1$AS $function$
declare a uuid:=public.payroll_admin_actor(); le record; ids jsonb:='[]';
$after1$);

 execute d; end $patch$;

do $patch$ declare d text:=pg_get_functiondef('public.save_role_configuration(uuid,jsonb,text[],uuid[])'::regprocedure); begin
 if md5(d)<>'c0d1aa5c3af9c374de11b2d7861f9882' then raise exception 'Payroll authority definition drift: save_role_configuration'; end if;

 d:=replace(d,$before0$    raise exception 'Role configuration contains duplicate permissions or outlets.';
  end if;

$before0$,$after0$    raise exception 'Role configuration contains duplicate permissions or outlets.';
  end if;

  if 'payroll.manage'=any(v_permissions) then raise exception using errcode='22023',message='Payroll Manage is retired. Select the Payroll workflow permissions.'; end if;
$after0$);

 execute d; end $patch$;

notify pgrst, 'reload schema';
commit;
