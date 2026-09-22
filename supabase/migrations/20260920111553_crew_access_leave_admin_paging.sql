-- Server-paged Crew Access and Leave Admin projections. Keep filtering and
-- totals in the authority so growing outlet data never becomes a client list.
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
    from public.employees e
    left join public.crew_access ca on ca.employee_id=e.id
    where public.crew_resolve_employee_outlet(e.id)=p_outlet_id
  ), filtered as (
    select * from source
    where v_query='' or concat_ws(' ', full_name, employee_code, position, workplace) ilike '%' || v_query || '%'
  )
  select count(*) into v_total from filtered;

  with source as (
    select e.*, ca.employee_id as access_employee_id, ca.mobile_number as crew_mobile_number, ca.access_state as crew_access_state, ca.activated_at as crew_activated_at, ca.disabled_at as crew_disabled_at, ca.locked_until as crew_locked_until, ca.last_login_at as crew_last_login_at, ca.primary_outlet_id as crew_primary_outlet_id, ca.can_initiate_handover as crew_can_initiate_handover, ca.can_add_assets as crew_can_add_assets, ca.can_manage_asset_details as crew_can_manage_asset_details, ca.can_adjust_assets as crew_can_adjust_assets, ca.can_perform_asset_inspections as crew_can_perform_asset_inspections
    from public.employees e
    left join public.crew_access ca on ca.employee_id=e.id
    where public.crew_resolve_employee_outlet(e.id)=p_outlet_id
  ), filtered as (
    select * from source
    where v_query='' or concat_ws(' ', full_name, employee_code, position, workplace) ilike '%' || v_query || '%'
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
    select coalesce(ca.access_state, 'not_enabled') as access_state
    from public.employees e left join public.crew_access ca on ca.employee_id=e.id
    where public.crew_resolve_employee_outlet(e.id)=p_outlet_id
  )
  select jsonb_build_object(
    'active', count(*) filter (where access_state='active'),
    'locked', count(*) filter (where access_state='locked'),
    'not_enabled', count(*) filter (where access_state='not_enabled')
  ) into v_summary from source;

  return jsonb_build_object('rows', v_rows, 'total_count', v_total, 'page', v_page, 'page_size', v_size, 'summary', coalesce(v_summary, '{}'::jsonb));
end;
$$;

create or replace function public.crew_leave_requests_admin_page(
  p_outlet_id uuid,
  p_from date default null,
  p_to date default null,
  p_filters jsonb default '{}'::jsonb,
  p_page integer default 1,
  p_page_size integer default 20
)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  v_query text := btrim(coalesce(p_filters->>'query', ''));
  v_type text := coalesce(nullif(p_filters->>'type', ''), 'all');
  v_status text := coalesce(nullif(p_filters->>'status', ''), 'all');
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_size integer := case when p_page_size in (20, 50, 100) then p_page_size else 20 end;
  v_total integer;
  v_rows jsonb;
begin
  if p_outlet_id is null or auth.uid() is null or not (public.current_user_has_permission('crew_leave.view') or public.current_user_has_permission('crew_leave_balance.view')) or not public.current_user_can_access_outlet(p_outlet_id) then
    raise exception using errcode='42501', message='Leave requests are unavailable for this outlet.';
  end if;
  if v_type not in ('all','annual','medical','unpaid','other') or v_status not in ('all','pending','approved','rejected','cancelled') then
    raise exception using errcode='22023', message='Leave request filters are invalid.';
  end if;

  with filtered as (
    select r.id
    from public.crew_leave_requests r join public.employees e on e.id=r.employee_id
    where r.employment_outlet_id=p_outlet_id
      and (p_from is null or r.end_date>=p_from) and (p_to is null or r.start_date<=p_to)
      and (v_type='all' or r.leave_type=v_type) and (v_status='all' or r.status=v_status)
      and (v_query='' or concat_ws(' ', coalesce(e.nickname,e.full_name), e.full_name, e.position) ilike '%' || v_query || '%')
  ) select count(*) into v_total from filtered;

  select coalesce(jsonb_agg(row order by priority, submitted_at desc, id desc), '[]'::jsonb) into v_rows from (
    select
      case r.status when 'pending' then 1 else 2 end as priority,
      r.submitted_at,
      r.id,
      jsonb_build_object(
        'id',r.id,'employee',jsonb_build_object('id',e.id,'name',coalesce(e.nickname,e.full_name),'position',e.position),
        'outlet',jsonb_build_object('id',o.id,'name',o.name),'leave_type',r.leave_type,'start_date',r.start_date,'end_date',r.end_date,
        'duration_type',r.duration_type,'half_day_period',r.half_day_period,'requested_days',r.requested_days,'reason',r.reason,
        'document_status',r.document_status,'status',r.status,'submitted_at',r.submitted_at,'reviewed_at',r.reviewed_at,'rejection_reason',r.rejection_reason,
        'balance_context',(select public.crew_leave_entitlement_balance(x.id,r.start_date) from public.crew_leave_entitlements x where x.employee_id=r.employee_id and x.leave_type=r.leave_type and x.period_start=date_trunc('year',r.start_date)::date),
        'roster_context',coalesce((select jsonb_agg(jsonb_build_object('date',d.d::date,'schedule',public.crew_roster_employee_day(r.employee_id,d.d::date)) order by d.d) from generate_series(r.start_date,r.end_date,interval '1 day') d(d)),'[]'::jsonb)
      ) as row
    from public.crew_leave_requests r join public.employees e on e.id=r.employee_id join public.outlets o on o.id=r.employment_outlet_id
    where r.employment_outlet_id=p_outlet_id
      and (p_from is null or r.end_date>=p_from) and (p_to is null or r.start_date<=p_to)
      and (v_type='all' or r.leave_type=v_type) and (v_status='all' or r.status=v_status)
      and (v_query='' or concat_ws(' ', coalesce(e.nickname,e.full_name), e.full_name, e.position) ilike '%' || v_query || '%')
    order by case r.status when 'pending' then 1 else 2 end, r.submitted_at desc, r.id desc
    offset (v_page - 1) * v_size limit v_size
  ) page_rows;
  return jsonb_build_object('rows',v_rows,'total_count',v_total,'page',v_page,'page_size',v_size);
