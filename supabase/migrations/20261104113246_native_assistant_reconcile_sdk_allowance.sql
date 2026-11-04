alter table feedx_integrations.native_assistant_realtime_reservations
 add column allowance_exclusion text check (allowance_exclusion = 'sdk_pre_audio_502');

do $migration$
declare definition text;
begin
 -- This reservation ended during the Edge 502, before a client secret reached the browser.
 update feedx_integrations.native_assistant_realtime_reservations
 set allowance_exclusion='sdk_pre_audio_502'
 where sdk_baseline and provider='openai' and tool_reads=0
 and created_at='2026-11-04 11:27:08.200951+00' and ended_at='2026-11-04 11:27:09.074978+00';
 if not found then raise exception 'Expected failed Staging SDK reservation was not found'; end if;
 definition:=pg_get_functiondef('public.native_assistant_reserve_realtime(uuid,uuid,uuid,text,text)'::regprocedure);
 if strpos(definition,'from feedx_integrations.native_assistant_realtime_reservations)>=(case')=0 then
  raise exception 'Realtime allowance contract changed';
 end if;
 execute replace(definition,'from feedx_integrations.native_assistant_realtime_reservations)>=(case',
 'from feedx_integrations.native_assistant_realtime_reservations where allowance_exclusion is null)>=(case');
end $migration$;

create function public.native_assistant_sdk_remaining()
returns integer language sql stable security definer set search_path=pg_catalog,feedx_integrations,pg_temp as $$
 select greatest(0,least(1,9-count(*)))::integer
 from feedx_integrations.native_assistant_realtime_reservations where allowance_exclusion is null;
$$;
revoke all on function public.native_assistant_sdk_remaining() from public,anon,authenticated;
grant execute on function public.native_assistant_sdk_remaining() to service_role;
