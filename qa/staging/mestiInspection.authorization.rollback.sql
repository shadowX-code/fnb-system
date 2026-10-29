-- Disposable security metadata only; no business-record mutation. Always rolls back.
begin;
do $qa$
declare
  v_role uuid;v_machine uuid;v_credential uuid;v_permission uuid;
  v_token text:='fxm_'||repeat('Q',43);v_result jsonb;v_reference text;v_tool text;v_audit_count bigint;
begin
  insert into public.roles(name,is_active,is_system_role,outlet_access_type)
    values('MeSTI isolated authorization QA '||gen_random_uuid(),true,false,'none') returning id into v_role;
  select id into strict v_permission from public.permissions where code='factory_mesti_inspection.view';
  insert into public.role_permissions(role_id,permission_id) values(v_role,v_permission);
  insert into feedx_integrations.machine_identities(name,role_id,enabled)
    values('MeSTI isolated machine QA '||gen_random_uuid(),v_role,true) returning id into v_machine;
  insert into feedx_integrations.machine_credentials(identity_id,token_hash,expires_at)
    values(v_machine,encode(extensions.digest(v_token,'sha256'),'hex'),now()+interval '1 day') returning id into v_credential;
  select count(*) into v_audit_count from public.audit_logs where metadata->'after'->>'id' in (v_machine::text,v_credential::text);
  v_result:=public.factory_mesti_inspection(v_token,'get_mesti_daily_status','2026-10-28','2026-10-28');
  if jsonb_array_length(v_result->'coverage')<>8 then raise exception 'Expected coverage for every module.'; end if;
  if exists(select 1 from jsonb_array_elements(v_result->'coverage') c where c->>'date'<>'2026-10-28') then raise exception 'Coverage date mismatch.'; end if;
  v_reference:=v_result->'findings'->0->>'evidence_reference';
  perform public.factory_mesti_inspection(v_token,'get_mesti_evidence_details','2026-10-28','2026-10-28',v_reference);
  foreach v_tool in array array['list_mesti_exceptions','list_pending_verifications','get_mesti_requirement_schedule'] loop
    perform public.factory_mesti_inspection(v_token,v_tool,'2026-10-28','2026-10-28');
  end loop;
  if v_audit_count<>(select count(*) from public.audit_logs where metadata->'after'->>'id' in (v_machine::text,v_credential::text)) then
    raise exception 'Inspection reads wrote security audit records.';
  end if;
  foreach v_tool in array array['complete','verify','edit','delete','get_employee_health','factory_production.view','arbitrary_sql'] loop
    begin
      perform public.factory_mesti_inspection(v_token,v_tool,'2026-10-28','2026-10-28');
      raise exception 'Unapproved tool was accepted: %',v_tool;
    exception when insufficient_privilege then null; end;
  end loop;
  begin
    perform public.factory_mesti_inspection(v_token,'get_mesti_daily_status','2026-10-01','2026-11-01');
    raise exception 'Unbounded date range accepted.';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.factory_mesti_inspection(v_token,'get_mesti_evidence_details','2026-10-28','2026-10-28','health_declaration:2026-10-27:coverage');
    raise exception 'Cross-date evidence reference accepted.';
  exception when invalid_parameter_value then null; end;
  update feedx_integrations.machine_credentials set created_at=now()-interval '1 day',expires_at=now()-interval '1 second' where id=v_credential;
  begin perform public.factory_mesti_inspection(v_token,'authorize');raise exception 'Expired credential accepted.';
  exception when insufficient_privilege then null;end;
  update feedx_integrations.machine_credentials set expires_at=now()+interval '1 day',revoked_at=now() where id=v_credential;
  begin perform public.factory_mesti_inspection(v_token,'authorize');raise exception 'Revoked credential accepted.';
  exception when insufficient_privilege then null;end;
  update feedx_integrations.machine_credentials set revoked_at=null where id=v_credential;
  if not exists(select 1 from public.audit_logs where action='external_machine_machine_credentials_update'
    and metadata->'after'->>'id'=v_credential::text and metadata->'after'->>'revoked_at' is not null) then
    raise exception 'Credential revocation audit unavailable.';
  end if;
  if exists(select 1 from public.audit_logs where action like 'external_machine_%'
    and metadata::text like '%'||encode(extensions.digest(v_token,'sha256'),'hex')||'%') then
    raise exception 'Credential hash leaked into audit.';
  end if;
  update feedx_integrations.machine_identities set enabled=false where id=v_machine;
  begin perform public.factory_mesti_inspection(v_token,'authorize');raise exception 'Disabled identity accepted.';
  exception when insufficient_privilege then null;end;
  update feedx_integrations.machine_identities set enabled=true where id=v_machine;
  delete from public.role_permissions where role_id=v_role;
  begin perform public.factory_mesti_inspection(v_token,'authorize');raise exception 'Removed Role Settings permission accepted.';
  exception when insufficient_privilege then null;end;
  insert into public.role_permissions values(v_role,v_permission);
  update public.roles set is_active=false where id=v_role;
  begin perform public.factory_mesti_inspection(v_token,'authorize');raise exception 'Inactive role accepted.';
  exception when insufficient_privilege then null;end;
  update public.roles set is_active=true where id=v_role;
  execute 'set local role anon';
  perform public.factory_mesti_inspection(v_token,'get_mesti_daily_status','2026-10-28','2026-10-28');
  begin perform 1 from feedx_integrations.machine_credentials;raise exception 'Credential table exposed.';
  exception when insufficient_privilege then null;end;
  begin perform feedx_integrations.mesti_rows('2026-10-28','2026-10-28');raise exception 'Internal projection exposed.';
  exception when insufficient_privilege then null;end;
  begin perform public.factory_mesti_complete_cleaning_occurrence(gen_random_uuid(),null);raise exception 'Mutation authority exposed.';
  exception when insufficient_privilege then null;end;
  execute 'set local role postgres';
end $qa$;
rollback;
select 'PASS: all five tools, expiry, revocation and safe audit, disabled identity/role, permission removal, tool denial, bounded dates, reference isolation, private tables/projection and business mutation denial' as authorization_result;
