-- Preserve existing private authority and historical usage. Pin only new provider bindings.
alter table feedx_integrations.assistant_voice_leases
 add column bound_model text, add column bound_transcription_model text;

do $migration$
declare
 definition text := pg_get_functiondef('public.native_assistant_voice_connection(text,jsonb)'::regprocedure);
 binding text := 'heartbeat_at=now(),connect_config=null,';
begin
 if strpos(definition,binding)=0 then raise exception 'Voice connection binding changed'; end if;
 execute replace(definition,binding,binding||
  'bound_model=p_payload->>''model'',bound_transcription_model=p_payload->>''transcription_model'',');
end $migration$;

create or replace function public.native_assistant_voice_usage(p_actor uuid,p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path=public,feedx_integrations,pg_temp as $$
declare pol feedx_integrations.assistant_voice_policy%rowtype; editable boolean; admission text; result jsonb; usage_page jsonb; metering jsonb;
 period text := coalesce(p_payload->>'period','month'); history_status text := coalesce(p_payload->>'status','all');
 history_page integer := coalesce((p_payload->>'page')::integer,1); period_start timestamptz;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'service_only' using errcode='42501'; end if;
 perform public.native_assistant_service(p_actor,'status');
 editable:=public.current_user_has_permission('roles.edit') and public.current_user_has_permission('roles.view');
 perform pg_advisory_xact_lock(hashtextextended('assistant-voice-policy:staging',0));
 select * into pol from feedx_integrations.assistant_voice_policy where environment='staging' for update;
 if p_action='save' then
  if not editable then raise exception 'settings_edit_required' using errcode='42501'; end if;
  if (p_payload->>'revision')::integer is distinct from pol.revision then raise exception 'configuration_changed' using errcode='40001'; end if;
  if jsonb_typeof(p_payload->'enabled')<>'boolean' or (p_payload->>'maximum_seconds')::integer not between 30 and 180 or (p_payload->>'concurrency')::integer not between 1 and 8 or (p_payload->>'daily_sessions')::integer not between 0 and 100 then raise exception 'configuration_invalid'; end if;
  update feedx_integrations.assistant_voice_policy set enabled=(p_payload->>'enabled')::boolean,max_seconds=(p_payload->>'maximum_seconds')::integer,max_concurrent_sessions=(p_payload->>'concurrency')::integer,per_user_daily_sessions=(p_payload->>'daily_sessions')::integer,revision=revision+1 where environment='staging';
  insert into feedx_integrations.assistant_voice_policy_audit(actor,policy)
   select p_actor,to_jsonb(p) from feedx_integrations.assistant_voice_policy p where environment='staging';
  if not (p_payload->>'enabled')::boolean then update feedx_integrations.assistant_voice_leases set state='closing',reason='admin_disabled',cleanup_after=now() where state in ('active','connecting'); end if;
 elsif p_action='report_metering' then
  metering := p_payload->'metering';
  if jsonb_typeof(metering) is distinct from 'object' or octet_length(metering::text)>48000
    or metering->>'source' is distinct from 'browser_provider_observation' then
   raise exception 'invalid_request';
  end if;
  update feedx_integrations.native_assistant_realtime_reservations r
   set observed_usage=metering||jsonb_build_object('duration_ms',p_payload->'duration_ms','recorded_at',now(),'finalized_charge',false)
   from feedx_integrations.assistant_voice_leases l
   where r.actor=p_actor and r.request_id=(p_payload->>'request_id')::uuid
    and l.actor=r.actor and l.request_id=r.request_id and l.session_id=r.session_id
    and l.provider='openai' and l.environment='staging' and l.connected_at is not null
    and l.bound_model=metering->>'session_model' and l.bound_transcription_model is not distinct from metering->>'transcription_model'
    and (r.observed_usage is null or (
     r.observed_usage ? 'revision'
     and not coalesce((r.observed_usage->>'complete')::boolean,false)
     and ((metering->>'revision')::integer > (r.observed_usage->>'revision')::integer
      or ((metering->>'revision')::integer = (r.observed_usage->>'revision')::integer and (metering->>'complete')::boolean))
    ));
  return jsonb_build_object('recorded',found);
 elsif p_action='report' then
  update feedx_integrations.native_assistant_realtime_reservations set observed_usage=jsonb_build_object('source','browser_provider_observation','input_audio_tokens',p_payload->'input_audio_tokens','output_audio_tokens',p_payload->'output_audio_tokens','duration_ms',p_payload->'duration_ms','recorded_at',now(),'finalized_charge',false)
   where actor=p_actor and request_id=(p_payload->>'request_id')::uuid and observed_usage is null;
  return jsonb_build_object('recorded',found);
 elsif p_action in ('request','review') then
  -- Preserve the optional request records and original review authority. Not an admission requirement by default.
  if p_action='request' then
   if (p_payload->>'cents')::integer not between 1 and 10000 or char_length(btrim(p_payload->>'reason')) not between 4 and 160 then raise exception 'invalid_request'; end if;
   if exists(select 1 from feedx_integrations.assistant_voice_adjustments where actor=p_actor and state='pending' and environment='staging') then raise exception 'request_conflict'; end if;
   insert into feedx_integrations.assistant_voice_adjustments(environment,actor,requested_cents,reason) values('staging',p_actor,(p_payload->>'cents')::integer,btrim(p_payload->>'reason'));
  else
   if not editable then raise exception 'settings_edit_required' using errcode='42501'; end if;
   if p_payload->>'decision' not in ('approved','denied') then raise exception 'invalid_request'; end if;
   if p_payload->>'decision'='approved' and not pol.approval_required then raise exception 'configuration_invalid'; end if;
   update feedx_integrations.assistant_voice_adjustments set state=p_payload->>'decision',reviewer=p_actor,reviewed_at=now() where id=(p_payload->>'id')::uuid and environment='staging' and state='pending';
   if not found then raise exception 'request_conflict'; end if;
  end if;
 elsif p_action<>'get' then raise exception 'invalid_request'; end if;
 select * into pol from feedx_integrations.assistant_voice_policy where environment='staging';
 admission:=case when not pol.enabled then 'disabled'
  when exists(select 1 from feedx_integrations.assistant_voice_leases where actor=p_actor and state not in ('closed','failed') and (state<>'reserved' or expires_at>now())) then 'active_elsewhere'
  when pol.approval_required and not exists(select 1 from feedx_integrations.assistant_voice_adjustments where actor=p_actor and environment='staging' and state='approved' and reviewed_at>=date_trunc('month',now())) then 'approval_required'
  when pol.per_user_daily_sessions is not null and (select count(*) from feedx_integrations.assistant_voice_leases where actor=p_actor and connected_at>=(date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'))>=pol.per_user_daily_sessions then 'daily_limit'
  when (select count(*) from feedx_integrations.assistant_voice_leases where state not in ('closed','failed') and (state<>'reserved' or expires_at>now()))>=pol.max_concurrent_sessions then 'capacity'
  else 'available' end;
 if p_action='get' then
  if period not in ('month','7d','30d','all') or history_status not in ('all','reserved','connecting','active','closing','closed','failed','historical')
    or history_page not between 1 and 100000 then raise exception 'invalid_request'; end if;
  period_start:=case period when 'month' then date_trunc('month',now() at time zone 'Asia/Kuala_Lumpur') at time zone 'Asia/Kuala_Lumpur'
   when '7d' then now()-interval '168 hours' when '30d' then now()-interval '720 hours' end;
  with scoped as materialized (
   select r.request_id,r.actor,r.provider,r.created_at,r.ended_at,r.sdk_connected_at,r.observed_usage,
    coalesce(l.state,'historical') as state,l.reason,l.expires_at,
    case when l.closed_at is not null and l.connected_at is not null
     then round(extract(epoch from l.closed_at-l.connected_at))::integer end as observed_duration_seconds,
    (r.observed_usage->>'estimated_cost_nano_usd')::bigint as estimated_cost_nano_usd,
    coalesce(r.observed_usage->>'charge_status','unavailable') as charge_status
   from feedx_integrations.native_assistant_realtime_reservations r
   left join feedx_integrations.assistant_voice_leases l using(actor,request_id)
   where (r.actor=p_actor or editable) and (period_start is null or r.created_at>=period_start) and r.created_at<=now()
  ), filtered as (
   select * from scoped where history_status='all' or state=history_status
  ), page as (
   select * from filtered order by created_at desc,request_id desc,actor desc
   limit 30 offset (history_page-1)*30
  )
  select jsonb_build_object(
   'period',period,'period_start',period_start,'as_of',now(),'page',history_page,'page_size',30,
   'filtered_count',(select count(*) from filtered),
   'summary',jsonb_build_object('sessions',count(*),'duration_seconds',sum(observed_duration_seconds),
    'duration_sessions',count(observed_duration_seconds),'estimated_sessions',count(*) filter(where charge_status='estimated'),
    'partial_sessions',count(*) filter(where charge_status='partial'),'cost_nano_usd',sum(estimated_cost_nano_usd)),
   'sessions',(select coalesce(jsonb_agg(to_jsonb(page) order by created_at desc,request_id desc,actor desc),'[]') from page)
  ) into usage_page from scoped;
 end if;
 return jsonb_build_object('environment','staging','policy',to_jsonb(pol),'can_edit',editable,'state',admission,'remaining',null,
  'reset_condition','No fixed evaluation allowance. Provider billing and rate limits still apply.',
  'adjustments',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select id,actor,requested_cents,reason,state,reviewer,created_at,reviewed_at from feedx_integrations.assistant_voice_adjustments where environment='staging' and (actor=p_actor or editable) order by created_at desc limit 30)x))||coalesce(usage_page,'{}');
end $$;
