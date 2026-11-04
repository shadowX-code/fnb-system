alter table feedx_integrations.native_assistant_realtime_reservations
 add column sdk_secret_issued_at timestamptz,
 add column sdk_mint_rejected_at timestamptz,
 add column sdk_connected_at timestamptz,
 add column sdk_usage_observed_at timestamptz;

-- Attribute the confirmed mint rejection without changing its allowance treatment.
update feedx_integrations.native_assistant_realtime_reservations
set sdk_mint_rejected_at='2026-11-04 12:48:42.922+00'
where sdk_baseline and provider='openai'
 and created_at='2026-11-04 12:48:42.041249+00'
 and ended_at='2026-11-04 12:48:42.960552+00';

do $migration$
declare definition text;
begin
 definition:=pg_get_functiondef('public.native_assistant_reserve_realtime(uuid,uuid,uuid,text,text)'::regprocedure);
 if strpos(definition,' if p_action=''end'' then')=0 then raise exception 'Reservation contract changed'; end if;
 execute replace(definition,' if p_action=''end'' then',$actions$
 if p_action in ('sdk_issued','sdk_rejected','sdk_connected','sdk_usage_observed') then
  update feedx_integrations.native_assistant_realtime_reservations set
   sdk_secret_issued_at=case when p_action='sdk_issued' then coalesce(sdk_secret_issued_at,now()) else sdk_secret_issued_at end,
   sdk_mint_rejected_at=case when p_action='sdk_rejected' then coalesce(sdk_mint_rejected_at,now()) else sdk_mint_rejected_at end,
   sdk_connected_at=case when p_action='sdk_connected' then coalesce(sdk_connected_at,now()) else sdk_connected_at end,
   sdk_usage_observed_at=case when p_action='sdk_usage_observed' then coalesce(sdk_usage_observed_at,now()) else sdk_usage_observed_at end
  where actor=p_actor and request_id=p_request and session_id=p_session and provider='openai' and p_provider='openai'
   and sdk_baseline and ended_at is null and created_at>now()-interval '4 minutes'
   and (p_action in ('sdk_issued','sdk_rejected') and sdk_secret_issued_at is null and sdk_mint_rejected_at is null
     or p_action='sdk_connected' and sdk_secret_issued_at is not null
     or p_action='sdk_usage_observed' and sdk_connected_at is not null);
  return;
 elsif p_action='end' then$actions$);
end $migration$;
