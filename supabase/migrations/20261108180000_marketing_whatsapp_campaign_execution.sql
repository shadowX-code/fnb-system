-- Execution evidence belongs to the existing approved campaign revision and recipient queue.
create table marketing_private.whatsapp_campaign_runs (
 id uuid primary key, campaign_id uuid not null references public.marketing_campaigns(id),
 revision integer not null, connection_id uuid not null references public.marketing_connections(id),
 generation integer not null, template jsonb not null, scheduled_at timestamptz not null,
 batch_size integer not null check(batch_size between 1 and 100),
 state text not null default 'scheduled' check(state in ('scheduled','paused','cancelled','complete')),
 actor_id uuid not null references public.employees(id), created_at timestamptz not null default now(),
 unique(campaign_id,revision)
);
create table marketing_private.whatsapp_campaign_deliveries (
 id uuid primary key default gen_random_uuid(), run_id uuid not null references marketing_private.whatsapp_campaign_runs(id),
 recipient_id uuid not null unique references public.marketing_campaign_recipients(id) on delete cascade,
 batch integer not null, due_at timestamptz not null,
 state text not null default 'scheduled' check(state in ('scheduled','sending','accepted','sent','delivered','read','failed','unknown','suppressed','cancelled')),
 lease uuid, lease_until timestamptz, attempted_at timestamptz,
 provider_message_id text unique, reason text,
 reply_conversation_id uuid references public.marketing_conversations(id) on delete set null,
 first_reply_at timestamptz
);
create index whatsapp_campaign_due on marketing_private.whatsapp_campaign_deliveries(due_at,id) where state='scheduled';
alter table marketing_private.whatsapp_campaign_runs enable row level security;
alter table marketing_private.whatsapp_campaign_deliveries enable row level security;
revoke all on marketing_private.whatsapp_campaign_runs,marketing_private.whatsapp_campaign_deliveries from public,anon,authenticated,service_role;

create function marketing_private.whatsapp_campaign_connection(conn public.marketing_connections)
returns boolean language sql stable set search_path=public as $$
 select coalesce(conn.brand_id='3a60f950-9510-4538-b7de-93789573bc0b' and conn.channel='whatsapp'
 and conn.whatsapp_onboarding_mode='cloud_api' and conn.whatsapp_waba_id='1675083730240518'
 and conn.provider_account_id='1221509657713215' and marketing_private.whatsapp_receiving(conn.id),false)
$$;
revoke all on function marketing_private.whatsapp_campaign_connection(public.marketing_connections) from public,anon,authenticated,service_role;

create function public.marketing_campaign_whatsapp_command(
 p_org uuid,p_brand uuid,p_campaign uuid,p_request uuid,p_action text,p_payload jsonb default '{}'
) returns jsonb language plpgsql security definer set search_path=public as $$
declare c marketing_campaigns; run marketing_private.whatsapp_campaign_runs; conn marketing_connections;
 actor uuid; prior marketing_requests; fingerprint text; due timestamptz; size integer; result jsonb;
