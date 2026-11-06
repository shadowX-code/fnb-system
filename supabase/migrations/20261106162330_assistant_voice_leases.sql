-- Staging development admission, independent of the immutable evaluation ledger.
alter table feedx_integrations.assistant_voice_policy drop constraint assistant_voice_policy_check1;
alter table feedx_integrations.assistant_voice_policy add constraint assistant_voice_production_activation check(environment='staging' or not enabled or enforcement_verified);
alter table feedx_integrations.assistant_voice_policy alter column per_user_daily_sessions drop not null;
alter table feedx_integrations.assistant_voice_policy add column max_concurrent_sessions integer not null default 4 check(max_concurrent_sessions between 1 and 8);
alter table feedx_integrations.assistant_voice_policy add column approval_required boolean not null default false;
update feedx_integrations.assistant_voice_policy set enabled=false,per_user_daily_sessions=null,enforcement_verified=false,revision=revision+1 where environment='staging';
create table feedx_integrations.assistant_voice_leases (
 actor uuid not null references auth.users, request_id uuid not null, session_id uuid not null, provider text not null check(provider='openai'),
 environment text not null default 'staging' check(environment='staging'), voice text,
 state text not null default 'reserved' check(state in ('reserved','connecting','active','closing','closed','failed')),
 created_at timestamptz not null default now(),expires_at timestamptz not null,heartbeat_at timestamptz not null default now(),
 ticket_hash text, connect_config jsonb,claimed_at timestamptz,provider_revision integer,call_id text,connected_at timestamptz,closed_at timestamptz,reason text,
 cleanup_after timestamptz not null default now(),cleanup_attempts integer not null default 0,last_cleanup_status integer,
 primary key(actor,request_id),unique(call_id)
);
create index assistant_voice_open on feedx_integrations.assistant_voice_leases(state,expires_at) where state not in ('closed','failed');
alter table feedx_integrations.assistant_voice_leases enable row level security;
revoke all on feedx_integrations.assistant_voice_leases from public,anon,authenticated;
create table feedx_integrations.assistant_voice_cleanup_tickets(hash text primary key,expires_at timestamptz not null);
alter table feedx_integrations.assistant_voice_cleanup_tickets enable row level security;
revoke all on feedx_integrations.assistant_voice_cleanup_tickets from public,anon,authenticated;

