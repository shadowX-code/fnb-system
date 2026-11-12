-- Only the previously approved, provider-verified QA recipient is enrolled.
create table marketing_private.whatsapp_test_recipients (
 peer text primary key check (peer ~ '^\d{7,15}$')
);
alter table marketing_private.whatsapp_test_recipients enable row level security;
revoke all on marketing_private.whatsapp_test_recipients from public,anon,authenticated,service_role;

insert into marketing_private.whatsapp_test_recipients(peer)
select chat.participant_key
from public.marketing_conversations chat
join public.marketing_connections conn on conn.id=chat.connection_id
join marketing_private.whatsapp_campaign_runs run on run.connection_id=conn.id
join marketing_private.whatsapp_campaign_deliveries delivery on delivery.run_id=run.id
join public.marketing_campaign_recipients recipient on recipient.id=delivery.recipient_id
where chat.id='4ea6db5b-1d11-4c51-a7c1-8e7cd9d369fa'
 and chat.brand_id='3a60f950-9510-4538-b7de-93789573bc0b' and chat.channel='whatsapp'
 and conn.provider_account_id='1221509657713215' and conn.whatsapp_waba_id='1675083730240518'
 and run.id='db88f28f-591d-43ab-96e7-c9936310fc3a'
 and delivery.state in ('delivered','read') and delivery.provider_message_id is not null
 and recipient.phone_e164='+'||chat.participant_key and right(chat.participant_key,4)='8678'
on conflict do nothing;

create function marketing_private.whatsapp_test_recipient(p_peer text)
returns boolean language sql stable set search_path=public as $$
 select exists(select 1 from marketing_private.whatsapp_test_recipients where peer=p_peer)
$$;

create function marketing_private.whatsapp_test_connection(conn public.marketing_connections)
returns boolean language sql stable set search_path=public as $$
 select coalesce(conn.brand_id='3a60f950-9510-4538-b7de-93789573bc0b'
  and conn.channel='whatsapp' and conn.whatsapp_onboarding_mode='cloud_api'
  and conn.provider_account_id='1221509657713215' and conn.whatsapp_waba_id='1675083730240518'
  and marketing_private.whatsapp_receiving(conn.id),false)
$$;

create or replace function marketing_private.whatsapp_campaign_connection(conn public.marketing_connections)
returns boolean language sql stable set search_path=public as $$
 select marketing_private.whatsapp_test_connection(conn)
$$;

create function marketing_private.whatsapp_test_chat_scope(c public.marketing_conversations,conn public.marketing_connections)
returns boolean language sql stable set search_path=public as $$
 select coalesce(
  marketing_private.whatsapp_test_connection(conn) and marketing_private.whatsapp_test_recipient(c.participant_key)
  and c.connection_id=conn.id and c.organization_id=conn.organization_id and c.brand_id=conn.brand_id
  and c.channel='whatsapp' and c.medium='dm' and c.takeover and not c.opted_out and c.status<>'resolved'
  and c.connection_generation<=conn.credential_generation
  and not exists(select 1 from public.marketing_conversations newer
   where newer.connection_id=c.connection_id and newer.participant_key=c.participant_key
    and newer.connection_generation>c.connection_generation)
  and not exists(
   select 1 from public.marketing_conversations other
   join public.marketing_reply_drafts draft on draft.conversation_id=other.id
   join public.marketing_reply_outbox outbox on outbox.draft_id=draft.id
   where other.connection_id=c.connection_id and other.participant_key=c.participant_key
    and other.id<>c.id and outbox.state in ('prepared','pending','reconciling')
  ),false)
$$;

