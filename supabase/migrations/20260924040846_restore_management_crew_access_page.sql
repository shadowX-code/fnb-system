-- The Inventory gateway extended the row payload but accidentally replaced the
-- workplace-scoped read introduced by 20260923100000. Keep both contracts.
create or replace function public.crew_access_admin_page(
  p_outlet_id uuid, p_filters jsonb default '{}'::jsonb,
  p_page integer default 1, p_page_size integer default 20
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_query text := btrim(coalesce(p_filters->>'query', ''));
  v_status text := nullif(btrim(coalesce(p_filters->>'employment_status', '')), '');
  v_scope text := btrim(coalesce(p_filters->>'workplace_scope', ''));
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_size integer := case when p_page_size in (20, 50, 100) then p_page_size else 20 end;
  v_total integer;
  v_rows jsonb;
  v_summary jsonb;
begin
  if not (public.current_user_has_permission('crew_employees.view')
    or public.current_user_has_permission('crew_employees.manage')) then
    raise exception using errcode = '42501', message = 'Missing permission to view Crew Access.';
  end if;
  if v_scope = 'management' then
    if p_outlet_id is not null or not public.current_user_has_all_outlet_access() then
      raise exception using errcode = '42501', message = 'You cannot view Management Crew Access.';
    end if;
  elsif v_scope <> '' or p_outlet_id is null or not public.current_user_can_access_outlet(p_outlet_id) then
    raise exception using errcode = '42501', message = 'You cannot view Crew Access outside your outlet scope.';
  end if;

  with source as (
    select e.*, ca.employee_id as access_employee_id,
      ca.mobile_number as crew_mobile_number,
      ca.access_state as crew_access_state,
      ca.activated_at as crew_activated_at,
      ca.disabled_at as crew_disabled_at,
      ca.locked_until as crew_locked_until,
      ca.last_login_at as crew_last_login_at,
      ca.primary_outlet_id as crew_primary_outlet_id,
      ca.can_initiate_handover as crew_can_initiate_handover,
      ca.can_add_assets as crew_can_add_assets,
      ca.can_manage_asset_details as crew_can_manage_asset_details,
      ca.can_adjust_assets as crew_can_adjust_assets,
      ca.can_perform_asset_inspections as crew_can_perform_asset_inspections,
      ca.can_perform_stock_check as crew_can_perform_stock_check,
      ca.can_create_audit_stock_check as crew_can_create_audit_stock_check,
      ca.can_manage_purchase_orders as crew_can_manage_purchase_orders,
      ca.can_receive_purchase_orders as crew_can_receive_purchase_orders,
      case when r.is_active then r.outlet_access_type else 'none' end as role_outlet_type,
      case when r.is_active and r.outlet_access_type = 'selected' then
        (select count(*) from public.role_outlets ro
          join public.outlets o on o.id = ro.outlet_id
          where ro.role_id = r.id and o.is_active) else 0 end as role_outlet_count
    from public.employees e
    left join public.crew_access ca on ca.employee_id = e.id
    left join public.roles r on r.id = e.role_id
    where (v_scope = 'management' and lower(btrim(coalesce(e.workplace, ''))) = 'management')
      or (v_scope = '' and lower(btrim(coalesce(e.workplace, ''))) <> 'management'
        and public.crew_resolve_employee_outlet(e.id) = p_outlet_id)
  ), filtered as (
    select * from source
    where (v_query = '' or concat_ws(' ', full_name, employee_code, position, workplace) ilike '%' || v_query || '%')
      and (v_status is null or v_status = 'all' or coalesce(employment_status, 'active') = v_status)
  ), page_rows as (
    select * from filtered order by full_name, id offset (v_page - 1) * v_size limit v_size
  )
  select
    (select count(*) from filtered),
    (select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'full_name', full_name, 'employee_code', employee_code,
      'position', position, 'workplace', workplace, 'contact', contact,
      'employment_type', employment_type, 'employment_status', employment_status,
      'is_active', is_active,
      'role_outlet_access', jsonb_build_object(
        'type', coalesce(role_outlet_type, 'none'), 'count', role_outlet_count),
      'crew_access', case when access_employee_id is null then null else jsonb_build_object(
        'employee_id', access_employee_id, 'mobile_number', crew_mobile_number,
        'access_state', crew_access_state, 'activated_at', crew_activated_at,
        'disabled_at', crew_disabled_at, 'locked_until', crew_locked_until,
        'last_login_at', crew_last_login_at, 'primary_outlet_id', crew_primary_outlet_id,
        'can_initiate_handover', crew_can_initiate_handover,
        'can_add_assets', crew_can_add_assets,
        'can_manage_asset_details', crew_can_manage_asset_details,
        'can_adjust_assets', crew_can_adjust_assets,
        'can_perform_asset_inspections', crew_can_perform_asset_inspections,
        'can_perform_stock_check', crew_can_perform_stock_check,
        'can_create_audit_stock_check', crew_can_create_audit_stock_check,
        'can_manage_purchase_orders', crew_can_manage_purchase_orders,
        'can_receive_purchase_orders', crew_can_receive_purchase_orders) end)
      order by full_name, id), '[]'::jsonb) from page_rows),
    (select jsonb_build_object(
      'active', count(*) filter (where coalesce(crew_access_state, 'not_enabled') = 'active'),
      'locked', count(*) filter (where coalesce(crew_access_state, 'not_enabled') = 'locked'),
      'not_enabled', count(*) filter (where coalesce(crew_access_state, 'not_enabled') = 'not_enabled')) from source)
  into v_total, v_rows, v_summary;

  return jsonb_build_object('rows', v_rows, 'total_count', v_total,
    'page', v_page, 'page_size', v_size, 'summary', coalesce(v_summary, '{}'::jsonb));
end;
$$;

revoke all on function public.crew_access_admin_page(uuid, jsonb, integer, integer) from public, anon, authenticated;
grant execute on function public.crew_access_admin_page(uuid, jsonb, integer, integer) to authenticated;
