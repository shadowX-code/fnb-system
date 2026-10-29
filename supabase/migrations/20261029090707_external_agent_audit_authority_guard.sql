-- Keep one canonical audit store; reserve Gateway event provenance for server writers.
alter table public.audit_logs add column trusted_external_agent boolean not null default false;
create function feedx_integrations.guard_gateway_audit() returns trigger
language plpgsql set search_path=public,pg_temp as $$
declare v_reserved boolean:=false;v_server boolean:=current_user in ('postgres','service_role','supabase_admin');
begin
 if TG_OP<>'INSERT' then v_reserved:=old.action ~ '^external_(agent|machine)_';end if;
 if TG_OP<>'DELETE' then v_reserved:=v_reserved or new.action ~ '^external_(agent|machine)_';end if;
 if not v_server and v_reserved then raise exception using errcode='42501',message='Gateway audit events require trusted server authority.';end if;
 if TG_OP='DELETE' then return old;end if;
 if not v_server and new.trusted_external_agent then raise exception using errcode='42501',message='Audit provenance is server controlled.';end if;
 new.trusted_external_agent:=v_server and new.action ~ '^external_(agent|machine)_';
 return new;
end $$;
revoke all on function feedx_integrations.guard_gateway_audit() from public,anon,authenticated;
create trigger trusted_gateway_audit before insert or update or delete on public.audit_logs for each row execute function feedx_integrations.guard_gateway_audit();

create or replace function public.external_agents_admin_data(p_identity_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if auth.uid() is null or not public.current_user_has_role_management_permission('view') then raise exception using errcode='42501',message='Role Settings view permission is required.';end if;
  return jsonb_build_object('connections',coalesce((select jsonb_agg(jsonb_build_object(
    'id',m.id,'name',m.name,'provider',m.provider,'enabled',m.enabled,'role_name',r.name,'role_active',r.is_active,
    'workspace',a.workspace,'scope',a.scope,'permission',a.permission_code,'permission_granted',exists(select 1 from public.role_permissions rp join public.permissions p on p.id=rp.permission_id where rp.role_id=m.role_id and p.code=a.permission_code),
    'endpoint',a.endpoint,'tools',feedx_integrations.capability_snapshot(m.id),'can_manage_capabilities',feedx_integrations.has_dedicated_role(m.id) and feedx_integrations.can_manage(m.id),'can_manage',feedx_integrations.can_manage(m.id),
    'credential',case when c.id is null then null else jsonb_build_object('id',c.id,'created_at',c.created_at,'expires_at',c.expires_at,'revoked_at',c.revoked_at,
      'status',case when c.revoked_at is not null then 'revoked' when c.expires_at<=statement_timestamp() then 'expired' else 'active' end) end,
    'last_access',last_access.occurred_at,'last_mcp_success',last_success.occurred_at,
    'connection_status',case when not m.enabled or not r.is_active then 'disabled'
      when last_success.credential_id=c.id and c.revoked_at is null and c.expires_at>statement_timestamp()
        and exists(select 1 from public.role_permissions rp join public.permissions p on p.id=rp.permission_id where rp.role_id=m.role_id and p.code=a.permission_code) then 'mcp_observed'
      else 'not_observed' end) order by m.name)
    from feedx_integrations.machine_identities m join public.roles r on r.id=m.role_id left join feedx_integrations.adapters a on a.key=m.adapter_key
    left join lateral(select * from feedx_integrations.machine_credentials where identity_id=m.id order by created_at desc,id desc limit 1)c on true
    left join lateral(select * from feedx_integrations.access_events where identity_id=m.id and source='external' order by occurred_at desc,id desc limit 1)last_access on true
    left join lateral(select * from feedx_integrations.access_events where identity_id=m.id and source='external' and outcome='success' and method in ('initialize','tools/call') order by occurred_at desc,id desc limit 1)last_success on true
    where p_identity_id is null or m.id=p_identity_id),'[]'),
    'credentials',case when p_identity_id is null then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'created_at',c.created_at,'expires_at',c.expires_at,'revoked_at',c.revoked_at,
      'status',case when c.revoked_at is not null then 'revoked' when c.expires_at<=statement_timestamp() then 'expired' else 'active' end) order by c.created_at desc,c.id desc)
      from feedx_integrations.machine_credentials c where c.identity_id=p_identity_id),'[]') end,
    'access_events',case when p_identity_id is null then '[]'::jsonb else coalesce((select jsonb_agg(to_jsonb(e) order by e.occurred_at desc,e.id desc) from
      (select id,occurred_at,method,tool,outcome,failure_reason,source from feedx_integrations.access_events where identity_id=p_identity_id order by occurred_at desc,id desc limit 50)e),'[]')end,
     'catalog',coalesce((select jsonb_agg(jsonb_build_object('key',a.key,'workspace',a.workspace,'scope',a.scope,'capabilities',coalesce((select jsonb_agg(jsonb_build_object('name',c.tool_id,'label',c.label,'description',c.description,'workspace',c.workspace,'domain',c.domain,'domain_label',c.domain_label,'capability',c.action_type,'permission',c.permission_code,'requires_human_approval',c.requires_human_approval,'implemented',c.implemented,'can_assign',public.current_user_can_assign_permission(p.id)) order by c.sort_order) from feedx_integrations.capabilities c join public.permissions p on p.code=c.permission_code where c.adapter_key=a.key),'[]')) order by a.workspace,a.key) from feedx_integrations.adapters a),'[]'),
    'unavailable_domains',coalesce((select jsonb_agg(d.label) from (values('production','Production'),('warehouse','Warehouse'),('assets','Assets'))d(key,label) where not exists(select 1 from feedx_integrations.capabilities c where c.domain=d.key and c.workspace='Factory' and c.implemented)),'[]'),
    'can_register',public.current_user_has_role_management_permission('create') and public.current_user_has_role_management_permission('edit'),
    'management_events',case when p_identity_id is null then '[]'::jsonb else coalesce((select jsonb_agg(to_jsonb(e) order by e.occurred_at desc,e.id desc) from
      (select id,created_at occurred_at,action,case when action='external_agent_capability_granted' then 'Access granted: '||(metadata->>'label') when action='external_agent_capability_revoked' then 'Access removed: '||(metadata->>'label') when action='external_machine_machine_identities_insert' then 'Agent connected' when action='external_machine_machine_identities_update' then case when (metadata->'after'->>'enabled')::boolean then 'Agent enabled' else 'Agent disabled' end when action='external_machine_machine_credentials_insert' then 'Access key issued' else 'Access key revoked or replaced' end label
       from public.audit_logs where trusted_external_agent and action in ('external_agent_capability_granted','external_agent_capability_revoked','external_machine_machine_identities_insert','external_machine_machine_identities_update','external_machine_machine_credentials_insert','external_machine_machine_credentials_update')
       and (metadata->>'identity_id'=p_identity_id::text or metadata->'after'->>'identity_id'=p_identity_id::text or (action like 'external_machine_machine_identities_%' and metadata->'after'->>'id'=p_identity_id::text)) order by created_at desc,id desc limit 50)e),'[]')end,
    'management_history_note','Administrator changes are shown from the trusted Gateway audit rollout. Earlier changes are not reconstructed.','access_history_since','2026-10-29T00:00:00Z' ,'history_note','Access history starts with this deployment. Earlier access was not recorded; missing history does not prove no connection.');
end $$;
revoke all on function public.external_agents_admin_data(uuid) from public,anon;
grant execute on function public.external_agents_admin_data(uuid) to authenticated;