create or replace function marketing_private.whatsapp_test_staff_ready(c public.marketing_conversations,conn public.marketing_connections)
returns boolean language sql stable security definer set search_path=public as $$
 select marketing_private.whatsapp_test_chat_scope(c,conn)
  and c.connection_generation=conn.credential_generation
  and exists (
   select 1 from marketing_private.inbox_events e
   join public.marketing_conversation_messages m on m.conversation_id=c.id and m.provider_message_id=e.payload->>'event_id'
   where e.connection_id=conn.id and e.generation=conn.credential_generation
    and e.evidence_source='signed_webhook' and e.state='processed'
    and e.payload->>'account_id'=conn.provider_account_id and e.payload->>'waba_id'=conn.whatsapp_waba_id
    and e.payload->>'peer_id'=c.participant_key and e.payload->>'kind' in ('incoming','attachment')
    and m.evidence_source='signed_webhook' and m.kind in ('incoming','attachment')
    and m.occurred_at>now()-interval '24 hours' and m.occurred_at<=now()
  )
$$;

create or replace function marketing_private.whatsapp_test_template_ready(c public.marketing_conversations,conn public.marketing_connections)
returns boolean language sql stable security definer set search_path=public as $$
 select marketing_private.whatsapp_test_chat_scope(c,conn)
  and exists (
   select 1 from public.platform_customers customer
   where customer.organization_id=c.organization_id and customer.phone_e164='+'||c.participant_key
    and marketing_private.whatsapp_consent(c.brand_id,customer.id) is not null
  )
$$;

revoke all on function marketing_private.whatsapp_test_recipient(text),
 marketing_private.whatsapp_test_connection(public.marketing_connections),
 marketing_private.whatsapp_test_chat_scope(public.marketing_conversations,public.marketing_connections)
 from public,anon,authenticated,service_role;

-- A new-generation conversation cannot race an intent prepared on the preceding one.
do $migration$
declare
 prepare_def text:=pg_get_functiondef('public.marketing_inbox_prepare_send(uuid,uuid)'::regprocedure);
 marker constant text:=$old$ select * into conn from public.marketing_connections where id=c.connection_id;$old$;
 scope_def text:=pg_get_functiondef('public.marketing_inbox_staff_send_scope(uuid,uuid)'::regprocedure);
 old_diagnostics constant text:=$old$'whatsapp_qa_diagnostics_allowed',case when c.channel='whatsapp' then
   marketing_private.actor_allowed(actor,c.organization_id,c.brand_id,'marketing_settings.view')
   and marketing_private.actor_allowed(actor,c.organization_id,c.brand_id,'marketing_settings.configure')
  else false end,$old$;
begin
 if strpos(prepare_def,marker)=0 or strpos(scope_def,old_diagnostics)=0 then
  raise exception 'Unexpected Inbox send scope baseline';
 end if;
 execute replace(prepare_def,marker,$new$ if c.channel='whatsapp' then
  perform pg_advisory_xact_lock(hashtextextended('whatsapp-chat:'||c.connection_id::text||':'||c.participant_key,0));
 end if;
$new$||marker);
 execute replace(scope_def,old_diagnostics,'');
end;
$migration$;

-- Count and schedule exactly the same recipients the worker can dispatch.
create or replace function marketing_private.whatsapp_campaign_recipient_eligible(r public.marketing_campaign_recipients,c public.marketing_campaigns)
returns boolean language sql stable set search_path=public as $$
 select coalesce(c.brand_id='3a60f950-9510-4538-b7de-93789573bc0b' and r.state='pending' and r.campaign_id=c.id and r.campaign_revision=c.revision
 and marketing_private.whatsapp_test_recipient(substring(r.phone_e164 from 2))
 and exists(
  select 1 from public.platform_customers x where x.id=r.customer_id and x.organization_id=c.organization_id
   and x.active and x.revision=r.customer_revision and x.phone_e164=r.phone_e164
   and marketing_private.whatsapp_consent(c.brand_id,x.id)=r.consent_id
 ) and not exists(select 1 from public.marketing_conversations chat
  where chat.brand_id=c.brand_id and chat.organization_id=c.organization_id and chat.channel='whatsapp'
   and chat.participant_key=substring(r.phone_e164 from 2) and chat.opted_out),false)
$$;

