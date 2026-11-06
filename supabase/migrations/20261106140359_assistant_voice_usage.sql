alter table feedx_integrations.native_assistant_realtime_reservations add column observed_usage jsonb;
-- Staging only. No historical reservation edits, purchased allowance, or Production activation.
create table feedx_integrations.assistant_voice_policy (
 environment text primary key check(environment in ('staging','production')),
 enabled boolean not null default false,
 monthly_budget_cents integer not null default 0 check(monthly_budget_cents>=0),
 approved_ceiling_cents integer not null default 0 check(approved_ceiling_cents>=monthly_budget_cents),
 per_user_daily_sessions integer not null default 0 check(per_user_daily_sessions between 0 and 100),
 max_seconds integer not null default 180 check(max_seconds between 30 and 180),
 enforcement_verified boolean not null default false,
 revision integer not null default 1,
 check(not enabled or enforcement_verified)
);
insert into feedx_integrations.assistant_voice_policy(environment) values('staging'),('production');
create table feedx_integrations.assistant_voice_adjustments (
 id uuid primary key default gen_random_uuid(),environment text not null references feedx_integrations.assistant_voice_policy,
 actor uuid not null references auth.users,requested_cents integer not null check(requested_cents between 1 and 10000),
 reason text not null check(char_length(reason) between 4 and 160),state text not null default 'pending' check(state in ('pending','approved','denied')),
 reviewer uuid references auth.users,created_at timestamptz not null default now(),reviewed_at timestamptz
);
alter table feedx_integrations.assistant_voice_policy enable row level security;
alter table feedx_integrations.assistant_voice_adjustments enable row level security;
revoke all on feedx_integrations.assistant_voice_policy,feedx_integrations.assistant_voice_adjustments from public,anon,authenticated;
create function public.native_assistant_voice_usage(p_actor uuid,p_action text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public,feedx_integrations,pg_temp as $$
declare pol feedx_integrations.assistant_voice_policy%rowtype; a feedx_integrations.assistant_voice_adjustments%rowtype; result jsonb; editable boolean;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'service_only' using errcode='42501'; end if;
 perform public.native_assistant_service(p_actor,'status');
 editable:=public.current_user_has_permission('roles.edit') and public.current_user_has_permission('roles.view');
 perform pg_advisory_xact_lock(hashtextextended('assistant-voice-policy:staging',0));
 select * into pol from feedx_integrations.assistant_voice_policy where environment='staging' for update;
 if p_action='report' then
  update feedx_integrations.native_assistant_realtime_reservations set observed_usage=jsonb_build_object('source','browser_provider_observation','input_audio_tokens',p_payload->'input_audio_tokens','output_audio_tokens',p_payload->'output_audio_tokens','duration_ms',p_payload->'duration_ms','recorded_at',now(),'finalized_charge',false) where actor=p_actor and request_id=(p_payload->>'request_id')::uuid and observed_usage is null;
 elsif p_action='save' then
  if not editable then raise exception 'settings_edit_required' using errcode='42501'; end if;
  if (p_payload->>'revision')::integer is distinct from pol.revision then raise exception 'configuration_changed' using errcode='40001'; end if;
  if (p_payload->>'budget_cents')::integer not between 0 and pol.approved_ceiling_cents or (p_payload->>'daily_sessions')::integer not between 0 and 100
   then raise exception 'voice_request_limit' using errcode='54000'; end if;
  update feedx_integrations.assistant_voice_policy set monthly_budget_cents=(p_payload->>'budget_cents')::integer,
   per_user_daily_sessions=(p_payload->>'daily_sessions')::integer,revision=revision+1 where environment='staging';
 elsif p_action='request' then
  if (p_payload->>'cents')::integer not between 1 and 10000 or char_length(btrim(p_payload->>'reason')) not between 4 and 160 then raise exception 'invalid_request'; end if;
  if exists(select 1 from feedx_integrations.assistant_voice_adjustments where actor=p_actor and environment='staging' and state='pending') then raise exception 'request_conflict' using errcode='40001'; end if;
  insert into feedx_integrations.assistant_voice_adjustments(environment,actor,requested_cents,reason) values('staging',p_actor,(p_payload->>'cents')::integer,btrim(p_payload->>'reason'));
 elsif p_action='review' then
  if not editable then raise exception 'settings_edit_required' using errcode='42501'; end if;
  select * into a from feedx_integrations.assistant_voice_adjustments where id=(p_payload->>'id')::uuid and environment='staging' and state='pending' for update;
  if not found then raise exception 'request_conflict' using errcode='40001'; end if;
  if p_payload->>'decision' not in ('approved','denied') then raise exception 'invalid_request'; end if;
  if p_payload->>'decision'='approved' and (not pol.enforcement_verified or not pol.enabled or
   a.requested_cents+coalesce((select sum(requested_cents) from feedx_integrations.assistant_voice_adjustments where environment='staging' and state='approved' and reviewed_at>=date_trunc('month',now())),0)>pol.monthly_budget_cents)
   then raise exception 'voice_request_limit' using errcode='54000'; end if;
  update feedx_integrations.assistant_voice_adjustments set state=p_payload->>'decision',reviewer=p_actor,reviewed_at=now() where id=a.id;
 elsif p_action<>'get' then raise exception 'invalid_request';
 end if;
 select * into pol from feedx_integrations.assistant_voice_policy where environment='staging';
 select jsonb_agg(to_jsonb(x)) into result from (select id,actor,requested_cents,reason,state,reviewer,created_at,reviewed_at from feedx_integrations.assistant_voice_adjustments
  where environment='staging' and (actor=p_actor or editable) order by created_at desc limit 30) x;
 return jsonb_build_object('environment','staging','policy',to_jsonb(pol),'can_edit',editable,'adjustments',coalesce(result,'[]'),
 'remaining',0,'state','approval_required','reset_condition','No automatic funding. Approved budget and verified server-side metering are required.',
 'usage_source','Historical reservations; provider charges are not finalized',
 'sessions',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select request_id,actor,provider,created_at,ended_at,sdk_connected_at,observed_usage,
  case when ended_at is not null then extract(epoch from ended_at-created_at)::integer end as observed_duration_seconds,
  null::numeric as estimated_cost_usd,'unavailable'::text as charge_status from feedx_integrations.native_assistant_realtime_reservations
  where actor=p_actor or editable order by created_at desc limit 30) x));
end $$;
revoke all on function public.native_assistant_voice_usage(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.native_assistant_voice_usage(uuid,text,jsonb) to service_role;
-- Gate minting before the historical evaluation reservation path. Fail closed until
-- trusted provider metering/termination is verified; client timers are not a cost cap.
do $$ declare def text; old text; begin
 def:=pg_get_functiondef('public.native_assistant_reserve_realtime(uuid,uuid,uuid,text,text)'::regprocedure);
 old:=' if (select count(*) from feedx_integrations.native_assistant_realtime_reservations where allowance_exclusion is null)';
 if strpos(def,old)=0 then raise exception 'Voice admission contract changed'; end if;
 execute replace(def,old,' if not exists(select 1 from feedx_integrations.assistant_voice_policy where environment=''staging'' and enabled and enforcement_verified and monthly_budget_cents>0 and per_user_daily_sessions>0) then raise exception ''voice_request_limit'' using errcode=''54000''; end if;'||chr(10)||old);
end $$;
