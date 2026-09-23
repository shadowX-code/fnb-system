-- Management grants are specific to an outlet already allowed by the employee's
-- current Role. Existing fixed-workplace flags remain on crew_access.
create table public.crew_management_special_access (
  employee_id uuid not null references public.crew_access(employee_id) on delete cascade,
  outlet_id uuid not null references public.outlets(id),
  can_initiate_handover boolean not null default false,
  can_add_assets boolean not null default false,
  can_manage_asset_details boolean not null default false,
  can_adjust_assets boolean not null default false,
  can_perform_asset_inspections boolean not null default false,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (employee_id, outlet_id)
);
create index crew_management_special_access_outlet_idx on public.crew_management_special_access(outlet_id);
alter table public.crew_management_special_access enable row level security;
revoke all on public.crew_management_special_access from public, anon, authenticated;

create function public.crew_special_access_for_outlet(p_employee_id uuid, p_outlet_id uuid)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare v_employee public.employees%rowtype; v_access public.crew_access%rowtype;
  v_grant public.crew_management_special_access%rowtype;
begin
  select * into v_employee from public.employees where id=p_employee_id;
  select * into v_access from public.crew_access where employee_id=p_employee_id and access_state='active';
  if v_access.employee_id is null or p_outlet_id is null then
    raise exception using errcode='42501',message='Crew Special Access is unavailable.';
  end if;
  if lower(btrim(coalesce(v_employee.workplace,'')))='management' then
    if v_access.primary_outlet_id is not null or not(p_outlet_id=any(public.crew_authorized_outlet_ids(p_employee_id))) then
      raise exception using errcode='42501',message='Outlet is unavailable for this Crew employee.';
    end if;
    select * into v_grant from public.crew_management_special_access
      where employee_id=p_employee_id and outlet_id=p_outlet_id;
    return jsonb_build_object('employee_id',p_employee_id,'outlet_id',p_outlet_id,
      'can_initiate_handover',coalesce(v_grant.can_initiate_handover,false),
      'can_add_assets',coalesce(v_grant.can_add_assets,false),
      'can_manage_asset_details',coalesce(v_grant.can_manage_asset_details,false),
      'can_adjust_assets',coalesce(v_grant.can_adjust_assets,false),
      'can_perform_asset_inspections',coalesce(v_grant.can_perform_asset_inspections,false));
  end if;
  if v_access.primary_outlet_id is distinct from p_outlet_id
    or p_outlet_id is distinct from public.crew_resolve_employee_outlet(p_employee_id) then
    raise exception using errcode='42501',message='Outlet is unavailable for this Crew employee.';
  end if;
  return jsonb_build_object('employee_id',p_employee_id,'outlet_id',p_outlet_id,
    'can_initiate_handover',v_access.can_initiate_handover,
    'can_add_assets',v_access.can_add_assets,
    'can_manage_asset_details',v_access.can_manage_asset_details,
    'can_adjust_assets',v_access.can_adjust_assets,
    'can_perform_asset_inspections',v_access.can_perform_asset_inspections);
end; $$;
revoke all on function public.crew_special_access_for_outlet(uuid,uuid) from public,anon,authenticated;

create function public.crew_management_special_access_admin(p_employee_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_employee public.employees%rowtype; v_access public.crew_access%rowtype;
begin
  if not(public.current_user_has_permission('crew_employees.view') or public.current_user_has_permission('crew_employees.manage')) then
    raise exception using errcode='42501',message='Missing permission to view Crew Access.';
  end if;
  select * into v_employee from public.employees where id=p_employee_id;
  if v_employee.id is null or lower(btrim(coalesce(v_employee.workplace,'')))<>'management' then
    raise exception using errcode='42501',message='Management Crew Access is unavailable.';
  end if;
  select * into v_access from public.crew_access where employee_id=p_employee_id;
  if v_access.employee_id is null or v_access.access_state<>'active' or v_access.primary_outlet_id is not null then
    raise exception using errcode='22023',message='Activate Crew Access before configuring Special Access.';
  end if;
  return jsonb_build_object('employee_id',p_employee_id,'outlets',coalesce((
    select jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,
      'can_initiate_handover',coalesce(g.can_initiate_handover,false),
      'can_add_assets',coalesce(g.can_add_assets,false),
      'can_manage_asset_details',coalesce(g.can_manage_asset_details,false),
      'can_adjust_assets',coalesce(g.can_adjust_assets,false),
      'can_perform_asset_inspections',coalesce(g.can_perform_asset_inspections,false)) order by o.name,o.id)
    from public.outlets o left join public.crew_management_special_access g
      on g.employee_id=p_employee_id and g.outlet_id=o.id
    where o.id=any(public.crew_authorized_outlet_ids(p_employee_id))
      and public.current_user_can_access_outlet(o.id)
  ),'[]'::jsonb));