-- Existing schedules were saved under a separate dispatch process. An explicit
-- schedule or reschedule through the current workflow records dispatch intent.
alter table marketing_private.whatsapp_campaign_runs add column dispatch_confirmed_at timestamptz;

do $migration$
declare
 f text:=pg_get_functiondef('public.marketing_campaign_whatsapp_command(uuid,uuid,uuid,uuid,text,jsonb)'::regprocedure);
 old_approval constant text:=$old$if p_action in ('schedule','reschedule') then perform marketing_private.require_access(p_org,p_brand,'marketing_campaigns.approve');end if;$old$;
 old_insert constant text:=$old$insert into marketing_private.whatsapp_campaign_runs(id,campaign_id,revision,connection_id,generation,template,scheduled_at,batch_size,actor_id)
  values(p_request,c.id,c.revision,conn.id,conn.credential_generation,p_payload->'template',due,size,actor)$old$;
 old_queue constant text:=$old$where r.campaign_id=c.id and r.campaign_revision=c.revision and r.state='pending') r;
  if not found then raise exception 'The approved queue has no pending recipients.';end if;$old$;
 old_reschedule constant text:=$old$set scheduled_at=due,generation=conn.credential_generation,state='scheduled',actor_id=actor$old$;
 old_resume constant text:=$old$p_action='resume' and (run.state<>'paused' or c.status<>'ready')$old$;
 read_def text:=pg_get_functiondef('public.marketing_campaign_whatsapp_read(uuid,uuid,uuid,integer)'::regprocedure);
 old_read constant text:=$old$'counts',summary,'total',total$old$;
begin
 if strpos(f,old_approval)=0 or strpos(f,old_insert)=0 or strpos(f,old_queue)=0 or strpos(f,old_reschedule)=0
  or strpos(f,old_resume)=0 or strpos(read_def,old_read)=0 then raise exception 'Unexpected WhatsApp campaign schedule baseline';end if;
 f:=replace(f,old_approval,old_approval||$new$
 if p_action in ('schedule','reschedule') and p_payload->'dispatch_confirmed' is distinct from 'true'::jsonb then
  raise exception 'Confirm the WhatsApp test send schedule.';
 end if;$new$);
 f:=replace(f,old_insert,$new$insert into marketing_private.whatsapp_campaign_runs(id,campaign_id,revision,connection_id,generation,template,scheduled_at,batch_size,actor_id,dispatch_confirmed_at)
  values(p_request,c.id,c.revision,conn.id,conn.credential_generation,p_payload->'template',due,size,actor,now())$new$);
 f:=replace(f,old_queue,$new$where r.campaign_id=c.id and marketing_private.whatsapp_campaign_recipient_eligible(r,c)) r;
  if not found then raise exception 'The approved queue has no eligible WhatsApp test recipients.';end if;
  if exists(select 1 from marketing_private.whatsapp_campaign_deliveries d where d.run_id=run.id and d.due_at>=conn.expires_at)
  then raise exception 'Choose a future schedule within the verified WhatsApp credential lifetime.';end if;$new$);
 f:=replace(f,old_reschedule,old_reschedule||',dispatch_confirmed_at=now()');
 f:=replace(f,old_resume,$new$p_action='resume' and (run.state<>'paused' or c.status<>'ready' or run.dispatch_confirmed_at is null)$new$);
 execute f;
 execute replace(read_def,old_read,$new$'dispatch_confirmed',run.dispatch_confirmed_at is not null,'counts',summary,'total',total$new$);
end;
$migration$;

