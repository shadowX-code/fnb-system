create table feedx_integrations.adapters (
  key text primary key,workspace text not null,scope text not null,permission_code text not null references public.permissions(code),
  endpoint text not null,tools jsonb not null
);
alter table feedx_integrations.adapters enable row level security;
revoke all on feedx_integrations.adapters from public,anon,authenticated;
insert into feedx_integrations.adapters values('factory_mesti','Factory','MeSTI compliance · read-only','factory_mesti_inspection.view',
  'https://ujkzdaaadnvcfayuldmh.supabase.co/functions/v1/factory-mesti-mcp',
  '[{"name":"get_mesti_daily_status","description":"Daily compliance and coverage; defaults to yesterday in Malaysia.","read_only":true},{"name":"list_mesti_exceptions","description":"Exceptions with evidence references and human follow-up.","read_only":true},{"name":"list_pending_verifications","description":"Saved evidence awaiting canonical verification.","read_only":true},{"name":"get_mesti_evidence_details","description":"Redacted details for a returned evidence reference.","read_only":true},{"name":"get_mesti_requirement_schedule","description":"Effective requirements and recurrence without generating records.","read_only":true}]');
-- Registry metadata describes capabilities; it never creates an executor or permission grant.
update feedx_integrations.adapters set tools=(select jsonb_agg(t||jsonb_build_object('domain','mesti','capability','read','permission','factory_mesti_inspection.view','requires_human_approval',false)) from jsonb_array_elements(tools)t) where key='factory_mesti';
alter table feedx_integrations.machine_identities add column provider text not null default 'Not specified',add column adapter_key text references feedx_integrations.adapters(key);
update feedx_integrations.machine_identities m set provider='xAI',adapter_key='factory_mesti'
where m.name='QA Executive MeSTI Staging' and exists(select 1 from public.role_permissions rp join public.permissions p on p.id=rp.permission_id where rp.role_id=m.role_id and p.code='factory_mesti_inspection.view');
alter table feedx_integrations.machine_credentials add column issuance_request_id uuid unique,add column issued_by uuid;
create index machine_credentials_identity_created on feedx_integrations.machine_credentials(identity_id,created_at desc,id);
create table feedx_integrations.access_events (
  id bigint generated always as identity primary key,identity_id uuid not null references feedx_integrations.machine_identities(id),
  credential_id uuid references feedx_integrations.machine_credentials(id),occurred_at timestamptz not null default clock_timestamp(),
  method text not null,tool text,outcome text not null check(outcome in ('success','denied','failed')),
  failure_reason text,source text not null check(source in ('external','admin_probe')),actor_id uuid
);
create index access_events_identity_time on feedx_integrations.access_events(identity_id,occurred_at desc,id desc);
alter table feedx_integrations.access_events enable row level security;
revoke all on feedx_integrations.access_events from public,anon,authenticated;

