-- Audit security administration, never ordinary inspection reads or secret material.
create function feedx_integrations.audit_machine_security()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_before jsonb:='{}';v_after jsonb:='{}';v_hash_changed boolean:=false;
  v_fields text[]:=array['id','identity_id','name','role_id','enabled','created_at','expires_at','revoked_at'];
begin
  if TG_OP<>'INSERT' then
    select coalesce(jsonb_object_agg(key,value),'{}') into v_before from jsonb_each(to_jsonb(old)) where key=any(v_fields);
  end if;
  if TG_OP<>'DELETE' then
    select coalesce(jsonb_object_agg(key,value),'{}') into v_after from jsonb_each(to_jsonb(new)) where key=any(v_fields);
  end if;
  if TG_OP='UPDATE' and TG_TABLE_NAME='machine_credentials' then
    v_hash_changed:=(to_jsonb(old)->>'token_hash') is distinct from (to_jsonb(new)->>'token_hash');
  end if;
  if TG_OP='UPDATE' and v_before=v_after and not v_hash_changed then return new;end if;
  insert into public.audit_logs(action,module,user_id,user_name,description,metadata)
  values('external_machine_'||TG_TABLE_NAME||'_'||lower(TG_OP),'system',auth.uid(),session_user,
    'External machine security configuration changed.',jsonb_build_object('before',v_before,'after',v_after,'credential_replaced',v_hash_changed,'database_role',session_user));
  if TG_OP='DELETE' then return old;end if;
  return new;
end $$;
revoke all on function feedx_integrations.audit_machine_security() from public,anon,authenticated;
create trigger machine_identity_security_audit after insert or update or delete on feedx_integrations.machine_identities
for each row execute function feedx_integrations.audit_machine_security();
create trigger machine_credential_security_audit after insert or update or delete on feedx_integrations.machine_credentials
for each row execute function feedx_integrations.audit_machine_security();

-- Register the already-issued Staging identity as observed now; do not invent its original human actor.
insert into public.audit_logs(action,module,user_id,user_name,description,metadata)
select 'external_machine_security_baseline','system',auth.uid(),session_user,
  'Existing external machine security configuration observed when audit enforcement was installed.',
  jsonb_build_object('identity_id',m.id,'name',m.name,'role_id',m.role_id,'enabled',m.enabled,
    'credential_id',c.id,'credential_created_at',c.created_at,'expires_at',c.expires_at,'revoked_at',c.revoked_at,'database_role',session_user)
from feedx_integrations.machine_identities m left join feedx_integrations.machine_credentials c on c.identity_id=m.id;
