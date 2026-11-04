-- A separate reservation ledger keeps evaluation requests out of Render's quota.
create table feedx_integrations.native_assistant_realtime_reservations (
 actor uuid not null references auth.users(id) on delete cascade,
 request_id uuid not null,
 created_at timestamptz not null default now(),
 primary key (actor, request_id)
);
alter table feedx_integrations.native_assistant_realtime_reservations enable row level security;
revoke all on feedx_integrations.native_assistant_realtime_reservations from public, anon, authenticated;

create function public.native_assistant_reserve_realtime(p_actor uuid,p_session uuid,p_request uuid)
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
 delete from feedx_integrations.native_assistant_realtime_reservations where created_at < now()-interval '1 day';
 if (select count(*) from feedx_integrations.native_assistant_realtime_reservations)>=12 or exists(
  select 1 from feedx_integrations.native_assistant_realtime_reservations where actor=p_actor and created_at > now()-interval '30 seconds'
 ) then raise exception 'voice_request_limit' using errcode='54000'; end if;
 insert into feedx_integrations.native_assistant_realtime_reservations(actor,request_id) values(p_actor,p_request)
 on conflict do nothing;
 if not found then raise exception 'request_conflict' using errcode='40001'; end if;
end $$;
revoke all on function public.native_assistant_reserve_realtime(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.native_assistant_reserve_realtime(uuid,uuid,uuid) to service_role;