begin
 actor:=marketing_private.require_access(p_org,p_brand,'marketing_campaigns.execute');
 if p_request is null or p_action not in ('schedule','pause','resume','cancel') then raise exception 'Invalid campaign action.';end if;
 if p_action='schedule' then perform marketing_private.require_access(p_org,p_brand,'marketing_campaigns.approve');end if;
 fingerprint:=encode(extensions.digest(jsonb_build_array('whatsapp_campaign',p_org,p_brand,p_campaign,p_action,p_payload)::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 select * into prior from marketing_requests where request_id=p_request;
 if found then
  if prior.actor_employee_id<>actor or prior.fingerprint<>fingerprint then raise exception 'Campaign request changed.';end if;
  return prior.result;
 end if;
 select * into c from marketing_campaigns where id=p_campaign and organization_id=p_org and brand_id=p_brand for update;
 if c.id is null or c.revision is distinct from (p_payload->>'revision')::integer then raise exception 'Campaign revision changed.';end if;
 select * into run from marketing_private.whatsapp_campaign_runs where campaign_id=c.id and revision=c.revision for update;
 if p_action='schedule' then
  if run.id is not null or c.status<>'ready' or c.approved_revision is distinct from c.revision then raise exception 'Queue the approved campaign revision first.';end if;
  select * into conn from marketing_connections k where k.brand_id=c.brand_id and k.organization_id=c.organization_id
   and marketing_private.whatsapp_campaign_connection(k);
  if conn.id is null or conn.credential_generation is distinct from (p_payload->>'generation')::integer then raise exception 'Verified test WhatsApp connection required.';end if;
  due:=(p_payload->>'scheduled_at')::timestamptz; size:=(p_payload->>'batch_size')::integer;
  if due is null or due<=now() or due>now()+interval '90 days' or size is null or size not between 1 and 100
   or jsonb_typeof(p_payload->'template') is distinct from 'object' or length((p_payload->'template')::text)>12000
   or coalesce(p_payload->'template'->>'id','') !~ '^[0-9]{1,32}$'
   or coalesce(p_payload->'template'->>'language','') !~ '^[a-z]{2,3}(_[A-Za-z]{2,8}){0,2}$'
   or coalesce(p_payload->'template'->>'providerFingerprint','') !~ '^[a-f0-9]{64}$'
   then raise exception 'Schedule, batch size or template evidence is invalid.';end if;
  insert into marketing_private.whatsapp_campaign_runs(id,campaign_id,revision,connection_id,generation,template,scheduled_at,batch_size,actor_id)
  values(p_request,c.id,c.revision,conn.id,conn.credential_generation,p_payload->'template',due,size,actor) returning * into run;
  perform 1 from marketing_campaign_recipients where campaign_id=c.id and campaign_revision=c.revision and state='pending' for update;
  insert into marketing_private.whatsapp_campaign_deliveries(run_id,recipient_id,batch,due_at)
  select run.id,r.id,(r.position/size)+1,due+make_interval(secs=>r.position*60)
  from (select r.id,(row_number() over(order by r.id)-1)::integer as position from marketing_campaign_recipients r
   where r.campaign_id=c.id and r.campaign_revision=c.revision and r.state='pending') r;
  if not found then raise exception 'The approved queue has no pending recipients.';end if;
 else
  if run.id is null or run.id is distinct from (p_payload->>'run_id')::uuid
   or (p_action='pause' and run.state<>'scheduled') or (p_action='resume' and (run.state<>'paused' or c.status<>'ready'))
   or (p_action='cancel' and run.state not in ('scheduled','paused')) then raise exception 'Campaign schedule changed.';end if;
  if p_action='resume' and not exists(select 1 from marketing_connections k
   where k.id=run.connection_id and k.credential_generation=run.generation and marketing_private.whatsapp_campaign_connection(k))
  then raise exception 'The scheduled credential generation is unavailable. Cancel the schedule and review a new campaign.';end if;
  update marketing_private.whatsapp_campaign_runs set state=case p_action when 'pause' then 'paused' when 'resume' then 'scheduled' else 'cancelled' end
   where id=run.id returning * into run;
  if p_action='cancel' then
   update marketing_private.whatsapp_campaign_deliveries set state='cancelled',lease=null,lease_until=null
    where run_id=run.id and state='scheduled';
  end if;
 end if;
 result:=jsonb_build_object('id',run.id,'state',run.state);
 insert into marketing_requests values(p_request,actor,fingerprint,result);
 insert into marketing_campaign_events(campaign_id,brand_id,action,actor_employee_id) values(c.id,c.brand_id,'whatsapp_'||p_action,actor);
 return result;
end;$$;

create function public.marketing_campaign_whatsapp_read(p_org uuid,p_brand uuid,p_campaign uuid,p_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare c marketing_campaigns; run marketing_private.whatsapp_campaign_runs; summary jsonb; rows jsonb; total integer;
begin
 perform marketing_private.require_access(p_org,p_brand,'marketing_campaigns.view');
 select * into c from marketing_campaigns where id=p_campaign and organization_id=p_org and brand_id=p_brand;
 if c.id is null then raise exception 'Campaign unavailable.';end if;
 select * into run from marketing_private.whatsapp_campaign_runs where campaign_id=c.id and revision=c.revision;
 if run.id is null then return null;end if;
 select coalesce(jsonb_object_agg(state,amount),'{}') into summary from (
  select state,count(*) amount from marketing_private.whatsapp_campaign_deliveries where run_id=run.id group by state
 ) counts;
 select count(*) into total from marketing_private.whatsapp_campaign_deliveries where run_id=run.id;
 select coalesce(jsonb_agg(to_jsonb(item)),'[]') into rows from (
  select d.id,d.batch,d.due_at,d.state,d.reason,d.provider_message_id,d.reply_conversation_id,d.first_reply_at,customer.display_name
  from marketing_private.whatsapp_campaign_deliveries d join marketing_campaign_recipients r on r.id=d.recipient_id
  join platform_customers customer on customer.id=r.customer_id where d.run_id=run.id
  order by d.due_at,d.id limit 20 offset (greatest(1,least(coalesce(p_page,1),250))-1)*20
 ) item;
 return jsonb_build_object('id',run.id,'state',run.state,'scheduled_at',run.scheduled_at,'batch_size',run.batch_size,'counts',summary,'total',total,'rows',rows);
end;$$;

revoke all on function public.marketing_campaign_whatsapp_command(uuid,uuid,uuid,uuid,text,jsonb),
 public.marketing_campaign_whatsapp_read(uuid,uuid,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.marketing_campaign_whatsapp_command(uuid,uuid,uuid,uuid,text,jsonb),
 public.marketing_campaign_whatsapp_read(uuid,uuid,uuid,integer) to authenticated;

create function marketing_private.whatsapp_campaign_recipient_eligible(r public.marketing_campaign_recipients,c public.marketing_campaigns)
returns boolean language sql stable set search_path=public as $$
 select coalesce(r.state='pending' and r.campaign_revision=c.revision and exists(
  select 1 from platform_customers x where x.id=r.customer_id and x.organization_id=c.organization_id
   and x.active and x.revision=r.customer_revision and x.phone_e164=r.phone_e164
   and marketing_private.whatsapp_consent(c.brand_id,x.id)=r.consent_id
 ) and not exists(select 1 from marketing_conversations chat
  where chat.brand_id=c.brand_id and chat.organization_id=c.organization_id and chat.channel='whatsapp'
   and chat.participant_key=substring(r.phone_e164 from 2) and chat.opted_out),false)
$$;
revoke all on function marketing_private.whatsapp_campaign_recipient_eligible(public.marketing_campaign_recipients,public.marketing_campaigns) from public,anon,authenticated,service_role;

create function marketing_private.whatsapp_campaign_reconcile(e marketing_private.inbox_events)
returns void language plpgsql security definer set search_path=public as $$
declare delivery marketing_private.whatsapp_campaign_deliveries; next_state text; conversation uuid;
 kind text:=e.payload->>'kind'; event_id text:=e.payload->>'event_id'; target text;
begin
 if e.state<>'processed' or e.evidence_source is distinct from 'signed_webhook' or e.payload->>'channel' is distinct from 'whatsapp' then return;end if;
 target:=case when kind='status' then event_id when kind in ('incoming','attachment') then e.payload->>'reply_to_message_id' end;
 if target is null then return;end if;
 select d.* into delivery from marketing_private.whatsapp_campaign_deliveries d
 join marketing_private.whatsapp_campaign_runs w on w.id=d.run_id
 join marketing_campaign_recipients r on r.id=d.recipient_id
 join marketing_connections k on k.id=w.connection_id
 where w.connection_id=e.connection_id and w.generation=e.generation
  and k.provider_account_id=e.payload->>'account_id' and k.whatsapp_waba_id=e.payload->>'waba_id'
  and r.phone_e164='+'||(e.payload->>'peer_id') and d.attempted_at is not null
  and (d.provider_message_id=target or (kind='status' and d.provider_message_id is null
   and d.state in ('sending','unknown') and d.id::text=e.payload->>'campaign_callback_id'
   and not exists(select 1 from marketing_private.whatsapp_campaign_deliveries prior where prior.provider_message_id=target)))
 order by (d.provider_message_id is not null) desc limit 1 for update of d;
 if delivery.id is null then return;end if;
 if kind='status' then
  next_state:=case
   when delivery.state='read' or e.payload->>'provider_status'='read' then 'read'
   when delivery.state='delivered' or e.payload->>'provider_status'='delivered' then 'delivered'
   when delivery.state='failed' or e.payload->>'provider_status'='failed' then 'failed'
   when e.payload->>'provider_status'='sent' then 'sent'
  end;
  if next_state is not null then
   update marketing_private.whatsapp_campaign_deliveries set state=next_state,provider_message_id=target,
    reason=case when next_state='failed' then coalesce(e.payload->>'error_code','provider_failed') end
   where id=delivery.id;
  end if;
 elsif delivery.first_reply_at is null or (e.payload->>'occurred_at')::timestamptz<delivery.first_reply_at then
  select c.id into conversation from marketing_conversations c join marketing_conversation_messages m on m.conversation_id=c.id
  where c.connection_id=e.connection_id and c.connection_generation=e.generation and c.participant_key=e.payload->>'peer_id'
   and (e.payload->>'occurred_at')::timestamptz>=delivery.attempted_at-interval '1 second'
   and c.channel='whatsapp' and m.provider_message_id=event_id and m.kind in ('incoming','attachment');
  if conversation is not null then
   update marketing_private.whatsapp_campaign_deliveries set reply_conversation_id=conversation,first_reply_at=(e.payload->>'occurred_at')::timestamptz
   where id=delivery.id and (first_reply_at is null or (e.payload->>'occurred_at')::timestamptz<first_reply_at);
  end if;
 end if;
end;$$;

create function marketing_private.whatsapp_campaign_after_inbox() returns trigger language plpgsql security definer set search_path=public as $$
begin
 perform marketing_private.whatsapp_campaign_reconcile(new);
 return new;
end;$$;
create trigger whatsapp_campaign_after_inbox after update of state on marketing_private.inbox_events
 for each row when (new.state='processed' and old.state is distinct from new.state and new.payload->>'channel'='whatsapp')
 execute function marketing_private.whatsapp_campaign_after_inbox();
revoke all on function marketing_private.whatsapp_campaign_reconcile(marketing_private.inbox_events),
 marketing_private.whatsapp_campaign_after_inbox() from public,anon,authenticated,service_role;

create function public.marketing_campaign_whatsapp_worker(
 p_run uuid,p_operation text,p_delivery uuid default null,p_lease uuid default null,
 p_receipt text default null,p_reason text default null,p_allowed_peers text[] default '{}'
) returns jsonb language plpgsql security definer set search_path=public as $$
declare run marketing_private.whatsapp_campaign_runs; d marketing_private.whatsapp_campaign_deliveries;
 c marketing_campaigns; conn marketing_connections; r marketing_campaign_recipients; e marketing_private.inbox_events;
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='Service only.';end if;
 -- Serialize the short claim and send transition across workers. Never hold a DB lock across Meta I/O.
 perform pg_advisory_xact_lock(hashtextextended('whatsapp-campaign-dispatch',0));
 select * into run from marketing_private.whatsapp_campaign_runs where id=p_run;
 if run.id is null then return null;end if;
 select * into c from marketing_campaigns where id=run.campaign_id for update;
 select * into run from marketing_private.whatsapp_campaign_runs where id=p_run for update;

 if p_operation='claim' then
  if run.state<>'scheduled' or c.status<>'ready' or c.revision<>run.revision or c.approved_revision is distinct from run.revision
   or exists(select 1 from marketing_private.whatsapp_campaign_deliveries where attempted_at>now()-interval '60 seconds'
     or (state in ('scheduled','sending') and lease_until>now())) then return null;end if;
  select * into d from marketing_private.whatsapp_campaign_deliveries where run_id=run.id and state='scheduled' and due_at<=now()
   order by due_at,id limit 1 for update skip locked;
 elsif p_operation in ('begin','guard','accepted','failed','unknown') then
  select * into d from marketing_private.whatsapp_campaign_deliveries where id=p_delivery and run_id=run.id and lease=p_lease for update;
 else raise exception 'Unknown campaign worker operation.';end if;
 if d.id is null then return null;end if;
 if p_operation in ('accepted','failed','unknown') then
  if d.state not in ('scheduled','sending','sent','delivered','read','failed') then return null;end if;
  if p_operation='accepted' then
   if d.attempted_at is null or coalesce(p_receipt,'') !~ '^wamid\.[A-Za-z0-9._=+/-]{1,294}$'
    or (d.provider_message_id is not null and d.provider_message_id<>p_receipt) then return null;end if;
   update marketing_private.whatsapp_campaign_deliveries set
    state=case when state in ('sent','delivered','read','failed') then state else 'accepted' end,
    provider_message_id=p_receipt,lease=null,lease_until=null
   where id=d.id;
   for e in select * from marketing_private.inbox_events where connection_id=run.connection_id and generation=run.generation
    and state='processed' and (payload->>'event_id'=p_receipt or payload->>'reply_to_message_id'=p_receipt)
   loop perform marketing_private.whatsapp_campaign_reconcile(e);end loop;
  elsif d.state in ('scheduled','sending') then
   update marketing_private.whatsapp_campaign_deliveries set
    state=case when p_operation='unknown' and attempted_at is not null then 'unknown' else 'failed' end,
    reason=case when p_operation='unknown' and attempted_at is not null then 'provider_outcome_unknown'
     when p_reason in ('template_or_provider_unavailable','provider_rejected','provider_token_invalid','provider_permission_required','provider_rate_limited','provider_recipient_unavailable') then p_reason
     else 'dispatch_preflight_failed' end,
    lease=null,lease_until=null where id=d.id;
  end if;
  if not exists(select 1 from marketing_private.whatsapp_campaign_deliveries where run_id=run.id and state in ('scheduled','sending'))
   then update marketing_private.whatsapp_campaign_runs set state='complete' where id=run.id and state='scheduled';end if;
  return jsonb_build_object('recorded',true);
 end if;

 if run.state<>'scheduled' or c.status<>'ready' or c.revision<>run.revision or c.approved_revision is distinct from run.revision then return null;end if;
 if p_operation<>'claim' and (d.lease_until<=now() or (p_operation='begin' and d.state<>'scheduled')
  or (p_operation='guard' and d.state not in ('scheduled','sending'))) then return null;end if;
 select * into conn from marketing_connections where id=run.connection_id;
 if conn.brand_id is distinct from c.brand_id or conn.organization_id is distinct from c.organization_id
  or conn.credential_generation is distinct from run.generation or not marketing_private.whatsapp_campaign_connection(conn)
  or not coalesce(marketing_private.actor_allowed(run.actor_id,c.organization_id,c.brand_id,'marketing_campaigns.execute'),false)
  or not coalesce(marketing_private.actor_allowed(run.actor_id,c.organization_id,c.brand_id,'marketing_campaigns.approve'),false) then
  update marketing_private.whatsapp_campaign_runs set state='paused' where id=run.id;
  return null;
 end if;
 select * into r from marketing_campaign_recipients where id=d.recipient_id;
 if not marketing_private.whatsapp_campaign_recipient_eligible(r,c)
  or not coalesce(substring(r.phone_e164 from 2)=any(p_allowed_peers),false) then
  if d.state='scheduled' then
   update marketing_private.whatsapp_campaign_deliveries set state='suppressed',reason='recipient_ineligible',lease=null,lease_until=null where id=d.id;
   if not exists(select 1 from marketing_private.whatsapp_campaign_deliveries where run_id=run.id and state in ('scheduled','sending'))
    then update marketing_private.whatsapp_campaign_runs set state='complete' where id=run.id;end if;
  end if;
  return null;
 end if;
 if p_operation='claim' then
  update marketing_private.whatsapp_campaign_deliveries set lease=gen_random_uuid(),lease_until=now()+interval '75 seconds'
   where id=d.id returning * into d;
 elsif p_operation='begin' then
  update marketing_private.whatsapp_campaign_deliveries set state='sending',attempted_at=now(),lease_until=now()+interval '75 seconds'
   where id=d.id returning * into d;
 end if;
 return jsonb_build_object('id',d.id,'lease',d.lease,'connection_id',conn.id,'generation',run.generation,
  'peer',substring(r.phone_e164 from 2),'template',run.template);
end;$$;
revoke all on function public.marketing_campaign_whatsapp_worker(uuid,text,uuid,uuid,text,text,text[]) from public,anon,authenticated,service_role;
grant execute on function public.marketing_campaign_whatsapp_worker(uuid,text,uuid,uuid,text,text,text[]) to service_role;

-- Lock the campaign before its recipient, matching the schedule authority.
do $migration$
declare
 f text:=pg_get_functiondef('public.marketing_outreach_command(uuid,uuid,uuid,text,uuid,jsonb)'::regprocedure);
 needle constant text:=$old$  select * into r from public.marketing_campaign_recipients where id=p_id for update;select * into c from public.marketing_campaigns where id=r.campaign_id and organization_id=p_org and brand_id=p_brand for update;$old$;
begin
 if strpos(f,needle)=0 then raise exception 'Unexpected Campaign recipient authority baseline';end if;
 execute replace(f,needle,$patch$  select * into c from public.marketing_campaigns where id=(select campaign_id from public.marketing_campaign_recipients where id=p_id)
   and organization_id=p_org and brand_id=p_brand for update;
  select * into r from public.marketing_campaign_recipients where id=p_id and campaign_id=c.id for update;
  if p_action in ('open','confirm') and exists(
   select 1 from marketing_private.whatsapp_campaign_deliveries d
   where d.recipient_id=r.id and d.state not in ('cancelled','suppressed')
  ) then raise exception 'This recipient is assigned to a Cloud API schedule.';end if;
  $patch$);
end;
$migration$;

create function public.marketing_campaign_whatsapp_cleanup() returns void
language plpgsql security definer set search_path=public as $$
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='Service only.';end if;
 update marketing_private.whatsapp_campaign_deliveries set state='unknown',reason='provider_outcome_unknown',lease=null,lease_until=null
 where id in (select id from marketing_private.whatsapp_campaign_deliveries
  where state='sending' and lease_until<=now() order by lease_until limit 100 for update skip locked);
 update marketing_private.whatsapp_campaign_runs r set state='complete'
 where r.state='scheduled' and not exists(select 1 from marketing_private.whatsapp_campaign_deliveries d
  where d.run_id=r.id and d.state in ('scheduled','sending'));
end;$$;
revoke all on function public.marketing_campaign_whatsapp_cleanup() from public,anon,authenticated,service_role;
grant execute on function public.marketing_campaign_whatsapp_cleanup() to service_role;
