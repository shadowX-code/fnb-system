create table feedx_integrations.native_assistant_providers (
 provider text primary key check(provider in ('openai','grok')),
 secret_id uuid,
 approval_reference text,
 credential_revision integer not null default 0,
 tested_at timestamptz,
 test_error text,
 test_started_at timestamptz,
 active_voice text,
 updated_by uuid,
 updated_at timestamptz not null default now()
);
alter table feedx_integrations.native_assistant_providers enable row level security;
revoke all on feedx_integrations.native_assistant_providers from public,anon,authenticated;
create unique index native_assistant_one_active_voice on feedx_integrations.native_assistant_providers ((true)) where active_voice is not null;
insert into feedx_integrations.native_assistant_providers(provider) values ('openai'),('grok');

create function public.native_assistant_provider_registry(p_actor uuid,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public,feedx_integrations,pg_temp as $$
declare entry feedx_integrations.native_assistant_providers%rowtype; authority jsonb; credential text; ref text; selected_voice text;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'service_only' using errcode='42501'; end if;
 authority := public.native_assistant_service(p_actor,case when p_action='runtime' then 'status' else 'configuration' end);
 if p_action in ('list','runtime') then
  return (select jsonb_build_object('can_edit',(authority->>'can_edit')::boolean,'providers',jsonb_agg(
    jsonb_build_object('provider',provider,'configured',secret_id is not null,'tested_at',tested_at,'test_error',test_error,'active_voice',active_voice,
    'approval_reference',case when p_action='list' then approval_reference else null end) order by provider))
   from feedx_integrations.native_assistant_providers);
 end if;
 if (authority->>'can_edit')::boolean is distinct from true then raise exception 'settings_edit_required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('native-assistant-provider-registry',0));
 select * into entry from feedx_integrations.native_assistant_providers where provider=p_payload->>'provider' for update;
 if not found then raise exception 'configuration_invalid' using errcode='22023'; end if;
 if p_action='put' then
  credential:=p_payload->>'credential'; ref:=btrim(p_payload->>'approval_reference');
  if credential is null or length(credential) not between 20 and 512 or credential ~ '[[:space:]]'
   or ref is null or length(ref) not between 1 and 120 then raise exception 'configuration_invalid' using errcode='22023'; end if;
  if entry.secret_id is null then entry.secret_id:=vault.create_secret(credential); else perform vault.update_secret(entry.secret_id,credential); end if;
  update feedx_integrations.native_assistant_providers set secret_id=entry.secret_id,approval_reference=ref,
   credential_revision=credential_revision+1,tested_at=null,test_error=null,test_started_at=null,active_voice=null,updated_by=p_actor,updated_at=now() where provider=entry.provider;
 elsif p_action='revoke' then
  if entry.secret_id is not null then delete from vault.secrets where id=entry.secret_id; end if;
  update feedx_integrations.native_assistant_providers set secret_id=null,approval_reference=null,credential_revision=credential_revision+1,
   tested_at=null,test_error=null,test_started_at=null,active_voice=null,updated_by=p_actor,updated_at=now() where provider=entry.provider;
 elsif p_action='test_finish' then
  if entry.credential_revision is distinct from (p_payload->>'revision')::integer then raise exception 'configuration_changed' using errcode='40001'; end if;
  update feedx_integrations.native_assistant_providers set test_error=left(p_payload->>'error',80),
   tested_at=case when p_payload->>'error' is null then now() else tested_at end
  where provider=entry.provider;
 elsif p_action='activate' then
  selected_voice:=p_payload->>'voice';
  if entry.secret_id is null or entry.tested_at is null or entry.test_error is not null then raise exception 'connection_test_required' using errcode='55000'; end if;
  if selected_voice is null or not (entry.provider='openai' and selected_voice in ('cedar','marin','echo','ash','alloy') or entry.provider='grok' and selected_voice='eve') then raise exception 'configuration_invalid' using errcode='22023'; end if;
  update feedx_integrations.native_assistant_providers set active_voice=null where active_voice is not null;
  update feedx_integrations.native_assistant_providers set active_voice=selected_voice,updated_by=p_actor,updated_at=now() where provider=entry.provider;
 elsif p_action='fallback' then
  update feedx_integrations.native_assistant_providers set active_voice=null,updated_by=p_actor,updated_at=now() where active_voice is not null;
 elsif p_action in ('key','test_key') then
  if entry.secret_id is null or (p_action='key' and (entry.active_voice is null or entry.test_error is not null)) then raise exception 'realtime_not_authorized' using errcode='42501'; end if;
  if p_action='test_key' then
   if entry.test_started_at > now()-interval '1 minute' then raise exception 'voice_request_limit' using errcode='54000'; end if;
   update feedx_integrations.native_assistant_providers set test_started_at=now() where provider=entry.provider;
  end if;
  select decrypted_secret into credential from vault.decrypted_secrets where id=entry.secret_id;
  if credential is null then raise exception 'realtime_not_authorized' using errcode='42501'; end if;
  return jsonb_build_object('credential',credential,'approval_reference',entry.approval_reference,'revision',entry.credential_revision,'active_voice',entry.active_voice);
 else raise exception 'invalid_request' using errcode='22023';
 end if;
 return '{}'::jsonb;
end $$;
revoke all on function public.native_assistant_provider_registry(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.native_assistant_provider_registry(uuid,text,jsonb) to service_role;

-- Cap this evaluation at eight paid attempts, including connection tests.
create or replace function public.native_assistant_reserve_realtime(p_actor uuid,p_session uuid,p_request uuid,p_provider text,p_action text)
returns void language plpgsql security definer set search_path=public,feedx_integrations,pg_temp as $$
declare allowed boolean;
begin
 if auth.role() is distinct from 'service_role' then
  raise exception 'service_only' using errcode='42501';
 end if;
 allowed := (public.native_assistant_service(p_actor,'configuration')->>'can_edit')::boolean;
 if allowed is distinct from true then raise exception 'settings_edit_required' using errcode='42501'; end if;
 -- The canonical session authority verifies ownership, expiry and scope. Its
 -- simulated caller claims are transaction-local and are only used for this read.
 perform set_config('request.jwt.claims', '{"role":"service_role"}',true);
 perform public.native_assistant_service(p_actor,'history',jsonb_build_object('session_id',p_session));
 perform pg_advisory_xact_lock(hashtextextended('native-assistant-realtime-evaluation',0));
 if p_action='end' then
  update feedx_integrations.native_assistant_realtime_reservations set ended_at=now()
  where actor=p_actor and request_id=p_request and session_id=p_session and provider=p_provider and ended_at is null;
  return;
 elsif p_action='tool' then
  update feedx_integrations.native_assistant_realtime_reservations set tool_reads=tool_reads+1
  where actor=p_actor and request_id=p_request and session_id=p_session and provider=p_provider and ended_at is null
   and created_at>now()-interval '4 minutes' and tool_reads<6;
  if not found then raise exception 'voice_request_limit' using errcode='54000'; end if;
  return;
 elsif p_action is distinct from 'start' then
  raise exception 'invalid_request' using errcode='22023';
 end if;
 if (select count(*) from feedx_integrations.native_assistant_realtime_reservations)>=8 or exists(
  select 1 from feedx_integrations.native_assistant_realtime_reservations where actor=p_actor and ended_at is null and created_at > now()-interval '4 minutes'
 ) then raise exception 'voice_request_limit' using errcode='54000'; end if;
 insert into feedx_integrations.native_assistant_realtime_reservations(actor,request_id,session_id,provider) values(p_actor,p_request,p_session,p_provider)
 on conflict do nothing;
 if not found then raise exception 'request_conflict' using errcode='40001'; end if;
end $$;
