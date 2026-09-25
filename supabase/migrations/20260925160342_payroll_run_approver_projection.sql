-- Keep finalized-run actor identity in the authorized Payroll read projection.
-- The actor may be outside the selected Legal Entity's employee candidate list.
create or replace function public.payroll_foundation_read(p_profile_id uuid default null,p_period_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_profiles jsonb; v_candidates jsonb; v_entities jsonb; v_components jsonb; v_holidays jsonb; v_periods jsonb;
begin
  perform public.payroll_admin_actor();
  if not public.current_user_has_permission('payroll.view') then
    raise exception using errcode='42501',message='Payroll view permission required.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',p.id,'employee_id',e.id,'employee_name',e.full_name,'employee_code',e.employee_code,
    'workplace',e.workplace,'employment_type',e.employment_type,'employment_status',e.employment_status,
    'legal_entity_id',e.legal_entity_id,
    'compensation',coalesce((select jsonb_agg(to_jsonb(v) order by v.effective_from desc) from public.payroll_compensation_versions v where v.profile_id=p.id),'[]'::jsonb),
    'statutory',coalesce((select jsonb_agg(to_jsonb(s) order by s.effective_from desc) from public.payroll_statutory_profile_versions s where s.profile_id=p.id),'[]'::jsonb),
    'recurring',coalesce((select jsonb_agg(to_jsonb(c) order by c.effective_from desc) from public.payroll_recurring_component_versions c where c.profile_id=p.id),'[]'::jsonb)
  ) order by e.full_name),'[]'::jsonb) into v_profiles
  from public.payroll_profiles p join public.employees e on e.id=p.employee_id
  where (p_profile_id is null or p.id=p_profile_id)
    and public.payroll_can_access_employee(e.id,'payroll.view');

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',e.id,'name',e.full_name,'employee_code',e.employee_code,
    'legal_entity_id',e.legal_entity_id,'workplace',e.workplace,
    'employment_type',e.employment_type,'employment_status',e.employment_status)
    order by e.full_name),'[]'::jsonb) into v_candidates
  from public.employees e
  where e.legal_entity_id is not null
    and public.payroll_can_access_employee(e.id,'payroll.view');

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',le.id,'name',le.legal_company_name,'display_name',le.display_name,'is_active',le.is_active)
    order by le.legal_company_name),'[]'::jsonb) into v_entities
  from public.legal_entities le
  where public.payroll_can_manage_entity(le.id,'payroll.view')
    or exists(select 1 from public.employees e where e.legal_entity_id=le.id
      and public.payroll_can_access_employee(e.id,'payroll.view'));

  select coalesce(jsonb_agg(to_jsonb(c) order by c.name),'[]'::jsonb) into v_components
  from public.payroll_component_definitions c;
  select coalesce(jsonb_agg(to_jsonb(h) order by h.holiday_date desc,h.name),'[]'::jsonb) into v_holidays
  from public.payroll_public_holidays h
  where public.payroll_can_manage_entity(h.legal_entity_id,'payroll.view')
    or (h.legal_entity_id is null and public.current_user_has_all_outlet_access());
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',p.id,'legal_entity_id',p.legal_entity_id,'period_start',p.period_start,'period_end',p.period_end,
    'current_finalized_run_id',p.current_finalized_run_id,
    'runs',coalesce((select jsonb_agg(
      to_jsonb(r) || jsonb_build_object('finalized_by_name', actor.full_name)
      order by r.revision desc)
      from public.payroll_runs r
      left join public.employees actor on actor.id=r.finalized_by_employee_id
      where r.period_id=p.id),'[]'::jsonb))
    order by p.period_start desc),'[]'::jsonb) into v_periods
  from public.payroll_periods p
  where (p_period_id is null or p.id=p_period_id)
    and public.payroll_can_manage_entity(p.legal_entity_id,'payroll.view');
  return jsonb_build_object('profiles',v_profiles,'employees',v_candidates,'legal_entities',v_entities,
    'components',v_components,'holidays',v_holidays,'periods',v_periods);
end; $$;

revoke all on function public.payroll_foundation_read(uuid,uuid) from public,anon;
grant execute on function public.payroll_foundation_read(uuid,uuid) to authenticated;
