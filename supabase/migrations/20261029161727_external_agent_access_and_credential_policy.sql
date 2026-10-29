-- Existing credentials are never updated by this policy migration.
alter table feedx_integrations.adapters add column credential_days integer[] not null default array[30,90,180], add column credential_default_days integer not null default 90;
alter table feedx_integrations.adapters add constraint credential_policy check(cardinality(credential_days)>0 and credential_days <@ array[30,90,180] and credential_default_days=any(credential_days));
alter table feedx_integrations.machine_credentials drop constraint machine_credentials_check;
alter table feedx_integrations.machine_credentials add constraint machine_credentials_check check(expires_at>created_at and expires_at<=created_at+interval '180 days');
do $$declare d text;begin
 select pg_get_functiondef('public.external_agents_rotate_credential(uuid,uuid,uuid)'::regprocedure) into d;
 d:=replace(d,'p_request_id uuid)','p_request_id uuid, p_validity_days integer)');
 d:=replace(d,'v_expiry timestamptz:=clock_timestamp()+interval ''30 days''','v_expiry timestamptz;v_days integer');
 d:=replace(d,'  v_token:=', $policy$
  select coalesce(p_validity_days,a.credential_default_days) into v_days from feedx_integrations.adapters a join feedx_integrations.machine_identities m on m.adapter_key=a.key where m.id=p_identity_id and coalesce(p_validity_days,a.credential_default_days)=any(a.credential_days);
  if v_days is null then raise exception using errcode='22023',message='Credential validity is not allowed by policy.';end if;
  v_expiry:=clock_timestamp()+make_interval(days=>v_days);
  v_token:=$policy$);
 execute d;
 execute 'revoke all on function public.external_agents_rotate_credential(uuid,uuid,uuid,integer) from public,anon';
 execute 'grant execute on function public.external_agents_rotate_credential(uuid,uuid,uuid,integer) to authenticated';
 select pg_get_functiondef('public.external_agents_register(uuid,text,text,text,text[])'::regprocedure) into d;
 d:=replace(d,'p_tool_ids text[])','p_tool_ids text[], p_validity_days integer)');
 d:=replace(d,'external_agents_rotate_credential(v_identity,null,gen_random_uuid())','external_agents_rotate_credential(v_identity,null,gen_random_uuid(),p_validity_days)');
 execute d;
 execute 'revoke all on function public.external_agents_register(uuid,text,text,text,text[],integer) from public,anon';
 execute 'grant execute on function public.external_agents_register(uuid,text,text,text,text[],integer) to authenticated';
 -- Keep old call signatures at their original 30-day behavior through the same authority.
 execute $wrapper$create or replace function public.external_agents_rotate_credential(p_identity_id uuid,p_expected_credential_id uuid,p_request_id uuid) returns jsonb language sql security invoker set search_path=public,pg_temp as 'select public.external_agents_rotate_credential(p_identity_id,p_expected_credential_id,p_request_id,30)'$wrapper$;
 execute $wrapper$create or replace function public.external_agents_register(p_request_id uuid,p_name text,p_provider text,p_adapter_key text,p_tool_ids text[]) returns jsonb language sql security invoker set search_path=public,pg_temp as 'select public.external_agents_register(p_request_id,p_name,p_provider,p_adapter_key,p_tool_ids,30)'$wrapper$;
end $$;
create function feedx_integrations.effective_access(p_identity uuid) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('summary',case when not m.enabled then 'Disabled' when not r.is_active or not exists(select 1 from public.role_permissions rp join public.permissions p on p.id=rp.permission_id where rp.role_id=m.role_id and p.code=a.permission_code) then 'Access blocked' else coalesce(nullif(concat_ws(' · ',(select string_agg(c.label,', ' order by c.sort_order) from feedx_integrations.capabilities c join public.permissions p on p.code=c.permission_code join public.role_permissions rp on rp.permission_id=p.id and rp.role_id=m.role_id where c.implemented and c.adapter_key=m.adapter_key)),''),'No access granted') end)
 from feedx_integrations.machine_identities m join public.roles r on r.id=m.role_id join feedx_integrations.adapters a on a.key=m.adapter_key where m.id=p_identity;
$$;
revoke all on function feedx_integrations.effective_access(uuid) from public,anon,authenticated;
do $$declare d text;begin
 select pg_get_functiondef('public.external_agents_admin_data(uuid)'::regprocedure) into d;
 d:=replace(d,'''workspace'',a.workspace','''credential_policy'',jsonb_build_object(''days'',a.credential_days,''default_days'',a.credential_default_days),''workspace'',a.workspace');
 d:=replace(d,'''id'',m.id,''name'',m.name','''effective_access'',feedx_integrations.effective_access(m.id),''id'',m.id,''name'',m.name');
 execute d;
end $$;