end;
$$;

create or replace function public.crew_leave_balances_admin_page(
  p_outlet_id uuid,
  p_filters jsonb default '{}'::jsonb,
  p_page integer default 1,
  p_page_size integer default 20
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_query text := btrim(coalesce(p_filters->>'query', ''));
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_size integer := case when p_page_size in (20, 50, 100) then p_page_size else 20 end;
  v_total integer;
  v_rows jsonb := '[]'::jsonb;
  v_employee record;
  v_type text;
  v_entitlement uuid;
  v_balance jsonb;
  v_balances jsonb;
begin
  if p_outlet_id is null or auth.uid() is null or not (public.current_user_has_permission('crew_leave.view') or public.current_user_has_permission('crew_leave_balance.view')) or not public.current_user_can_access_outlet(p_outlet_id) then
    raise exception using errcode='42501', message='Leave balances are unavailable for this outlet.';
  end if;
  with filtered as (
    select e.id from public.employees e
    where public.crew_resolve_employee_outlet(e.id)=p_outlet_id
      and coalesce(e.is_active,true) and coalesce(e.employment_status,'') not in ('resigned','terminated')
      and (v_query='' or concat_ws(' ', coalesce(e.nickname,e.full_name), e.full_name, e.position) ilike '%' || v_query || '%')
  ) select count(*) into v_total from filtered;

  for v_employee in
    select e.id, coalesce(e.nickname,e.full_name) as name, e.position
    from public.employees e
    where public.crew_resolve_employee_outlet(e.id)=p_outlet_id
      and coalesce(e.is_active,true) and coalesce(e.employment_status,'') not in ('resigned','terminated')
      and (v_query='' or concat_ws(' ', coalesce(e.nickname,e.full_name), e.full_name, e.position) ilike '%' || v_query || '%')
    order by coalesce(e.nickname,e.full_name), e.id offset (v_page - 1) * v_size limit v_size
  loop
    v_balances := '{}'::jsonb;
    foreach v_type in array array['annual','medical','unpaid','other'] loop
      v_entitlement := public.crew_leave_ensure_entitlement(v_employee.id,v_type,date_trunc('year',timezone('Asia/Kuala_Lumpur',now()))::date,p_outlet_id,auth.uid());
      v_balance := public.crew_leave_entitlement_balance(v_entitlement) || jsonb_build_object('employee',jsonb_build_object('id',v_employee.id,'name',v_employee.name,'position',v_employee.position));
      v_balances := v_balances || jsonb_build_object(v_type,v_balance);
    end loop;
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'employee',jsonb_build_object('id',v_employee.id,'name',v_employee.name,'position',v_employee.position),
      'balances',v_balances,
      'period_start',v_balances->'annual'->>'period_start',
      'period_end',v_balances->'annual'->>'period_end'
    ));
  end loop;
  return jsonb_build_object('rows',v_rows,'total_count',v_total,'page',v_page,'page_size',v_size);
end;
$$;

create or replace function public.crew_leave_admin_policies(p_outlet_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
  if p_outlet_id is null or auth.uid() is null or not (public.current_user_has_permission('crew_leave.view') or public.current_user_has_permission('crew_leave_balance.view')) or not public.current_user_can_access_outlet(p_outlet_id) then
    raise exception using errcode='42501', message='Leave policies are unavailable for this outlet.';
  end if;
  return coalesce((select jsonb_agg(to_jsonb(p)-array['updated_by'] order by p.leave_type) from public.crew_leave_policies p where p.outlet_id=p_outlet_id),'[]'::jsonb);
end;
$$;

revoke all on function public.crew_access_admin_page(uuid,jsonb,integer,integer) from public,anon,authenticated;
revoke all on function public.crew_leave_requests_admin_page(uuid,date,date,jsonb,integer,integer) from public,anon,authenticated;
revoke all on function public.crew_leave_balances_admin_page(uuid,jsonb,integer,integer) from public,anon,authenticated;
revoke all on function public.crew_leave_admin_policies(uuid) from public,anon,authenticated;
grant execute on function public.crew_access_admin_page(uuid,jsonb,integer,integer) to authenticated;
grant execute on function public.crew_leave_requests_admin_page(uuid,date,date,jsonb,integer,integer) to authenticated;
grant execute on function public.crew_leave_balances_admin_page(uuid,jsonb,integer,integer) to authenticated;
grant execute on function public.crew_leave_admin_policies(uuid) to authenticated;
