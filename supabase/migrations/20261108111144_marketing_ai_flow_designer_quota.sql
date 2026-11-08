-- Keep one Designer request ledger. Policy rows hold limits, never usage counters.
alter table marketing_private.ai_flow_generation add column outcome jsonb;
create index ai_flow_generation_organization_time on marketing_private.ai_flow_generation(organization_id,created_at desc);
create index ai_flow_generation_project_time on marketing_private.ai_flow_generation(created_at desc);
create table marketing_private.ai_flow_quota_policy (
 singleton boolean primary key default true check(singleton),
 actor_turns integer not null check(actor_turns between 1 and 50),
 actor_attempts integer not null check(actor_attempts between actor_turns and 75),
 organization_attempts integer not null check(organization_attempts between actor_attempts and 300),
 project_attempts integer not null check(project_attempts between organization_attempts and 1000),
 cooldown_seconds integer not null check(cooldown_seconds between 2 and 60),
 installed_at timestamptz not null default now()
);
insert into marketing_private.ai_flow_quota_policy(actor_turns,actor_attempts,organization_attempts,project_attempts,cooldown_seconds)
values(20,30,100,200,3);
alter table marketing_private.ai_flow_quota_policy enable row level security;
revoke all on marketing_private.ai_flow_quota_policy from public,anon,authenticated,service_role;

create or replace function public.marketing_ai_flow_generate_prepare(p_request uuid,p_org uuid,p_brand uuid,p_description text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid; prior marketing_private.ai_flow_generation; fingerprint text; limits marketing_private.ai_flow_quota_policy;
 cutoff timestamptz:=now()-interval '24 hours'; retry_at timestamptz;
begin
 if p_request is null or p_brand is null or length(btrim(coalesce(p_description,''))) not between 10 and 1500 then
  raise exception 'Describe the flow in 10–1500 characters.';
 end if;
 perform marketing_private.require_access(p_org,p_brand,'marketing_campaigns.view');
 perform marketing_private.require_access(p_org,p_brand,'marketing_campaigns.manage');
 actor:=marketing_private.require_access(p_org,p_brand,'marketing_inbox.ai');
 if not exists(select 1 from public.brands where id=p_brand and organization_id=p_org and is_active)
 or not exists(select 1 from public.marketing_inbox_policies where brand_id=p_brand and ai_allowed and automation_mode<>'off') then
  raise exception 'Save Brand AI consent before testing.';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('ai_flow_generation_budget',0));
 fingerprint:=md5(p_description);
 select * into prior from marketing_private.ai_flow_generation where request_id=p_request;
 if found then
  if (prior.actor_id,prior.organization_id,prior.brand_id,prior.intent_hash) is distinct from (actor,p_org,p_brand,fingerprint) then
   raise exception 'Test request identity changed.';
  end if;
  return coalesce(prior.outcome,case when prior.definition is not null then jsonb_build_object('state','completed','definition',prior.definition)
    when prior.created_at>now()-interval '2 minutes' then jsonb_build_object('state','in_progress','retry_at',prior.created_at+interval '2 minutes')
    else jsonb_build_object('state','failed','error','The earlier request did not finish. Send again to start a new attempt.') end);
 end if;
 select * into strict limits from marketing_private.ai_flow_quota_policy where singleton;
 select min(created_at)+interval '24 hours' into retry_at from (
  select created_at from marketing_private.ai_flow_generation
  where actor_id=actor and created_at>cutoff and (definition is not null or outcome->>'state'='completed')
  order by created_at desc limit limits.actor_turns
 ) recent having count(*)>=limits.actor_turns;
 if retry_at is not null then return jsonb_build_object('state','quota','reason','actor_turns','retry_at',retry_at);end if;
 select min(created_at)+interval '24 hours' into retry_at from (
  select created_at from marketing_private.ai_flow_generation where actor_id=actor and created_at>cutoff
  order by created_at desc limit limits.actor_attempts
 ) recent having count(*)>=limits.actor_attempts;
 if retry_at is not null then return jsonb_build_object('state','quota','reason','actor_attempts','retry_at',retry_at);end if;
 select min(created_at)+interval '24 hours' into retry_at from (
  select created_at from marketing_private.ai_flow_generation where organization_id=p_org and created_at>cutoff
  order by created_at desc limit limits.organization_attempts
 ) recent having count(*)>=limits.organization_attempts;
 if retry_at is not null then return jsonb_build_object('state','quota','reason','organization_attempts','retry_at',retry_at);end if;
 select min(created_at)+interval '24 hours' into retry_at from (
  select created_at from marketing_private.ai_flow_generation where created_at>cutoff
  order by created_at desc limit limits.project_attempts
 ) recent having count(*)>=limits.project_attempts;
 if retry_at is not null then return jsonb_build_object('state','quota','reason','project_attempts','retry_at',retry_at);end if;
 select max(created_at)+interval '2 minutes' into retry_at from marketing_private.ai_flow_generation
 where actor_id=actor and created_at>now()-interval '2 minutes' and created_at>=limits.installed_at and definition is null and outcome is null;
 if retry_at is not null then return jsonb_build_object('state','in_progress','retry_at',retry_at);end if;
 select max(created_at)+make_interval(secs=>limits.cooldown_seconds) into retry_at
 from marketing_private.ai_flow_generation where actor_id=actor and created_at>now()-make_interval(secs=>limits.cooldown_seconds);
 if retry_at is not null then return jsonb_build_object('state','quota','reason','cooldown','retry_at',retry_at);end if;
 insert into marketing_private.ai_flow_generation(request_id,actor_id,organization_id,brand_id,intent_hash)
 values(p_request,actor,p_org,p_brand,fingerprint);
 return jsonb_build_object('state','prepared');
end;
$$;


create function public.marketing_ai_flow_designer_settle(p_request uuid,p_outcome jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare run marketing_private.ai_flow_generation; proposed jsonb;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service only.';end if;
 select * into run from marketing_private.ai_flow_generation where request_id=p_request for update;
 if not found then raise exception 'Generation unavailable.';end if;
 if run.outcome is not null then return run.outcome;end if;
 if run.definition is not null or run.created_at<now()-interval '2 minutes' then raise exception 'Generation already closed.';end if;
 if jsonb_typeof(p_outcome) is distinct from 'object' or octet_length(p_outcome::text)>45000
 or coalesce(p_outcome->>'state','') not in ('completed','failed')
 or (p_outcome->>'state'='completed' and coalesce(p_outcome->>'kind','') not in ('proposal','question','unsupported')) then
  raise exception 'Invalid Designer result.';
 end if;
 if p_outcome->>'state'='completed' and (
  not marketing_private.actor_allowed(run.actor_id,run.organization_id,run.brand_id,'marketing_campaigns.manage')
  or not marketing_private.actor_allowed(run.actor_id,run.organization_id,run.brand_id,'marketing_inbox.ai')
  or not exists(select 1 from public.brands where id=run.brand_id and organization_id=run.organization_id and is_active)
  or not exists(select 1 from public.marketing_inbox_policies where brand_id=run.brand_id and ai_allowed and automation_mode<>'off')
 ) then raise exception 'Generation authorization changed.';end if;
 if p_outcome->>'kind'='proposal' then
  proposed:=p_outcome->'definition';
  perform marketing_private.validate_ai_flow(proposed);
 end if;
 update marketing_private.ai_flow_generation set outcome=p_outcome,definition=proposed where request_id=p_request;
 return p_outcome;
end;
$$;
revoke all on function public.marketing_ai_flow_designer_settle(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.marketing_ai_flow_designer_settle(uuid,jsonb) to service_role;
