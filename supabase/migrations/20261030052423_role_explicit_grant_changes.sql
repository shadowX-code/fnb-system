-- Preserve grants not represented by the editor; serialize and validate explicit changes.
alter table public.role_configuration_requests add column intent_fingerprint text;
alter function public.save_role_configuration(uuid,jsonb,text[],uuid[]) rename to save_role_configuration_snapshot_internal;
revoke all on function public.save_role_configuration_snapshot_internal(uuid,jsonb,text[],uuid[]) from public,anon,authenticated;
create function public.save_role_configuration(p_request_id uuid,p_role jsonb,p_permission_codes text[],p_outlet_ids uuid[])
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 target uuid:=nullif(p_role->>'id','')::uuid;
 codes text[]; outlets uuid[]:=p_outlet_ids; entry jsonb; result jsonb;
 intent text:=md5(jsonb_build_array(p_role,p_permission_codes,p_outlet_ids)::text);
 prior public.role_configuration_requests%rowtype; role_input jsonb:=p_role;
begin
 if auth.uid() is null then raise exception using errcode='42501',message='Authentication required.';end if;
 if p_request_id is null then raise exception 'Request ID required.';end if;
 perform pg_advisory_xact_lock(hashtext('role_request:'||p_request_id::text));
 select * into prior from public.role_configuration_requests where request_id=p_request_id;
 if found then
  if prior.actor_id=auth.uid() and prior.intent_fingerprint=intent and prior.result is not null then return prior.result;end if;
  raise exception 'Request ID was already used for a different role configuration.';
 end if;
 if target is null then codes:=coalesce(p_permission_codes,'{}');
 else
  perform pg_advisory_xact_lock(hashtext('role_configuration:'||target::text));
  perform 1 from public.roles where id=target for update;
  if not found then raise exception 'Role not found.';end if;
  if jsonb_typeof(p_role->'permission_changes') is distinct from 'array' then
   raise exception 'Reload the role. Explicit permission changes are required; snapshot edits are unsupported.';
  end if;
  select coalesce(array_agg(p.code order by p.code),'{}') into codes from public.role_permissions rp join public.permissions p on p.id=rp.permission_id where rp.role_id=target;
  if exists(select 1 from jsonb_array_elements(p_role->'permission_changes') e group by e->>'code' having count(*)>1) then raise exception 'Duplicate permission change.';end if;
  for entry in select value from jsonb_array_elements(p_role->'permission_changes') loop
   if jsonb_typeof(entry->'before') is distinct from 'boolean' or jsonb_typeof(entry->'enabled') is distinct from 'boolean' or not exists(select 1 from public.permissions where code=entry->>'code') then raise exception 'Invalid permission change.';end if;
   if ((entry->>'code')=any(codes)) is distinct from (entry->>'before')::boolean then raise exception using errcode='40001',message='This permission changed since the role was opened. Reload before saving.';end if;
   if not public.current_user_is_protected_role() and not public.current_user_has_permission(entry->>'code') then raise exception using errcode='42501',message='Permission change outside your authority.';end if;
   if (entry->>'enabled')::boolean then codes:=array_append(codes,entry->>'code');else codes:=array_remove(codes,entry->>'code');end if;
  end loop;
  if coalesce((p_role->>'preserve_outlet_scope')::boolean,true) then
   select p_role||jsonb_build_object('outlet_access_type',outlet_access_type) into role_input from public.roles where id=target;
   select coalesce(array_agg(outlet_id),'{}') into outlets from public.role_outlets where role_id=target;
  end if;
 end if;
 result:=public.save_role_configuration_snapshot_internal(p_request_id,role_input,codes,outlets);
 update public.role_configuration_requests set intent_fingerprint=intent where request_id=p_request_id;
 return result;
end $$;
revoke all on function public.save_role_configuration(uuid,jsonb,text[],uuid[]) from public,anon;
grant execute on function public.save_role_configuration(uuid,jsonb,text[],uuid[]) to authenticated;

notify pgrst,'reload schema';