create function feedx_integrations.can_manage(p_identity uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select auth.uid() is not null and public.current_user_has_role_management_permission('edit')
    and exists(select 1 from feedx_integrations.machine_identities m join public.roles r on r.id=m.role_id where m.id=p_identity
      and lower(r.name) not in ('owner','admin') and public.role_is_editable_by_current_user(r.id)
      and not exists(select 1 from public.role_permissions rp where rp.role_id=r.id and not public.current_user_can_assign_permission(rp.permission_id)))
$$;
revoke all on function feedx_integrations.can_manage(uuid) from public,anon,authenticated;

create function public.external_agents_admin_data(p_identity_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if auth.uid() is null or not public.current_user_has_role_management_permission('view') then raise exception using errcode='42501',message='Role Settings view permission is required.';end if;
  return jsonb_build_object('connections',coalesce((select jsonb_agg(jsonb_build_object(
    'id',m.id,'name',m.name,'provider',m.provider,'enabled',m.enabled,'role_name',r.name,'role_active',r.is_active,
    'workspace',a.workspace,'scope',a.scope,'permission',a.permission_code,'permission_granted',exists(select 1 from public.role_permissions rp join public.permissions p on p.id=rp.permission_id where rp.role_id=m.role_id and p.code=a.permission_code),
    'endpoint',a.endpoint,'tools',coalesce(a.tools,'[]'),'can_manage',feedx_integrations.can_manage(m.id),
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
    'access_history_since','2026-10-29T00:00:00Z','history_note','Access history starts with this deployment. Earlier access was not recorded; missing history does not prove no connection.');
end $$;
revoke all on function public.external_agents_admin_data(uuid) from public,anon;
grant execute on function public.external_agents_admin_data(uuid) to authenticated;

create function public.external_agents_authorize_management(p_identity_id uuid) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if not feedx_integrations.can_manage(p_identity_id) then raise exception using errcode='42501',message='Role Settings edit authority for this agent is required.';end if;
  return (select jsonb_build_object('endpoint',a.endpoint,'permission',a.permission_code,'tools',a.tools) from feedx_integrations.machine_identities m join feedx_integrations.adapters a on a.key=m.adapter_key where m.id=p_identity_id);
end $$;
revoke all on function public.external_agents_authorize_management(uuid) from public,anon;
grant execute on function public.external_agents_authorize_management(uuid) to authenticated;

-- The only secret-bearing response is this explicit one-time issuance operation.
create function public.external_agents_rotate_credential(p_identity_id uuid,p_expected_credential_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_latest uuid;v_new uuid;v_token text;v_expiry timestamptz:=clock_timestamp()+interval '30 days';
begin
  if not feedx_integrations.can_manage(p_identity_id) then raise exception using errcode='42501',message='Role Settings edit authority for this agent is required.';end if;
  if p_request_id is null then raise exception using errcode='22023',message='A rotation request ID is required.';end if;
  perform 1 from feedx_integrations.machine_identities where id=p_identity_id for update;
  perform 1 from public.roles r join feedx_integrations.machine_identities m on m.role_id=r.id where m.id=p_identity_id for share of r;
  if not feedx_integrations.can_manage(p_identity_id) then raise exception using errcode='42501',message='Agent management authority changed.';end if;
  if exists(select 1 from feedx_integrations.machine_credentials where issuance_request_id=p_request_id) then
    raise exception using errcode='55000',message='This rotation was already issued. Credentials cannot be revealed again. Refresh the connection before starting a new rotation.';
  end if;
  select id into v_latest from feedx_integrations.machine_credentials where identity_id=p_identity_id order by created_at desc,id desc limit 1;
  if v_latest is distinct from p_expected_credential_id then raise exception using errcode='40001',message='Credential state changed. Refresh the connection before rotating.';end if;
  if not exists(select 1 from feedx_integrations.machine_identities m join public.roles r on r.id=m.role_id join feedx_integrations.adapters a on a.key=m.adapter_key
    join public.permissions p on p.code=a.permission_code join public.role_permissions rp on rp.role_id=r.id and rp.permission_id=p.id where m.id=p_identity_id and m.enabled and r.is_active) then
    raise exception using errcode='42501',message='Agent identity, role and inspection permission must be active before rotation.';end if;
  v_token:='fxm_'||translate(rtrim(encode(extensions.gen_random_bytes(32),'base64'),'='),'+/','-_');
  update feedx_integrations.machine_credentials set revoked_at=clock_timestamp() where identity_id=p_identity_id and revoked_at is null;
  insert into feedx_integrations.machine_credentials(identity_id,token_hash,created_at,expires_at,issuance_request_id,issued_by)
    values(p_identity_id,encode(extensions.digest(v_token,'sha256'),'hex'),clock_timestamp(),v_expiry,p_request_id,auth.uid()) returning id into v_new;
  return jsonb_build_object('credential_id',v_new,'expires_at',v_expiry,'one_time_credential',v_token);
end $$;
revoke all on function public.external_agents_rotate_credential(uuid,uuid,uuid) from public,anon;
grant execute on function public.external_agents_rotate_credential(uuid,uuid,uuid) to authenticated;

create function public.external_agents_revoke_credential(p_identity_id uuid,p_credential_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not feedx_integrations.can_manage(p_identity_id) then raise exception using errcode='42501',message='Role Settings edit authority for this agent is required.';end if;
  perform 1 from feedx_integrations.machine_identities where id=p_identity_id for update;
  perform 1 from public.roles r join feedx_integrations.machine_identities m on m.role_id=r.id where m.id=p_identity_id for share of r;
  if not feedx_integrations.can_manage(p_identity_id) then raise exception using errcode='42501',message='Agent management authority changed.';end if;
  if not exists(select 1 from feedx_integrations.machine_credentials where id=p_credential_id and identity_id=p_identity_id) then raise exception using errcode='P0002',message='Credential unavailable for this agent.';end if;
  update feedx_integrations.machine_credentials set revoked_at=clock_timestamp() where id=p_credential_id and revoked_at is null;
  return jsonb_build_object('revoked',true,'credential_id',p_credential_id);
end $$;
revoke all on function public.external_agents_revoke_credential(uuid,uuid) from public,anon;
grant execute on function public.external_agents_revoke_credential(uuid,uuid) to authenticated;

-- Only the trusted connector server may append transport observations. Never persist request text or hashes.
create function public.external_agents_record_access(p_token_hash text,p_method text,p_tool text,p_outcome text,p_reason text,p_source text default 'external')
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_credential feedx_integrations.machine_credentials%rowtype;v_reason text;
begin
  select * into v_credential from feedx_integrations.machine_credentials where token_hash=p_token_hash;
  if not found then return;end if;
  if p_method not in ('initialize','tools/list','tools/call','ping','unsupported') or p_outcome not in ('success','denied','failed') or p_source not in ('external','admin_probe') then return;end if;
  v_reason:=case when p_reason in ('credential_denied','tool_denied','invalid_request','evidence_unavailable','origin_denied','endpoint_unavailable','probe_failed','unsupported_version','method_denied') then p_reason else null end;
  insert into feedx_integrations.access_events(identity_id,credential_id,method,tool,outcome,failure_reason,source)
    values(v_credential.identity_id,v_credential.id,p_method,case when exists(select 1 from feedx_integrations.machine_identities m join feedx_integrations.adapters a on a.key=m.adapter_key cross join jsonb_array_elements(a.tools)t where m.id=v_credential.identity_id and t->>'name'=p_tool) then p_tool when p_tool is not null then 'unsupported' else null end,p_outcome,v_reason,p_source);
end $$;
revoke all on function public.external_agents_record_access(text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.external_agents_record_access(text,text,text,text,text,text) to service_role;

create function public.external_agents_validate_probe(p_identity_id uuid,p_token text) returns void language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_permission text;
begin
  perform public.external_agents_authorize_management(p_identity_id);
  select a.permission_code into v_permission from feedx_integrations.machine_identities m join feedx_integrations.adapters a on a.key=m.adapter_key where m.id=p_identity_id;
  if v_permission is null or feedx_integrations.authorize(p_token,v_permission) is distinct from p_identity_id then
    raise exception using errcode='42501',message='Credential is not valid for this agent.';end if;
end $$;
revoke all on function public.external_agents_validate_probe(uuid,text) from public,anon;
grant execute on function public.external_agents_validate_probe(uuid,text) to authenticated;
