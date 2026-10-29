-- All lifecycle operations target a disposable identity inside this rolled-back transaction.
-- The working QA Executive credential is fingerprinted before/after and never mutated.
begin;
create temporary table gateway_qa_state(owner_id uuid,role_id uuid,qa_id uuid,machine_id uuid,old_id uuid,new_id uuid,request_id uuid,token text,baseline text) on commit drop;
grant select,insert on gateway_qa_state to authenticated;
do $qa$
declare v_owner uuid;v_role uuid;v_qa uuid;v_machine uuid;v_old uuid;v_new uuid;v_request uuid:=gen_random_uuid();
  v_token text;v_result jsonb;v_data jsonb;v_baseline text;
begin
  select e.auth_user_id into strict v_owner from public.employees e join public.roles r on r.id=e.role_id
    where lower(r.name)='owner' and e.auth_user_id is not null and e.enable_system_login and e.access_state='active' limit 1;
  select id,role_id into strict v_qa,v_role from feedx_integrations.machine_identities where name='QA Executive MeSTI Staging';
  select md5(jsonb_agg(to_jsonb(c) order by c.id)::text) into v_baseline from feedx_integrations.machine_credentials c where identity_id=v_qa;
  insert into feedx_integrations.machine_identities(name,role_id,enabled,provider,adapter_key)
    values('Disposable Gateway QA '||gen_random_uuid(),v_role,true,'QA fixture','factory_mesti') returning id into v_machine;
  insert into feedx_integrations.machine_credentials(identity_id,token_hash,created_at,expires_at)
    values(v_machine,encode(extensions.digest('fxm_'||repeat('T',43),'sha256'),'hex'),now()-interval '1 hour',now()+interval '1 day') returning id into v_old;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_owner,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  v_data:=public.external_agents_admin_data(v_machine);
  if v_data->'connections'->0->>'connection_status'<>'not_observed' or jsonb_array_length(v_data->'connections'->0->'tools')<>34 then raise exception 'Connection registry incorrect.';end if;
  if v_data::text like '%token_hash%' or v_data::text like '%one_time_credential%' then raise exception 'Ordinary management data exposed credentials.';end if;
  v_result:=public.external_agents_rotate_credential(v_machine,v_old,v_request);
  v_token:=v_result->>'one_time_credential';v_new:=(v_result->>'credential_id')::uuid;
  if v_token !~ '^fxm_[A-Za-z0-9_-]{43}$' then raise exception 'Invalid credential entropy/format.';end if;
  begin perform public.external_agents_rotate_credential(v_machine,v_old,v_request);raise exception 'Issuance replay accepted.';exception when object_not_in_prerequisite_state then null;end;
  begin perform public.external_agents_rotate_credential(v_machine,v_old,gen_random_uuid());raise exception 'Stale rotation accepted.';exception when serialization_failure then null;end;
  insert into pg_temp.gateway_qa_state values(v_owner,v_role,v_qa,v_machine,v_old,v_new,v_request,v_token,v_baseline);
