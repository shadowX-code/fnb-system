-- Preserve legacy company-specific holiday codes while restricting new shared
-- geography to the canonical 16 Malaysian state/federal-territory codes.
alter table public.outlets add constraint outlets_state_code_known_check
  check (state_code is null or state_code ~ '^MY-(0[1-9]|1[0-6])$');
alter table public.payroll_outlet_state_versions add constraint payroll_outlet_state_code_known_check
  check (state_code is null or state_code ~ '^MY-(0[1-9]|1[0-6])$');
alter table public.payroll_public_holidays add constraint payroll_shared_holiday_state_known_check
  check (legal_entity_id is not null or state_code is null or state_code ~ '^MY-(0[1-9]|1[0-6])$');

-- Legacy company-specific definitions must never be presented as applying to
-- employees of another Legal Entity in the scoped applicability preview.
create or replace function public.payroll_holiday_applicability_read(p_holiday_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_holiday public.payroll_public_holidays%rowtype; v_outlets jsonb; v_entities jsonb;
begin
  perform public.payroll_admin_actor();
  if not public.current_user_has_permission('payroll.view') then
    raise exception using errcode='42501',message='Payroll view permission required.';
  end if;
  select * into v_holiday from public.payroll_public_holidays where id=p_holiday_id;
  if v_holiday.id is null or (v_holiday.legal_entity_id is not null
    and not public.payroll_can_manage_entity(v_holiday.legal_entity_id,'payroll.view')) then
    raise exception using errcode='42501',message='Holiday is outside Payroll scope.';
  end if;
  with applicable as (
    select o.id,o.name from public.outlets o
    where public.current_user_can_access_outlet(o.id)
      and (v_holiday.legal_entity_id is null or exists(select 1 from public.employees e
        where e.legal_entity_id=v_holiday.legal_entity_id
          and public.crew_resolve_employee_outlet(e.id)=o.id
          and public.payroll_can_access_employee(e.id,'payroll.view')))
      and (v_holiday.scope='national'
        or (v_holiday.scope='outlet' and v_holiday.outlet_id=o.id)
        or (v_holiday.scope='state' and v_holiday.state_code=(
          select s.state_code from public.payroll_outlet_state_versions s
          where s.outlet_id=o.id and s.effective_from<=v_holiday.holiday_date
          order by s.effective_from desc,s.created_at desc limit 1)))
  )
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by name),'[]'::jsonb)
    into v_outlets from applicable;
  with applicable as (
    select o.id from public.outlets o
    where public.current_user_can_access_outlet(o.id)
      and (v_holiday.legal_entity_id is null or exists(select 1 from public.employees e
        where e.legal_entity_id=v_holiday.legal_entity_id
          and public.crew_resolve_employee_outlet(e.id)=o.id
          and public.payroll_can_access_employee(e.id,'payroll.view')))
      and (v_holiday.scope='national'
        or (v_holiday.scope='outlet' and v_holiday.outlet_id=o.id)
        or (v_holiday.scope='state' and v_holiday.state_code=(
          select s.state_code from public.payroll_outlet_state_versions s
          where s.outlet_id=o.id and s.effective_from<=v_holiday.holiday_date
          order by s.effective_from desc,s.created_at desc limit 1)))
  )
  select coalesce(jsonb_agg(jsonb_build_object('id',le.id,'name',coalesce(le.display_name,le.legal_company_name)) order by le.legal_company_name),'[]'::jsonb)
    into v_entities
  from public.legal_entities le
  where (v_holiday.legal_entity_id is null or le.id=v_holiday.legal_entity_id)
    and exists(select 1 from public.employees e
      where e.legal_entity_id=le.id and public.payroll_can_access_employee(e.id,'payroll.view')
        and public.crew_resolve_employee_outlet(e.id) in (select id from applicable));
  return jsonb_build_object('outlets',v_outlets,'legal_entities',v_entities);
end; $$;
