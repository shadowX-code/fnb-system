-- Complete the permission catalog surfaced by the shared role matrix. Existing
-- catalog rows keep their identity and definitions.
insert into public.permissions(code,module,description,requires_restaurant_outlet_scope)
values
  ('crew_learning.view','Crew Learning','View Crew learning journeys and progress.',false),
  ('crew_learning.create','Crew Learning','Create Crew learning content.',false),
  ('crew_learning.edit','Crew Learning','Edit Crew learning content.',false),
  ('crew_learning.manage','Crew Learning','Manage Crew learning drafts, assignments and lifecycle.',false),
  ('crew_progress.view','Crew Progress','View Crew learning progress.',false),
  ('crew_sop_library.view','Crew SOP Library','View Crew SOP library.',false),
  ('crew_sop_library.create','Crew SOP Library','Create Crew SOP library content.',false),
  ('crew_sop_library.edit','Crew SOP Library','Edit Crew SOP library content.',false),
  ('crew_sop_library.manage','Crew SOP Library','Manage Crew SOP library content.',false)
on conflict(code) do nothing;

-- A requested code must match a catalog code. The former unqualified `code`
-- resolved to the inner permissions column and let missing codes be ignored.
-- Keep the save and its authoritative audit in the same transaction.
create or replace function public.save_role_configuration(
  p_request_id uuid, p_role jsonb, p_permission_codes text[], p_outlet_ids uuid[]
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid := auth.uid();
  v_role_id uuid := nullif(p_role->>'id','')::uuid;
  v_name text := lower(regexp_replace(trim(coalesce(p_role->>'name','')), '\\s+', '_', 'g'));
  v_operation text;
  v_protected boolean := public.current_user_is_protected_role();
  v_existing public.roles%rowtype;
  v_request public.role_configuration_requests%rowtype;
  v_permissions text[] := coalesce(p_permission_codes,'{}');
  v_outlets uuid[] := coalesce(p_outlet_ids,'{}');
  v_outlet_access_type text;
  v_has_restaurant_permissions boolean;
  v_fingerprint text;
  v_result jsonb;
  v_before jsonb;
begin
  if v_actor is null then raise exception using errcode='42501', message='Authentication is required.'; end if;
  if p_request_id is null or v_name='' then raise exception 'A request ID and role name are required.'; end if;
  if cardinality(v_permissions) <> cardinality(array(select distinct unnest(v_permissions)))
    or cardinality(v_outlets) <> cardinality(array(select distinct unnest(v_outlets))) then
    raise exception 'Role configuration contains duplicate permissions or outlets.';
  end if;

  v_operation := case when v_role_id is null then 'create_role_configuration' else 'update_role_configuration' end;
  if (v_role_id is null and not public.current_user_has_role_management_permission('create'))
    or (v_role_id is not null and not public.current_user_has_role_management_permission('edit')) then
    raise exception using errcode='42501', message='Missing role management permission.';
  end if;
  if not v_protected and exists (
    select 1 from unnest(v_permissions) as requested(code)
    where not exists(select 1 from public.permissions permission where permission.code=requested.code and public.current_user_can_assign_permission(permission.id))
  ) then raise exception using errcode='42501', message='You cannot assign a permission outside your authority.'; end if;
  if not v_protected and exists(select 1 from unnest(v_outlets) outlet_id where not public.current_user_can_access_outlet(outlet_id)) then
    raise exception using errcode='42501', message='You cannot assign an inaccessible outlet.';
  end if;
  if exists(select 1 from unnest(v_permissions) as requested(code) where not exists(select 1 from public.permissions permission where permission.code=requested.code))
    or exists(select 1 from unnest(v_outlets) outlet_id where not exists(select 1 from public.outlets outlet where outlet.id=outlet_id)) then
    raise exception 'Unknown permission or outlet. Refresh the role and try again.';
  end if;
  if not v_protected and (v_name in ('owner','admin') or coalesce((p_role->>'is_system_role')::boolean,false)) then
    raise exception using errcode='42501', message='Protected roles cannot be changed.';
  end if;

  select exists(
    select 1 from public.permissions permission
    where permission.code = any(v_permissions)
      and permission.requires_restaurant_outlet_scope
  ) into v_has_restaurant_permissions;

  if v_has_restaurant_permissions then
    v_outlet_access_type := case when p_role->>'outlet_access_type'='selected' then 'selected' when p_role->>'outlet_access_type'='all' then 'all' else null end;
    if v_outlet_access_type is null then raise exception 'Restaurant permissions require All Outlets or Selected Outlets access.'; end if;
    if v_outlet_access_type='selected' and cardinality(v_outlets)=0 then raise exception 'Select at least one outlet for Restaurant permissions.'; end if;
    if v_outlet_access_type='all' and cardinality(v_outlets)>0 then raise exception 'All Outlets access cannot include selected outlets.'; end if;
  else
    if cardinality(v_outlets)>0 then raise exception 'Outlet Access is not applicable when a role has no Restaurant permissions.'; end if;
    v_outlet_access_type := 'none';
  end if;

  perform pg_advisory_xact_lock(hashtext('role_configuration:'||coalesce(v_role_id::text,v_name)));
  v_fingerprint := md5(jsonb_build_object(
    'operation',v_operation,
    'role',jsonb_build_object('id',v_role_id,'name',v_name,'description',coalesce(p_role->>'description',''),'is_active',coalesce((p_role->>'is_active')::boolean,true),'outlet_access_type',v_outlet_access_type),
    'permissions',(select coalesce(jsonb_agg(code order by code),'[]'::jsonb) from unnest(v_permissions) code),
    'outlets',(select coalesce(jsonb_agg(outlet_id order by outlet_id),'[]'::jsonb) from unnest(v_outlets) outlet_id)
  )::text);
  select * into v_request from public.role_configuration_requests where request_id=p_request_id for update;
  if found then
    if v_request.operation=v_operation and v_request.actor_id=v_actor and v_request.payload_fingerprint=v_fingerprint and v_request.result is not null then return v_request.result; end if;
    raise exception 'Request ID was already used for a different role configuration.';
  end if;

  if v_role_id is null then
    insert into public.roles(name,description,is_system_role,is_active,outlet_access_type)
    values(v_name,coalesce(p_role->>'description',''),false,coalesce((p_role->>'is_active')::boolean,true),v_outlet_access_type)
    returning * into v_existing;
  else
    select * into v_existing from public.roles where id=v_role_id for update;
    if not found or (not v_protected and not public.role_is_editable_by_current_user(v_role_id)) then raise exception using errcode='42501',message='Role is not editable.'; end if;
    select jsonb_build_object('role',to_jsonb(v_existing),'permissions',coalesce((select jsonb_agg(permission.code order by permission.code) from public.role_permissions role_permission join public.permissions permission on permission.id=role_permission.permission_id where role_permission.role_id=v_role_id),'[]'::jsonb),'outlet_ids',coalesce((select jsonb_agg(outlet_id order by outlet_id) from public.role_outlets where role_id=v_role_id),'[]'::jsonb)) into v_before;
    update public.roles set name=v_name,description=coalesce(p_role->>'description',''),is_active=coalesce((p_role->>'is_active')::boolean,true),outlet_access_type=v_outlet_access_type where id=v_role_id returning * into v_existing;
  end if;
  insert into public.role_configuration_requests(request_id,operation,actor_id,role_id,payload_fingerprint) values(p_request_id,v_operation,v_actor,v_existing.id,v_fingerprint);
  delete from public.role_permissions role_permission where role_permission.role_id=v_existing.id and not exists(select 1 from public.permissions permission where permission.id=role_permission.permission_id and permission.code=any(v_permissions));
  insert into public.role_permissions(role_id,permission_id) select v_existing.id,permission.id from public.permissions permission where permission.code=any(v_permissions) on conflict do nothing;
  delete from public.role_outlets role_outlet where role_outlet.role_id=v_existing.id and not role_outlet.outlet_id=any(v_outlets);
  insert into public.role_outlets(role_id,outlet_id) select v_existing.id,outlet_id from unnest(v_outlets) outlet_id on conflict do nothing;
  select jsonb_build_object('role',to_jsonb(v_existing),'permissions',coalesce((select jsonb_agg(permission.code order by permission.code) from public.role_permissions role_permission join public.permissions permission on permission.id=role_permission.permission_id where role_permission.role_id=v_existing.id),'[]'::jsonb),'outlet_ids',coalesce((select jsonb_agg(outlet_id order by outlet_id) from public.role_outlets where role_id=v_existing.id),'[]'::jsonb)) into v_result;
  if (select coalesce(array_agg(code order by code),'{}'::text[]) from unnest(v_permissions) as requested(code))
    is distinct from (select coalesce(array_agg(code order by code),'{}'::text[]) from jsonb_array_elements_text(v_result->'permissions') as persisted(code)) then
    raise exception 'Role permission snapshot did not persist completely.';
  end if;
  insert into public.audit_logs(action,module,user_id,user_name,description,metadata)
  values (case when v_role_id is null then 'role_created' else 'role_updated' end,
    'access-control',v_actor,
    coalesce(auth.jwt()->'user_metadata'->>'full_name',auth.jwt()->>'email','System'),
    case when v_role_id is null then 'Role created.' else 'Role updated.' end,
    jsonb_build_object('target',v_existing.name,'request_id',p_request_id,'before',v_before,
      'after',to_jsonb(v_existing) || jsonb_build_object('permissions',v_result->'permissions','outlet_ids',v_result->'outlet_ids')));
  update public.role_configuration_requests set result=v_result,completed_at=now() where request_id=p_request_id;
  return v_result;
end $$;

revoke all on function public.save_role_configuration(uuid,jsonb,text[],uuid[]) from public;
grant execute on function public.save_role_configuration(uuid,jsonb,text[],uuid[]) to authenticated;