end $qa$;
-- New request snapshot: issuance is complete before credential authentication begins.
do $verify$
declare v_owner uuid;v_role uuid;v_qa uuid;v_machine uuid;v_old uuid;v_new uuid;v_request uuid;v_token text;v_result jsonb;v_data jsonb;v_baseline text;
begin
  select owner_id,role_id,qa_id,machine_id,old_id,new_id,request_id,token,baseline into v_owner,v_role,v_qa,v_machine,v_old,v_new,v_request,v_token,v_baseline from pg_temp.gateway_qa_state;
  -- Management API executes the whole file in one request timestamp. Align only this
  -- disposable fixture's activation with that request; real rotation/auth uses separate HTTPS requests.
  execute 'set local role postgres';
  update feedx_integrations.machine_credentials set created_at=statement_timestamp() where id=v_new and identity_id=v_machine;
  execute 'set local role authenticated';
  perform public.external_agents_validate_probe(v_machine,v_token);
  begin perform public.external_agents_validate_probe(v_qa,v_token);raise exception 'Cross-identity credential accepted.';exception when insufficient_privilege then null;end;
  execute 'set local role postgres';
  if not exists(select 1 from feedx_integrations.machine_credentials where id=v_old and revoked_at is not null) then raise exception 'Previous credential not revoked.';end if;
  if not exists(select 1 from feedx_integrations.machine_credentials where id=v_new and issued_by=v_owner and issuance_request_id=v_request) then raise exception 'Issuance actor/request missing.';end if;
  perform public.external_agents_record_access(encode(extensions.digest(v_token,'sha256'),'hex'),'initialize',null,'success',null,'admin_probe');
  execute 'set local role authenticated';
  v_data:=public.external_agents_admin_data(v_machine);
  if v_data->'connections'->0->>'connection_status'<>'not_observed' then raise exception 'Admin probe misrepresented external connectivity.';end if;
  execute 'set local role postgres';
  perform public.external_agents_record_access(encode(extensions.digest(v_token,'sha256'),'hex'),'tools/call','get_mesti_daily_status','success',null,'external');
  perform public.external_agents_record_access(encode(extensions.digest(v_token,'sha256'),'hex'),'tools/call','SENSITIVE_UNAPPROVED_TOOL','failed','SENSITIVE_FAILURE_DETAIL','external');
  execute 'set local role authenticated';
  v_data:=public.external_agents_admin_data(v_machine);
  if v_data->'connections'->0->>'connection_status'<>'mcp_observed' then raise exception 'Actual successful MCP observation unavailable.';end if;
  if v_data::text like '%SENSITIVE_%' or v_data::text like '%'||v_token||'%' then raise exception 'Access history leaked raw request or credential.';end if;
  if jsonb_array_length(v_data->'access_events')<>3 then raise exception 'Access visibility incomplete.';end if;
  perform public.external_agents_revoke_credential(v_machine,v_new);
  perform public.external_agents_revoke_credential(v_machine,v_new);
  begin perform public.external_agents_validate_probe(v_machine,v_token);raise exception 'Revoked credential accepted.';exception when insufficient_privilege then null;end;
  begin perform public.external_agents_revoke_credential(v_qa,v_new);raise exception 'Cross-identity revoke accepted.';exception when no_data_found then null;end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'role','authenticated')::text,true);
  begin perform public.external_agents_admin_data(null);raise exception 'Unauthorized visibility accepted.';exception when insufficient_privilege then null;end;
  begin perform public.external_agents_rotate_credential(v_machine,v_new,gen_random_uuid());raise exception 'Unauthorized rotation accepted.';exception when insufficient_privilege then null;end;
  execute 'set local role anon';
  begin perform public.external_agents_admin_data(null);raise exception 'Anonymous management accepted.';exception when insufficient_privilege then null;end;
  begin perform public.external_agents_record_access(null,'initialize',null,'success',null);raise exception 'Anonymous forged transport event accepted.';exception when insufficient_privilege then null;end;
  execute 'set local role postgres';
  if v_baseline is distinct from (select md5(jsonb_agg(to_jsonb(c) order by c.id)::text) from feedx_integrations.machine_credentials c where identity_id=v_qa) then raise exception 'Working QA Executive credential changed.';end if;
  if not exists(select 1 from public.audit_logs where action='external_machine_machine_credentials_update' and metadata->'after'->>'id'=v_new::text and user_id=v_owner) then raise exception 'Revocation actor audit missing.';end if;
  if exists(select 1 from public.audit_logs where action like 'external_machine_%' and (metadata::text like '%'||v_token||'%' or metadata::text like '%'||encode(extensions.digest(v_token,'sha256'),'hex')||'%')) then raise exception 'Audit leaked secret.';end if;
end $verify$;
rollback;
select 'PASS: registered connection and resource catalog, one-time rotation/replay/concurrency guards, exact identity isolation, credential probe/revocation, Role Settings/anonymous denial, safe access visibility, external-vs-admin connectivity, actor audit; working QA credential unchanged' as result;