create or replace function public.marketing_campaign_whatsapp_rehearsal(
 p_org uuid,p_brand uuid,p_campaign uuid,p_revision integer,p_scheduled_at timestamptz,p_batch_size integer
) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare c marketing_campaigns; queued integer; eligible integer; batch_count integer;
begin
 perform marketing_private.require_access(p_org,p_brand,'marketing_campaigns.execute');
 if p_scheduled_at is null or p_scheduled_at<=now() or p_scheduled_at>now()+interval '90 days'
  or p_batch_size is null or p_batch_size not between 1 and 100 then raise exception 'Choose a future time and a batch size of 1–100.';end if;
 select * into c from marketing_campaigns where id=p_campaign and organization_id=p_org and brand_id=p_brand;
 if c.id is null or c.status<>'ready' or c.revision is distinct from p_revision or c.approved_revision is distinct from c.revision
 then raise exception 'Queue the current approved campaign before rehearsing.';end if;
 select count(*),count(*) filter(where marketing_private.whatsapp_campaign_recipient_eligible(r,c))
 into queued,eligible from public.marketing_campaign_recipients r
 where r.campaign_id=c.id and r.campaign_revision=c.revision and r.state='pending';
 batch_count:=(eligible+p_batch_size-1)/p_batch_size;
 return jsonb_build_object('campaign_revision',c.revision,'scheduled_at',p_scheduled_at,'batch_size',p_batch_size,
  'queued',queued,'eligible',eligible,'excluded',queued-eligible,'batches',batch_count,'dispatch_enabled',false);
end;$$;

-- Retain the service-only RPC and its lease/checkpoint protocol. Old callers can
-- finish existing receipts; supplied peers never authorize a dispatch.
do $migration$
declare
 f text:=pg_get_functiondef('public.marketing_campaign_whatsapp_worker(uuid,text,uuid,uuid,text,text,text[])'::regprocedure);
 old_lock constant text:=$old$ select * into run from marketing_private.whatsapp_campaign_runs where id=p_run;
 if run.id is null then return null;end if;
 select * into c from marketing_campaigns where id=run.campaign_id for update;
 select * into run from marketing_private.whatsapp_campaign_runs where id=p_run for update;$old$;
 old_queue constant text:=$old$if run.state<>'scheduled' or c.status<>'ready'$old$;
 old_peers constant text:=$old$if not marketing_private.whatsapp_campaign_recipient_eligible(r,c)
  or not coalesce(substring(r.phone_e164 from 2)=any(p_allowed_peers),false) then$old$;
 old_result constant text:=$old$return jsonb_build_object('id',d.id,'lease',d.lease,'connection_id',conn.id,'generation',run.generation,$old$;
begin
 if strpos(f,old_lock)=0 or strpos(f,old_queue)=0 or strpos(f,old_peers)=0 or strpos(f,old_result)=0
 then raise exception 'Unexpected WhatsApp campaign worker baseline';end if;
 f:=replace(f,old_lock,$new$ if p_operation='claim' and p_run is null then
  select w.* into run from marketing_private.whatsapp_campaign_runs w
  join marketing_private.whatsapp_campaign_deliveries delivery on delivery.run_id=w.id
  join public.marketing_campaigns campaign on campaign.id=w.campaign_id
  where w.state='scheduled' and w.dispatch_confirmed_at is not null
   and campaign.status='ready' and campaign.revision=w.revision and campaign.approved_revision=w.revision
   and delivery.state='scheduled' and delivery.due_at<=now()
  order by delivery.due_at,delivery.id limit 1;
 else
  select * into run from marketing_private.whatsapp_campaign_runs where id=p_run;
 end if;
 if run.id is null then return null;end if;
 select * into c from marketing_campaigns where id=run.campaign_id for update;
 select * into run from marketing_private.whatsapp_campaign_runs where id=run.id for update;$new$);
 f:=replace(f,old_queue,$new$if run.dispatch_confirmed_at is null or run.state<>'scheduled' or c.status<>'ready'$new$);
 f:=replace(f,old_peers,$new$if not marketing_private.whatsapp_campaign_recipient_eligible(r,c) then$new$);
 execute replace(f,old_result,$new$return jsonb_build_object('id',d.id,'run_id',run.id,'lease',d.lease,'connection_id',conn.id,'generation',run.generation,$new$);
end;
$migration$;
