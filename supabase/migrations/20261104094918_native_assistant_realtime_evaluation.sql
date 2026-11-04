-- A separate reservation ledger keeps evaluation requests out of Render's quota.
create table feedx_integrations.native_assistant_realtime_reservations (
 actor uuid not null references auth.users(id) on delete cascade,
 request_id uuid not null,
 session_id uuid not null,
 provider text not null check(provider in ('openai','grok')),
 ended_at timestamptz,
 tool_reads integer not null default 0,
 created_at timestamptz not null default now(),
 primary key (actor, request_id)
);
alter table feedx_integrations.native_assistant_realtime_reservations enable row level security;
revoke all on feedx_integrations.native_assistant_realtime_reservations from public, anon, authenticated;

create function public.native_assistant_reserve_realtime(p_actor uuid,p_session uuid,p_request uuid,p_provider text,p_action text)
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
 delete from feedx_integrations.native_assistant_realtime_reservations where created_at < now()-interval '1 day';
 if (select count(*) from feedx_integrations.native_assistant_realtime_reservations)>=12 or exists(
  select 1 from feedx_integrations.native_assistant_realtime_reservations where actor=p_actor and ended_at is null and created_at > now()-interval '4 minutes'
 ) then raise exception 'voice_request_limit' using errcode='54000'; end if;
 insert into feedx_integrations.native_assistant_realtime_reservations(actor,request_id,session_id,provider) values(p_actor,p_request,p_session,p_provider)
 on conflict do nothing;
 if not found then raise exception 'request_conflict' using errcode='40001'; end if;
end $$;
revoke all on function public.native_assistant_reserve_realtime(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.native_assistant_reserve_realtime(uuid,uuid,uuid,text,text) to service_role;