end; $$;
revoke all on function public.crew_management_special_access_admin(uuid) from public,anon,authenticated;
grant execute on function public.crew_management_special_access_admin(uuid) to authenticated;

create function public.crew_update_management_special_access(
  p_employee_id uuid,p_outlet_id uuid,p_can_initiate_handover boolean,
  p_can_add_assets boolean,p_can_manage_asset_details boolean,
  p_can_adjust_assets boolean,p_can_perform_asset_inspections boolean
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_access public.crew_access%rowtype; v_employee public.employees%rowtype;
  v_before jsonb; v_after jsonb; v_result jsonb;
begin
  if not public.current_user_has_permission('crew_employees.manage') then
    raise exception using errcode='42501',message='Missing permission to manage Crew Access.';
  end if;
  select * into v_employee from public.employees where id=p_employee_id;
  select * into v_access from public.crew_access where employee_id=p_employee_id for update;
  if lower(btrim(coalesce(v_employee.workplace,'')))<>'management'
    or v_access.employee_id is null or v_access.access_state<>'active'
    or v_access.primary_outlet_id is not null then
    raise exception using errcode='22023',message='Active Management Crew Access is required.';
  end if;
  if p_outlet_id is null or not(p_outlet_id=any(public.crew_authorized_outlet_ids(p_employee_id)))
    or not public.current_user_can_access_outlet(p_outlet_id) then
    raise exception using errcode='42501',message='Outlet is outside the authorized Role and Admin scope.';
  end if;
  v_before:=public.crew_special_access_for_outlet(p_employee_id,p_outlet_id);
  insert into public.crew_management_special_access(employee_id,outlet_id,can_initiate_handover,
    can_add_assets,can_manage_asset_details,can_adjust_assets,can_perform_asset_inspections,updated_by)
  values(p_employee_id,p_outlet_id,coalesce(p_can_initiate_handover,false),
    coalesce(p_can_add_assets,false),coalesce(p_can_manage_asset_details,false),
    coalesce(p_can_adjust_assets,false),coalesce(p_can_perform_asset_inspections,false),auth.uid())
  on conflict(employee_id,outlet_id) do update set
    can_initiate_handover=excluded.can_initiate_handover,
    can_add_assets=excluded.can_add_assets,
    can_manage_asset_details=excluded.can_manage_asset_details,
    can_adjust_assets=excluded.can_adjust_assets,
    can_perform_asset_inspections=excluded.can_perform_asset_inspections,
    updated_by=auth.uid(),updated_at=now();
  v_after:=public.crew_special_access_for_outlet(p_employee_id,p_outlet_id);
  if v_before is distinct from v_after then
    insert into public.audit_logs(action,module,description,metadata)
    values('crew_management_special_access_updated','crew','Management Crew outlet Special Access updated.',
      jsonb_build_object('employee_id',p_employee_id,'outlet_id',p_outlet_id,
        'actor_id',auth.uid(),'before',v_before,'after',v_after));
  end if;
  return v_after;
end; $$;
revoke all on function public.crew_update_management_special_access(uuid,uuid,boolean,boolean,boolean,boolean,boolean) from public,anon,authenticated;
grant execute on function public.crew_update_management_special_access(uuid,uuid,boolean,boolean,boolean,boolean,boolean) to authenticated;

-- The selected outlet is supplied to each Management Asset operation. The
-- transaction-local value lets the existing idempotent Asset lifecycle remain
-- its sole mutation authority, while every call rechecks live Role and grant.
create function public.crew_management_asset_scope(p_token text,p_outlet_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_employee_id uuid:=public.crew_session_employee(p_token);
begin
  if not exists(select 1 from public.employees where id=v_employee_id
    and lower(btrim(coalesce(workplace,'')))='management') then
    raise exception using errcode='42501',message='Management Asset access is unavailable.';
  end if;
  perform public.crew_selected_outlet(p_token,p_outlet_id);
  perform public.crew_special_access_for_outlet(v_employee_id,p_outlet_id);
  perform set_config('feedx.crew_management_outlet',p_outlet_id::text,true);
  return v_employee_id;
end; $$;
revoke all on function public.crew_management_asset_scope(text,uuid) from public,anon,authenticated;

create or replace function public.crew_asset_context(p_token text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_employee_id uuid:=public.crew_session_employee(p_token);
  v_access public.crew_access%rowtype; v_employee public.employees%rowtype;
  v_outlet_id uuid; v_grant jsonb;
begin
  select * into v_employee from public.employees where id=v_employee_id;
  select * into v_access from public.crew_access where employee_id=v_employee_id and access_state='active' for share;
  if v_access.employee_id is null then
    raise exception using errcode='42501',message='Crew Asset access is unavailable.';
  end if;
  if lower(btrim(coalesce(v_employee.workplace,'')))='management' then
    v_outlet_id:=nullif(current_setting('feedx.crew_management_outlet',true),'')::uuid;
    if v_outlet_id is null or v_access.primary_outlet_id is not null then
      raise exception using errcode='42501',message='Crew Asset access is unavailable.';
    end if;
  else
    v_outlet_id:=v_access.primary_outlet_id;
    if v_outlet_id is null or v_outlet_id is distinct from public.crew_resolve_employee_outlet(v_employee_id) then
      raise exception using errcode='42501',message='Crew Asset access is unavailable.';
    end if;
  end if;
  v_grant:=public.crew_special_access_for_outlet(v_employee_id,v_outlet_id);
  if not(coalesce((v_grant->>'can_add_assets')::boolean,false)
    or coalesce((v_grant->>'can_manage_asset_details')::boolean,false)
    or coalesce((v_grant->>'can_adjust_assets')::boolean,false)
    or coalesce((v_grant->>'can_perform_asset_inspections')::boolean,false)) then
    raise exception using errcode='42501',message='Crew Asset access is unavailable.';
  end if;
  return v_grant || jsonb_build_object('employee_name',
    coalesce(nullif(v_employee.nickname,''),v_employee.full_name));
end; $$;
revoke all on function public.crew_asset_context(text) from public,anon,authenticated;

create function public.crew_management_asset_mobile_authorized(p_token text,p_outlet_id uuid,p_asset_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_employee_id uuid:=public.crew_session_employee(p_token); v_grant jsonb;
  v_mutable boolean;
begin
  if not exists(select 1 from public.employees where id=v_employee_id
    and lower(btrim(coalesce(workplace,'')))='management') then
    raise exception using errcode='42501',message='Management Asset view is unavailable.';
  end if;
  perform public.crew_selected_outlet(p_token,p_outlet_id);
  v_grant:=public.crew_special_access_for_outlet(v_employee_id,p_outlet_id);
  v_mutable:=coalesce((v_grant->>'can_add_assets')::boolean,false)
    or coalesce((v_grant->>'can_manage_asset_details')::boolean,false)
    or coalesce((v_grant->>'can_adjust_assets')::boolean,false)
    or coalesce((v_grant->>'can_perform_asset_inspections')::boolean,false);
  if not v_mutable then
    return public.crew_management_asset_mobile(p_token,p_outlet_id,p_asset_id);
  end if;
  perform public.crew_management_asset_scope(p_token,p_outlet_id);
  return public.crew_asset_mobile(p_token,p_asset_id) || jsonb_build_object('read_only',false);
end; $$;
revoke all on function public.crew_management_asset_mobile_authorized(text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.crew_management_asset_mobile_authorized(text,uuid,uuid) to anon,authenticated;

create function public.crew_management_asset_adjust(p_token text,p_outlet_id uuid,p_request_id uuid,
  p_asset_id uuid,p_adjustment_type text,p_quantity numeric,p_condition text,p_reason text,p_note text)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  perform public.crew_management_asset_scope(p_token,p_outlet_id);
  return public.crew_asset_adjust(p_token,p_request_id,p_asset_id,p_adjustment_type,p_quantity,p_condition,p_reason,p_note);
end; $$;
create function public.crew_management_asset_create(p_token text,p_outlet_id uuid,p_request_id uuid,p_asset jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  perform public.crew_management_asset_scope(p_token,p_outlet_id);
  return public.crew_asset_create(p_token,p_request_id,p_asset);
end; $$;
create function public.crew_management_asset_create_context(p_token text,p_outlet_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  perform public.crew_management_asset_scope(p_token,p_outlet_id);
  return public.crew_asset_create_context(p_token);
end; $$;
create function public.crew_management_asset_create_result(p_token text,p_outlet_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_result jsonb;
begin
  perform public.crew_management_asset_scope(p_token,p_outlet_id);
  v_result:=public.crew_asset_create_result(p_token,p_request_id);
  if v_result is not null and (v_result#>>'{asset,outlet_id}')::uuid is distinct from p_outlet_id then
    raise exception using errcode='42501',message='Asset request belongs to another outlet.';
  end if;
  return v_result;
end; $$;
create function public.crew_management_asset_create_with_photo(p_token text,p_outlet_id uuid,p_request_id uuid,
  p_asset jsonb,p_original_image_url text,p_image_url text,p_thumbnail_url text)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  perform public.crew_management_asset_scope(p_token,p_outlet_id);
  return public.crew_asset_create_with_photo(p_token,p_request_id,p_asset,p_original_image_url,p_image_url,p_thumbnail_url);
end; $$;
create function public.crew_management_asset_update_details(p_token text,p_outlet_id uuid,p_request_id uuid,
  p_asset_id uuid,p_details jsonb,p_original_image_url text default null,p_image_url text default null,p_thumbnail_url text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  perform public.crew_management_asset_scope(p_token,p_outlet_id);
  return public.crew_asset_update_details(p_token,p_request_id,p_asset_id,p_details,p_original_image_url,p_image_url,p_thumbnail_url);
end; $$;
create function public.crew_management_asset_initial_photo_context(p_token text,p_outlet_id uuid,p_asset_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  perform public.crew_management_asset_scope(p_token,p_outlet_id);
  return public.crew_asset_initial_photo_context(p_token,p_asset_id);
end; $$;
create function public.crew_management_asset_initial_photo_result(p_token text,p_outlet_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_result jsonb;
begin
  perform public.crew_management_asset_scope(p_token,p_outlet_id);
  v_result:=public.crew_asset_initial_photo_result(p_token,p_request_id);
  if v_result is not null and not exists(select 1 from public.asset_items a
    where a.id=(v_result#>>'{asset,id}')::uuid and a.outlet_id=p_outlet_id) then
    raise exception using errcode='42501',message='Asset request belongs to another outlet.';
  end if;
  return v_result;
end; $$;
create function public.crew_management_asset_set_initial_photo(p_token text,p_outlet_id uuid,p_request_id uuid,
  p_asset_id uuid,p_original_image_url text,p_image_url text,p_thumbnail_url text)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  perform public.crew_management_asset_scope(p_token,p_outlet_id);
  return public.crew_asset_set_initial_photo(p_token,p_request_id,p_asset_id,p_original_image_url,p_image_url,p_thumbnail_url);
end; $$;
create function public.crew_management_asset_submit_inspection(p_token text,p_outlet_id uuid,p_request_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  perform public.crew_management_asset_scope(p_token,p_outlet_id);
  return public.crew_asset_submit_inspection(p_token,p_request_id,p_payload);
end; $$;
create function public.crew_management_asset_archive_inspection_draft(p_token text,p_outlet_id uuid,p_request_id uuid,p_inspection_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  perform public.crew_management_asset_scope(p_token,p_outlet_id);
  return public.crew_asset_archive_inspection_draft(p_token,p_request_id,p_inspection_id);
end; $$;
create function public.crew_management_asset_evidence_context(p_token text,p_outlet_id uuid,p_asset_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  perform public.crew_management_asset_scope(p_token,p_outlet_id);
  return public.crew_asset_evidence_context(p_token,p_asset_id);
end; $$;

revoke all on function public.crew_management_asset_adjust(text,uuid,uuid,uuid,text,numeric,text,text,text) from public,anon,authenticated;
revoke all on function public.crew_management_asset_create(text,uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.crew_management_asset_create_context(text,uuid) from public,anon,authenticated;
revoke all on function public.crew_management_asset_create_result(text,uuid,uuid) from public,anon,authenticated;
revoke all on function public.crew_management_asset_create_with_photo(text,uuid,uuid,jsonb,text,text,text) from public,anon,authenticated;
revoke all on function public.crew_management_asset_update_details(text,uuid,uuid,uuid,jsonb,text,text,text) from public,anon,authenticated;
revoke all on function public.crew_management_asset_initial_photo_context(text,uuid,uuid) from public,anon,authenticated;
revoke all on function public.crew_management_asset_initial_photo_result(text,uuid,uuid) from public,anon,authenticated;
revoke all on function public.crew_management_asset_set_initial_photo(text,uuid,uuid,uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.crew_management_asset_submit_inspection(text,uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.crew_management_asset_archive_inspection_draft(text,uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.crew_management_asset_evidence_context(text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.crew_management_asset_adjust(text,uuid,uuid,uuid,text,numeric,text,text,text) to anon,authenticated;
grant execute on function public.crew_management_asset_create(text,uuid,uuid,jsonb) to anon,authenticated;
grant execute on function public.crew_management_asset_create_context(text,uuid) to anon,authenticated;
grant execute on function public.crew_management_asset_create_result(text,uuid,uuid) to anon,authenticated;
grant execute on function public.crew_management_asset_create_with_photo(text,uuid,uuid,jsonb,text,text,text) to anon,authenticated;
grant execute on function public.crew_management_asset_update_details(text,uuid,uuid,uuid,jsonb,text,text,text) to anon,authenticated;
grant execute on function public.crew_management_asset_initial_photo_context(text,uuid,uuid) to anon,authenticated;
grant execute on function public.crew_management_asset_initial_photo_result(text,uuid,uuid) to anon,authenticated;
grant execute on function public.crew_management_asset_set_initial_photo(text,uuid,uuid,uuid,text,text,text) to anon,authenticated;
grant execute on function public.crew_management_asset_submit_inspection(text,uuid,uuid,jsonb) to anon,authenticated;
grant execute on function public.crew_management_asset_archive_inspection_draft(text,uuid,uuid,uuid) to anon,authenticated;
grant execute on function public.crew_management_asset_evidence_context(text,uuid,uuid) to anon,authenticated;

create or replace function public.crew_can_initiate_cash_handover(p_employee_id uuid,p_outlet_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.crew_access ca join public.employees e on e.id=ca.employee_id
    where ca.employee_id=p_employee_id and ca.access_state='active'
      and coalesce(e.is_active,true)
      and coalesce(e.employment_status,'active') not in ('resigned','terminated')
      and (
        (lower(btrim(coalesce(e.workplace,'')))='management'
          and ca.primary_outlet_id is null
          and p_outlet_id=any(public.crew_authorized_outlet_ids(e.id))
          and exists(select 1 from public.crew_management_special_access g
            where g.employee_id=e.id and g.outlet_id=p_outlet_id and g.can_initiate_handover))
        or (lower(btrim(coalesce(e.workplace,'')))<>'management'
          and ca.primary_outlet_id=p_outlet_id
          and ca.primary_outlet_id=public.crew_resolve_employee_outlet(e.id)
          and ca.can_initiate_handover)
      )
  );
$$;
revoke all on function public.crew_can_initiate_cash_handover(uuid,uuid) from public,anon,authenticated;

create or replace function public.crew_operations_employee_context(p_token text)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare v_employee_id uuid:=public.crew_session_employee(p_token);
  v_employee public.employees%rowtype; v_access public.crew_access%rowtype; v_outlet_id uuid;
begin
  select * into v_employee from public.employees
    where id=v_employee_id and is_active
      and coalesce(employment_status,'active') not in ('resigned','terminated');
  select * into v_access from public.crew_access where employee_id=v_employee_id and access_state='active';
  if v_employee.id is null or v_access.employee_id is null then
    raise exception using errcode='42501',message='Crew Operations access is unavailable.';
  end if;
  if lower(btrim(coalesce(v_employee.workplace,'')))='management' then
    v_outlet_id:=nullif(current_setting('feedx.crew_management_handover_outlet',true),'')::uuid;
    if v_access.primary_outlet_id is not null or v_outlet_id is null
      or not public.crew_can_initiate_cash_handover(v_employee_id,v_outlet_id) then
      raise exception using errcode='42501',message='Crew Operations access is unavailable.';
    end if;
  else
    v_outlet_id:=v_access.primary_outlet_id;
    if v_outlet_id is null or v_outlet_id is distinct from public.crew_resolve_employee_outlet(v_employee_id) then
      raise exception using errcode='42501',message='Crew Operations access is unavailable.';
    end if;
  end if;
  return jsonb_build_object('employee_id',v_employee.id,'employee_name',v_employee.full_name,
    'position',v_employee.position,'role_id',v_employee.role_id,'outlet_id',v_outlet_id);
end; $$;
revoke all on function public.crew_operations_employee_context(text) from public,anon,authenticated;

create function public.crew_management_cash_scope(p_token text,p_outlet_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_employee_id uuid:=public.crew_session_employee(p_token);
begin
  if not exists(select 1 from public.employees where id=v_employee_id
    and lower(btrim(coalesce(workplace,'')))='management')
    or not public.crew_can_initiate_cash_handover(v_employee_id,p_outlet_id) then
    raise exception using errcode='42501',message='Cash Handover access is unavailable.';
  end if;
  perform public.crew_selected_outlet(p_token,p_outlet_id);
  perform set_config('feedx.crew_management_handover_outlet',p_outlet_id::text,true);
  return v_employee_id;
end; $$;
revoke all on function public.crew_management_cash_scope(text,uuid) from public,anon,authenticated;

create function public.crew_management_cash_mobile(p_token text,p_outlet_id uuid,p_business_date date)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare v_payload jsonb;
begin
  perform public.crew_management_cash_scope(p_token,p_outlet_id);
  v_payload:=public.crew_cash_mobile(p_token,p_business_date);
  return (v_payload - 'checkout' - 'cash_context' - 'settings')
    || jsonb_build_object('can_perform',false,'can_record_collection',true,
      'can_initiate_handover',true,'checkout',null,'read_only_checkout',true);
end; $$;
create function public.crew_management_cash_record_collection(p_token text,p_outlet_id uuid,p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
begin
  perform public.crew_management_cash_scope(p_token,p_outlet_id);
  return public.crew_cash_record_collection(p_token,p_payload);
end; $$;
revoke all on function public.crew_management_cash_mobile(text,uuid,date) from public,anon,authenticated;
revoke all on function public.crew_management_cash_record_collection(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.crew_management_cash_mobile(text,uuid,date) to anon,authenticated;
grant execute on function public.crew_management_cash_record_collection(text,uuid,jsonb) to anon,authenticated;

create or replace function public.crew_outlet_scope(p_token text)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare v_employee_id uuid:=public.crew_session_employee(p_token);
  v_employee public.employees%rowtype; v_ids uuid[]; v_outlets jsonb;
  v_default uuid; v_management boolean;
begin
  select * into v_employee from public.employees where id=v_employee_id;
  v_management:=lower(btrim(coalesce(v_employee.workplace,'')))='management';
  v_ids:=public.crew_authorized_outlet_ids(v_employee_id);
  if cardinality(v_ids)=0 then
    raise exception using errcode='42501',message='Crew Access is no longer active. Please sign in again.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'name',o.name)
    || case when v_management then jsonb_build_object('special_access',
      public.crew_special_access_for_outlet(v_employee_id,o.id)) else '{}'::jsonb end
    order by o.name,o.id),'[]'::jsonb),
    (array_agg(o.id order by o.name,o.id))[1]
  into v_outlets,v_default from public.outlets o where o.id=any(v_ids);
  return jsonb_build_object('employee_id',v_employee_id,'management',v_management,
    'outlets',v_outlets,'default_outlet_id',v_default);
end; $$;
revoke all on function public.crew_outlet_scope(text) from public,anon,authenticated;
grant execute on function public.crew_outlet_scope(text) to anon,authenticated;
