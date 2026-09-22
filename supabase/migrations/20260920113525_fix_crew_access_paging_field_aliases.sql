-- Complete the field qualification fix for the previously deployed projection.
create or replace function public.crew_access_admin_page(
  p_outlet_id uuid,
  p_filters jsonb default '{}'::jsonb,
  p_page integer default 1,
  p_page_size integer default 20
)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  v_query text := btrim(coalesce(p_filters->>'query', ''));
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_size integer := case when p_page_size in (20, 50, 100) then p_page_size else 20 end;
  v_total integer;
  v_rows jsonb;
  v_summary jsonb;
begin
  if p_outlet_id is null or not (public.current_user_has_permission('crew_employees.view') or public.current_user_has_permission('crew_employees.manage')) then
    raise exception using errcode='42501', message='Missing permission to view Crew Access.';
  end if;
  if not public.current_user_can_access_outlet(p_outlet_id) then
    raise exception using errcode='42501', message='You cannot view Crew Access outside your outlet scope.';
  end if;

  with source as (
    select e.*, ca.employee_id as access_employee_id, ca.mobile_number as crew_mobile_number, ca.access_state as crew_access_state, ca.activated_at as crew_activated_at, ca.disabled_at as crew_disabled_at, ca.locked_until as crew_locked_until, ca.last_login_at as crew_last_login_at, ca.primary_outlet_id as crew_primary_outlet_id, ca.can_initiate_handover as crew_can_initiate_handover, ca.can_add_assets as crew_can_add_assets, ca.can_manage_asset_details as crew_can_manage_asset_details, ca.can_adjust_assets as crew_can_adjust_assets, ca.can_perform_asset_inspections as crew_can_perform_asset_inspections
    from public.employees e left join public.crew_access ca on ca.employee_id=e.id
    where public.crew_resolve_employee_outlet(e.id)=p_outlet_id
  ), filtered as (
    select * from source where v_query='' or concat_ws(' ', full_name, employee_code, position, workplace) ilike '%' || v_query || '%'
  ) select count(*) into v_total from filtered;

  with source as (
    select e.*, ca.employee_id as access_employee_id, ca.mobile_number as crew_mobile_number, ca.access_state as crew_access_state, ca.activated_at as crew_activated_at, ca.disabled_at as crew_disabled_at, ca.locked_until as crew_locked_until, ca.last_login_at as crew_last_login_at, ca.primary_outlet_id as crew_primary_outlet_id, ca.can_initiate_handover as crew_can_initiate_handover, ca.can_add_assets as crew_can_add_assets, ca.can_manage_asset_details as crew_can_manage_asset_details, ca.can_adjust_assets as crew_can_adjust_assets, ca.can_perform_asset_inspections as crew_can_perform_asset_inspections
    from public.employees e left join public.crew_access ca on ca.employee_id=e.id
    where public.crew_resolve_employee_outlet(e.id)=p_outlet_id
  ), filtered as (
    select * from source where v_query='' or concat_ws(' ', full_name, employee_code, position, workplace) ilike '%' || v_query || '%'
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'full_name', full_name, 'employee_code', employee_code, 'position', position, 'workplace', workplace, 'contact', contact,
    'employment_type', employment_type, 'employment_status', employment_status, 'is_active', is_active,
    'crew_access', case when access_employee_id is null then null else jsonb_build_object(
      'employee_id', access_employee_id, 'mobile_number', crew_mobile_number, 'access_state', crew_access_state, 'activated_at', crew_activated_at,
      'disabled_at', crew_disabled_at, 'locked_until', crew_locked_until, 'last_login_at', crew_last_login_at, 'primary_outlet_id', crew_primary_outlet_id,
      'can_initiate_handover', crew_can_initiate_handover, 'can_add_assets', crew_can_add_assets, 'can_manage_asset_details', crew_can_manage_asset_details,
      'can_adjust_assets', crew_can_adjust_assets, 'can_perform_asset_inspections', crew_can_perform_asset_inspections
    ) end
  ) order by full_name, id), '[]'::jsonb) into v_rows
  from (select * from filtered order by full_name, id offset (v_page - 1) * v_size limit v_size) page_rows;

  with source as (
    select coalesce(ca.access_state, 'not_enabled') as crew_access_state
    from public.employees e left join public.crew_access ca on ca.employee_id=e.id
    where public.crew_resolve_employee_outlet(e.id)=p_outlet_id
  ) select jsonb_build_object(
    'active', count(*) filter (where crew_access_state='active'),
    'locked', count(*) filter (where crew_access_state='locked'),
    'not_enabled', count(*) filter (where crew_access_state='not_enabled')
  ) into v_summary from source;

  return jsonb_build_object('rows', v_rows, 'total_count', v_total, 'page', v_page, 'page_size', v_size, 'summary', coalesce(v_summary, '{}'::jsonb));
end;
$$;
