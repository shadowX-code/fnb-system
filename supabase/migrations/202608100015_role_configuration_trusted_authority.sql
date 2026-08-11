-- Transactional, request-idempotent Role configuration snapshots.
create table if not exists public.role_configuration_requests (
  request_id uuid primary key, operation text not null, actor_id uuid not null references auth.users(id),
  role_id uuid references public.roles(id) on delete restrict, payload_fingerprint text not null,
  result jsonb, created_at timestamptz not null default now(), completed_at timestamptz
);
alter table public.role_configuration_requests enable row level security;
revoke all on public.role_configuration_requests from anon, authenticated;

create or replace function public.save_role_configuration(
  p_request_id uuid, p_role jsonb, p_permission_codes text[], p_outlet_ids uuid[]
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_actor uuid:=auth.uid(); v_role_id uuid:=nullif(p_role->>'id','')::uuid; v_name text:=lower(regexp_replace(trim(coalesce(p_role->>'name','')), '\\s+', '_', 'g'));
  v_operation text; v_protected boolean:=public.current_user_is_protected_role(); v_existing public.roles%rowtype; v_request public.role_configuration_requests%rowtype;
  v_permissions text[]:=coalesce(p_permission_codes,'{}'); v_outlets uuid[]:=coalesce(p_outlet_ids,'{}'); v_fingerprint text; v_result jsonb;
begin
  if v_actor is null then raise exception using errcode='42501',message='Authentication is required.'; end if;
  if p_request_id is null or v_name='' then raise exception 'A request ID and role name are required.'; end if;
  if cardinality(v_permissions)<>cardinality(array(select distinct unnest(v_permissions))) or cardinality(v_outlets)<>cardinality(array(select distinct unnest(v_outlets))) then raise exception 'Role configuration contains duplicate permissions or outlets.'; end if;
  v_operation:=case when v_role_id is null then 'create_role_configuration' else 'update_role_configuration' end;
  if (v_role_id is null and not public.current_user_has_role_management_permission('create')) or (v_role_id is not null and not public.current_user_has_role_management_permission('edit')) then raise exception using errcode='42501',message='Missing role management permission.'; end if;
  if not v_protected and exists(select 1 from unnest(v_permissions) code where not exists(select 1 from public.permissions p where p.code=code and public.current_user_can_assign_permission(p.id))) then raise exception using errcode='42501',message='You cannot assign a permission outside your authority.'; end if;
  if not v_protected and exists(select 1 from unnest(v_outlets) outlet_id where not public.current_user_can_access_outlet(outlet_id)) then raise exception using errcode='42501',message='You cannot assign an inaccessible outlet.'; end if;
  if exists(select 1 from unnest(v_permissions) code where not exists(select 1 from public.permissions p where p.code=code)) or exists(select 1 from unnest(v_outlets) outlet_id where not exists(select 1 from public.outlets o where o.id=outlet_id)) then raise exception 'Unknown permission or outlet.'; end if;
  if not v_protected and (v_name in ('owner','admin') or coalesce((p_role->>'is_system_role')::boolean,false)) then raise exception using errcode='42501',message='Protected roles cannot be changed.'; end if;
  perform pg_advisory_xact_lock(hashtext('role_configuration:'||coalesce(v_role_id::text,v_name)));
  v_fingerprint:=md5(jsonb_build_object('operation',v_operation,'role',jsonb_build_object('id',v_role_id,'name',v_name,'description',coalesce(p_role->>'description',''),'is_active',coalesce((p_role->>'is_active')::boolean,true),'outlet_access_type',coalesce(p_role->>'outlet_access_type','all')),'permissions',(select coalesce(jsonb_agg(x order by x),'[]'::jsonb) from unnest(v_permissions) x),'outlets',(select coalesce(jsonb_agg(x order by x),'[]'::jsonb) from unnest(v_outlets) x))::text);
  select * into v_request from public.role_configuration_requests where request_id=p_request_id for update;
  if found then if v_request.operation=v_operation and v_request.actor_id=v_actor and v_request.payload_fingerprint=v_fingerprint and v_request.result is not null then return v_request.result; end if; raise exception 'Request ID was already used for a different role configuration.'; end if;
  if v_role_id is null then insert into public.roles(name,description,is_system_role,is_active,outlet_access_type) values(v_name,coalesce(p_role->>'description',''),false,coalesce((p_role->>'is_active')::boolean,true),case when p_role->>'outlet_access_type'='selected' then 'selected' else 'all' end) returning * into v_existing; else select * into v_existing from public.roles where id=v_role_id for update; if not found or (not v_protected and not public.role_is_editable_by_current_user(v_role_id)) then raise exception using errcode='42501',message='Role is not editable.'; end if; update public.roles set name=v_name,description=coalesce(p_role->>'description',''),is_active=coalesce((p_role->>'is_active')::boolean,true),outlet_access_type=case when p_role->>'outlet_access_type'='selected' then 'selected' else 'all' end where id=v_role_id returning * into v_existing; end if;
  insert into public.role_configuration_requests(request_id,operation,actor_id,role_id,payload_fingerprint) values(p_request_id,v_operation,v_actor,v_existing.id,v_fingerprint);
  delete from public.role_permissions rp where rp.role_id=v_existing.id and not exists(select 1 from public.permissions p where p.id=rp.permission_id and p.code=any(v_permissions));
  insert into public.role_permissions(role_id,permission_id) select v_existing.id,p.id from public.permissions p where p.code=any(v_permissions) on conflict do nothing;
  delete from public.role_outlets ro where ro.role_id=v_existing.id and not ro.outlet_id=any(v_outlets);
  insert into public.role_outlets(role_id,outlet_id) select v_existing.id,x from unnest(v_outlets) x on conflict do nothing;
  select jsonb_build_object('role',to_jsonb(v_existing),'permissions',coalesce((select jsonb_agg(p.code order by p.code) from public.role_permissions rp join public.permissions p on p.id=rp.permission_id where rp.role_id=v_existing.id),'[]'::jsonb),'outlet_ids',coalesce((select jsonb_agg(outlet_id order by outlet_id) from public.role_outlets where role_id=v_existing.id),'[]'::jsonb)) into v_result;
  update public.role_configuration_requests set result=v_result,completed_at=now() where request_id=p_request_id; return v_result;
end; $$;
revoke all on function public.save_role_configuration(uuid,jsonb,text[],uuid[]) from public;
grant execute on function public.save_role_configuration(uuid,jsonb,text[],uuid[]) to authenticated;