create function public.native_assistant_voice_lease(p_actor uuid,p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public,feedx_integrations,pg_temp as $$
declare pol feedx_integrations.assistant_voice_policy%rowtype; l feedx_integrations.assistant_voice_leases%rowtype;
 rid uuid:=(p_payload->>'request_id')::uuid; sid uuid:=(p_payload->>'session_id')::uuid; authority jsonb;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'service_only' using errcode='42501'; end if;
 authority:=public.native_assistant_service(p_actor,'status');
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 perform pg_advisory_xact_lock(hashtextextended('assistant-voice-policy:staging',0));
 select * into pol from feedx_integrations.assistant_voice_policy where environment='staging' for update;
 if p_payload ? 'environment' or p_payload->>'provider' is distinct from 'openai' then raise exception 'voice_disabled' using errcode='42501'; end if;
 if p_action<>'admit' and exists(select 1 from feedx_integrations.assistant_voice_leases where actor=p_actor and request_id=rid and session_id<>sid) then raise exception 'request_conflict' using errcode='40001'; end if;
 if p_action='admit' then
  perform public.native_assistant_service(p_actor,'session_voice_check',jsonb_build_object('session_id',sid));
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  select * into l from feedx_integrations.assistant_voice_leases where actor=p_actor and request_id=rid for update;
  if found then
   if l.session_id<>sid or l.provider<>p_payload->>'provider' then raise exception 'request_conflict' using errcode='40001'; end if;
   if l.state not in ('reserved','connecting','active') or l.expires_at<=now() then raise exception 'voice_session_expired' using errcode='55000'; end if;
   if not pol.enabled then raise exception 'voice_disabled' using errcode='42501'; end if;
   return jsonb_build_object('replayed',true,'expires_at',l.expires_at,'state',l.state,'maximum_seconds',pol.max_seconds);
  end if;
  if not pol.enabled then raise exception 'voice_disabled' using errcode='42501'; end if;
  if pol.approval_required and not exists(select 1 from feedx_integrations.assistant_voice_adjustments where actor=p_actor and environment='staging' and state='approved' and reviewed_at>=date_trunc('month',now())) then raise exception 'voice_approval_required' using errcode='42501'; end if;
  -- Reclaim only offers never submitted to a provider. Unknown/closing calls keep their slots.
  update feedx_integrations.assistant_voice_leases set state='failed',closed_at=now(),reason='startup_expired' where state='reserved' and expires_at<=now();
  if exists(select 1 from feedx_integrations.assistant_voice_leases where actor=p_actor and state not in ('closed','failed')) then raise exception 'voice_session_active' using errcode='40001'; end if;
  if (select count(*) from feedx_integrations.assistant_voice_leases where state not in ('closed','failed'))>=pol.max_concurrent_sessions then raise exception 'voice_capacity' using errcode='54000'; end if;
  if pol.per_user_daily_sessions is not null and (select count(*) from feedx_integrations.assistant_voice_leases where actor=p_actor and connected_at>=(date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'))>=pol.per_user_daily_sessions then raise exception 'voice_daily_limit' using errcode='54000'; end if;
  insert into feedx_integrations.assistant_voice_leases(actor,request_id,session_id,provider,expires_at) values(p_actor,rid,sid,'openai',now()+interval '60 seconds') returning * into l;
  insert into feedx_integrations.native_assistant_realtime_reservations(actor,request_id,session_id,provider,sdk_baseline) values(p_actor,rid,sid,'openai',true);
 elsif p_action='ticket' then
  update feedx_integrations.assistant_voice_leases set ticket_hash=p_payload->>'hash',connect_config=p_payload->'config',voice=p_payload->'config'->>'voice'
   where actor=p_actor and request_id=rid and session_id=sid and state='reserved' and expires_at>now() and pol.enabled returning * into l;
  if not found then raise exception 'voice_session_active' using errcode='40001'; end if;
 elsif p_action='server_claim' then
  update feedx_integrations.assistant_voice_leases set state='connecting',claimed_at=now(),expires_at=now()+make_interval(secs=>pol.max_seconds) where actor=p_actor and request_id=rid and session_id=sid and state='reserved' and pol.enabled and expires_at>now() returning * into l;
  if not found then raise exception 'voice_session_expired'; end if;
 elsif p_action='heartbeat' then
  update feedx_integrations.assistant_voice_leases set heartbeat_at=now() where actor=p_actor and request_id=rid and session_id=sid and state='active' and expires_at>now() and pol.enabled returning * into l;
  if not found then raise exception 'voice_session_expired' using errcode='55000'; end if;
 elsif p_action='end' then
  update feedx_integrations.assistant_voice_leases set state=case when state='reserved' then 'closed' else 'closing' end,closed_at=case when state='reserved' then now() else closed_at end,reason=coalesce(reason,'user_ended'),cleanup_after=now()
   where actor=p_actor and request_id=rid and session_id=sid and state not in ('closed','failed') returning * into l;
  -- Preserve completed outcomes; existing history writes settle before this action.
  update feedx_integrations.native_assistant_realtime_reservations set ended_at=coalesce(ended_at,now()) where actor=p_actor and request_id=rid and session_id=sid;
 elsif p_action='tool' then
  if not pol.enabled or not exists(select 1 from feedx_integrations.assistant_voice_leases where actor=p_actor and request_id=rid and session_id=sid and state='active' and expires_at>now()) then raise exception 'voice_session_expired' using errcode='42501'; end if;
  update feedx_integrations.native_assistant_realtime_reservations set tool_reads=tool_reads+1 where actor=p_actor and request_id=rid and session_id=sid and ended_at is null and tool_reads<6;
  if not found then raise exception 'voice_request_limit' using errcode='54000'; end if;
 elsif p_action in ('sdk_connected','sdk_issued','sdk_rejected','sdk_usage_observed') then
  update feedx_integrations.native_assistant_realtime_reservations set
   sdk_secret_issued_at=case when p_action='sdk_issued' then coalesce(sdk_secret_issued_at,now()) else sdk_secret_issued_at end,
   sdk_mint_rejected_at=case when p_action='sdk_rejected' then coalesce(sdk_mint_rejected_at,now()) else sdk_mint_rejected_at end,
   sdk_connected_at=case when p_action='sdk_connected' then coalesce(sdk_connected_at,now()) else sdk_connected_at end,
   sdk_usage_observed_at=case when p_action='sdk_usage_observed' then coalesce(sdk_usage_observed_at,now()) else sdk_usage_observed_at end
  where actor=p_actor and request_id=rid and session_id=sid and ended_at is null;
 else raise exception 'invalid_request'; end if;
 return jsonb_build_object('replayed',false,'expires_at',l.expires_at,'state',l.state,'maximum_seconds',pol.max_seconds);
end $$;
revoke all on function public.native_assistant_voice_lease(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.native_assistant_voice_lease(uuid,text,jsonb) to service_role;

-- Server-only connection/termination worker. Neither call IDs nor credentials are accepted from clients.
create function public.native_assistant_voice_connection(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public,feedx_integrations,pg_temp as $$
declare l feedx_integrations.assistant_voice_leases%rowtype; pol feedx_integrations.assistant_voice_policy%rowtype; result jsonb;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'service_only' using errcode='42501'; end if;
 select * into pol from feedx_integrations.assistant_voice_policy where environment='staging';
 if p_action='claim' then
  select * into l from feedx_integrations.assistant_voice_leases where ticket_hash=p_payload->>'hash' for update;
  if not found or not pol.enabled or l.state<>'reserved' or l.expires_at<=now() then raise exception 'voice_session_expired' using errcode='42501'; end if;
  perform public.native_assistant_service(l.actor,'session_voice_check',jsonb_build_object('session_id',l.session_id));
  update feedx_integrations.assistant_voice_leases set state='connecting',claimed_at=now(),ticket_hash=null,expires_at=now()+make_interval(secs=>pol.max_seconds) where actor=l.actor and request_id=l.request_id;
  return jsonb_build_object('actor',l.actor,'request_id',l.request_id,'session_id',l.session_id,'config',l.connect_config,'maximum_seconds',pol.max_seconds);
 elsif p_action='bind' then
  update feedx_integrations.assistant_voice_leases set call_id=p_payload->>'call_id',provider_revision=(p_payload->>'provider_revision')::integer,connected_at=now(),heartbeat_at=now(),connect_config=null,
   state=case when state='connecting' and expires_at>now() and pol.enabled then 'active' else 'closing' end
   where actor=(p_payload->>'actor')::uuid and request_id=(p_payload->>'request_id')::uuid and claimed_at is not null and call_id is null and (p_payload->>'provider_revision')::integer=(select credential_revision from feedx_integrations.native_assistant_providers where provider='openai') returning * into l;
  if not found then raise exception 'request_conflict'; end if;
  return jsonb_build_object('state',l.state);
 elsif p_action='failed' then
  update feedx_integrations.assistant_voice_leases set state='failed',closed_at=now(),reason='provider_rejected',connect_config=null where actor=(p_payload->>'actor')::uuid and request_id=(p_payload->>'request_id')::uuid and state='connecting' and call_id is null;
 elsif p_action='cleanup' then
  delete from feedx_integrations.assistant_voice_cleanup_tickets where hash=p_payload->>'hash' and expires_at>now();
  if not found then raise exception 'service_only' using errcode='42501'; end if;
  update feedx_integrations.assistant_voice_leases set state='failed',closed_at=now(),reason='startup_expired',connect_config=null where state='reserved' and expires_at<=now();
  update feedx_integrations.assistant_voice_leases set state='closing',reason=coalesce(reason,case when not pol.enabled then 'admin_disabled' when expires_at<=now() then 'duration_expired' else 'heartbeat_expired' end)
   where state in ('active','connecting') and (not pol.enabled or expires_at<=now() or state='active' and heartbeat_at<now()-interval '45 seconds');
  -- Unknown upstream outcomes retain concurrency for the provider's maximum session lifetime.
  update feedx_integrations.assistant_voice_leases set state='closed',closed_at=now(),reason='unknown_connection_expired' where state='closing' and call_id is null and claimed_at<now()-interval '61 minutes';
  with pending as (select actor,request_id from feedx_integrations.assistant_voice_leases where state='closing' and call_id is not null and cleanup_after<=now() order by expires_at limit 8 for update skip locked), claimed as (
   update feedx_integrations.assistant_voice_leases owned set cleanup_after=now()+interval '30 seconds',cleanup_attempts=cleanup_attempts+1 from pending p where owned.actor=p.actor and owned.request_id=p.request_id returning owned.*)
  select coalesce(jsonb_agg(jsonb_build_object('actor',c.actor,'request_id',c.request_id,'call_id',c.call_id,'credential',v.decrypted_secret)),'[]') into result from claimed c
   join feedx_integrations.native_assistant_providers p on p.provider='openai' and p.credential_revision=c.provider_revision join vault.decrypted_secrets v on v.id=p.secret_id;
  return result;
 elsif p_action='terminated' then
  update feedx_integrations.assistant_voice_leases set last_cleanup_status=(p_payload->>'status')::integer,
   state=case when (p_payload->>'status')::integer in (200,204,404) then 'closed' else state end,
   closed_at=case when (p_payload->>'status')::integer in (200,204,404) then now() else closed_at end
   where actor=(p_payload->>'actor')::uuid and request_id=(p_payload->>'request_id')::uuid and state='closing';
 else raise exception 'invalid_request'; end if;
 update feedx_integrations.native_assistant_realtime_reservations r set ended_at=coalesce(r.ended_at,owned.closed_at) from feedx_integrations.assistant_voice_leases owned where owned.actor=r.actor and owned.request_id=r.request_id and owned.closed_at is not null;
 return '{}'::jsonb;
end $$;
revoke all on function public.native_assistant_voice_connection(text,jsonb) from public,anon,authenticated;
grant execute on function public.native_assistant_voice_connection(text,jsonb) to service_role;

create or replace function public.native_assistant_reserve_realtime(p_actor uuid,p_session uuid,p_request uuid,p_provider text,p_action text) returns void language plpgsql security definer set search_path=public,feedx_integrations,pg_temp as $$
begin
 perform public.native_assistant_voice_lease(p_actor,case when p_action in ('start','sdk_baseline') then 'admit' else p_action end,jsonb_build_object('session_id',p_session,'request_id',p_request,'provider',p_provider));
end $$;
-- No client of the canonical path uses this legacy counter anymore; preserve old records.
create or replace function public.native_assistant_sdk_remaining() returns integer language sql security definer set search_path=public,pg_temp as 'select null::integer';

-- Reuse installed pg_cron/pg_net. A one-use 30s nonce authorizes only cleanup, not business or provider creation.
create function feedx_integrations.schedule_voice_cleanup() returns void language plpgsql security definer set search_path=public,feedx_integrations,pg_temp as $$
declare token text;
begin
 delete from feedx_integrations.assistant_voice_cleanup_tickets where expires_at<now();
 if not exists(select 1 from feedx_integrations.assistant_voice_leases where state not in ('closed','failed') and (state='closing' or expires_at<=now() or heartbeat_at<now()-interval '45 seconds' or not (select enabled from feedx_integrations.assistant_voice_policy where environment='staging'))) then return; end if;
 token:=encode(extensions.gen_random_bytes(32),'hex');
 insert into feedx_integrations.assistant_voice_cleanup_tickets values(encode(extensions.digest(token,'sha256'),'hex'),now()+interval '30 seconds');
 perform net.http_post(url:='https://ujkzdaaadnvcfayuldmh.supabase.co/functions/v1/native-assistant?voice=cleanup',headers:=jsonb_build_object('Authorization','Bearer '||token,'Content-Type','application/json'),body:='{}'::jsonb,timeout_milliseconds:=30000);
end $$;
revoke all on function feedx_integrations.schedule_voice_cleanup() from public,anon,authenticated;
select cron.schedule('native-assistant-voice-cleanup','10 seconds','select feedx_integrations.schedule_voice_cleanup()');

-- Credential resolution remains server-only; ordinary active Assistant users do not need settings-edit authority.
do $$ declare def text; begin
 def:=pg_get_functiondef('public.native_assistant_provider_registry(uuid,text,jsonb)'::regprocedure);
 def:=replace(def,'case when p_action=''runtime'' then ''status'' else ''configuration'' end','case when p_action in (''runtime'',''key'') then ''status'' else ''configuration'' end');
 def:=replace(def,'if (authority->>''can_edit'')::boolean is distinct from true then','if p_action<>''key'' and (authority->>''can_edit'')::boolean is distinct from true then');
 def:=replace(def,'if p_action=''put'' then','if p_action in (''put'',''revoke'') and exists(select 1 from feedx_integrations.assistant_voice_leases where state not in (''closed'',''failed'')) then raise exception ''voice_session_active'' using errcode=''40001''; end if;'||chr(10)||' if p_action=''put'' then');
 execute def;
end $$;

create or replace function public.native_assistant_voice_usage(p_actor uuid,p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path=public,feedx_integrations,pg_temp as $$
declare pol feedx_integrations.assistant_voice_policy%rowtype; editable boolean; admission text; result jsonb;
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
  if not (p_payload->>'enabled')::boolean then update feedx_integrations.assistant_voice_leases set state='closing',reason='admin_disabled',cleanup_after=now() where state in ('active','connecting'); end if;
 elsif p_action='report' then
  update feedx_integrations.native_assistant_realtime_reservations set observed_usage=jsonb_build_object('source','browser_provider_observation','input_audio_tokens',p_payload->'input_audio_tokens','output_audio_tokens',p_payload->'output_audio_tokens','duration_ms',p_payload->'duration_ms','recorded_at',now(),'finalized_charge',false)
   where actor=p_actor and request_id=(p_payload->>'request_id')::uuid and observed_usage is null;
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
 return jsonb_build_object('environment','staging','policy',to_jsonb(pol),'can_edit',editable,'state',admission,'remaining',null,
  'reset_condition','No fixed evaluation allowance. Provider billing and rate limits still apply.',
  'adjustments',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select id,actor,requested_cents,reason,state,reviewer,created_at,reviewed_at from feedx_integrations.assistant_voice_adjustments where environment='staging' and (actor=p_actor or editable) order by created_at desc limit 30)x),
  'sessions',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select r.request_id,r.actor,r.provider,r.created_at,r.ended_at,r.sdk_connected_at,r.observed_usage,l.state,l.reason,l.expires_at,
   case when l.closed_at is not null and l.connected_at is not null then extract(epoch from l.closed_at-l.connected_at)::integer end as observed_duration_seconds,
   null::numeric as estimated_cost_usd,'unavailable'::text as charge_status from feedx_integrations.native_assistant_realtime_reservations r left join feedx_integrations.assistant_voice_leases l on l.actor=r.actor and l.request_id=r.request_id
   where r.actor=p_actor or editable order by r.created_at desc limit 30)x));
end $$;

create table feedx_integrations.assistant_voice_policy_audit(id bigint generated always as identity primary key,actor uuid not null,at timestamptz not null default now(),policy jsonb not null);
alter table feedx_integrations.assistant_voice_policy_audit enable row level security;
revoke all on feedx_integrations.assistant_voice_policy_audit from public,anon,authenticated;
do $$ declare def text; begin
 def:=pg_get_functiondef('public.native_assistant_voice_usage(uuid,text,jsonb)'::regprocedure);
 def:=replace(def,'if not (p_payload->>''enabled'')::boolean then','insert into feedx_integrations.assistant_voice_policy_audit(actor,policy) select p_actor,to_jsonb(p) from feedx_integrations.assistant_voice_policy p where environment=''staging''; if not (p_payload->>''enabled'')::boolean then');
 execute def;
end $$;
