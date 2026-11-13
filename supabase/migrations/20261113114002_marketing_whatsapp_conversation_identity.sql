-- WhatsApp's connection permanently pins the Brand, channel and sender phone.
-- Credential generations authorize individual events and sends, not conversation identity.
begin;
set local lock_timeout = '5s';
lock table public.marketing_conversations in share row exclusive mode;

alter table public.marketing_conversations
 add column whatsapp_generations integer[] not null default '{}',
 add constraint inbox_whatsapp_peer_format
 check (channel <> 'whatsapp' or participant_key ~ '^[0-9]{1,32}$');

alter table public.marketing_conversation_messages add column whatsapp_generation integer;
update public.marketing_conversation_messages m
 set whatsapp_generation=c.connection_generation
 from public.marketing_conversations c
 where m.conversation_id=c.id and c.channel='whatsapp' and m.evidence_source='signed_webhook';

update public.marketing_conversations
 c set whatsapp_generations=array(
 select c.connection_generation
 union
 select o.connection_generation from public.marketing_reply_outbox o
 join public.marketing_reply_drafts d on d.id=o.draft_id
 where d.conversation_id=c.id and o.connection_generation is not null
 order by 1)
where c.channel='whatsapp';

-- Reparent evidence in place. Keep the latest credential's thread ID and leave old
-- command results and audit events intact. A merge event records the original thread IDs.
-- No erasure tombstone for reconciled threads. Their content and opt-out are retained.
alter table public.marketing_conversations disable trigger inbox_preserve_erased_optout;
do $merge$
declare
 group_ record;
 keep uuid;
 old_ids uuid[];
 all_ids uuid[];
begin
 for group_ in
  select organization_id,brand_id,connection_id,participant_key,
   array_agg(id order by connection_generation desc,created_at,id) ids
  from public.marketing_conversations
  where channel='whatsapp'
  group by organization_id,brand_id,connection_id,participant_key having count(*)>1
 loop
  all_ids:=group_.ids;
  keep:=all_ids[1];
  old_ids:=all_ids[2:];
  if not exists(select 1 from public.marketing_connections k
    where k.id=group_.connection_id and k.organization_id=group_.organization_id
     and k.brand_id=group_.brand_id and k.channel='whatsapp' and k.provider_account_id ~ '^[0-9]{1,32}$')
   or exists(select 1 from marketing_private.inbox_legal_holds where conversation_id=any(all_ids))
   or exists(select 1 from marketing_private.inbox_profiles where conversation_id=any(old_ids))
   or exists(select 1 from public.marketing_reply_outbox o join public.marketing_reply_drafts d on d.id=o.draft_id
    where d.conversation_id=any(all_ids) and o.state in ('prepared','pending','reconciling'))
   or exists(select 1 from public.marketing_conversation_messages
    where conversation_id=any(all_ids) and provider_message_id is not null
    group by provider_message_id,kind having count(*)>1)
  then
   raise exception 'WhatsApp thread group requires manual reconciliation: %',keep;
  end if;

  insert into public.marketing_events(organization_id,brand_id,action,details)
  select group_.organization_id,group_.brand_id,'whatsapp_conversations_reconciled',
   jsonb_build_object('conversation_id',keep,'prior_threads',jsonb_agg(jsonb_build_object(
    'id',id,'generation',connection_generation,'version',version,'status',status,
    'assigned_to',assigned_to,'tags',tags,'created_at',created_at,'status_changed_at',status_changed_at,
    'priority',priority,'outlet_id',outlet_id,'resolution_hold',resolution_hold)
    order by connection_generation))
  from public.marketing_conversations where id=any(all_ids);

  -- Keep a conservative read cursor so merging cannot mark an unread inbound as read.
  insert into public.marketing_inbox_reads(conversation_id,employee_id,through_sequence,read_at,remind_at)
  select keep,r.employee_id,
   least(max(r.through_sequence),coalesce((
    select min(m.sequence)-1 from public.marketing_conversation_messages m
    left join public.marketing_inbox_reads source
     on source.conversation_id=m.conversation_id and source.employee_id=r.employee_id
    where m.conversation_id=any(all_ids) and m.kind in ('incoming','attachment')
     and m.sequence>coalesce(source.through_sequence,0)
   ),max(r.through_sequence))),max(r.read_at),min(r.remind_at)
  from public.marketing_inbox_reads r where r.conversation_id=any(all_ids)
  group by r.employee_id
  on conflict(conversation_id,employee_id) do update
   set through_sequence=excluded.through_sequence,read_at=excluded.read_at,remind_at=excluded.remind_at;

  update public.marketing_conversation_messages set conversation_id=keep where conversation_id=any(old_ids);
  update public.marketing_reply_drafts set conversation_id=keep where conversation_id=any(old_ids);
  update public.marketing_inbox_faqs set source_conversation_id=keep where source_conversation_id=any(old_ids);
  update public.marketing_inbox_ai_artifacts set conversation_id=keep where conversation_id=any(old_ids);
  update marketing_private.inbox_ai_runs set conversation_id=keep where conversation_id=any(old_ids);
  update marketing_private.inbox_automatic_turns set conversation_id=keep where conversation_id=any(old_ids);
  update marketing_private.whatsapp_campaign_deliveries set reply_conversation_id=keep where reply_conversation_id=any(old_ids);
  delete from public.marketing_inbox_reads where conversation_id=any(old_ids);

  update public.marketing_conversations c set
   created_at=(select min(created_at) from public.marketing_conversations where id=any(all_ids)),
   updated_at=(select max(updated_at) from public.marketing_conversations where id=any(all_ids)),
   last_activity_at=(select max(last_activity_at) from public.marketing_conversations where id=any(all_ids)),
   last_inbound_at=(select max(last_inbound_at) from public.marketing_conversations where id=any(all_ids)),
   version=(select max(version)+1 from public.marketing_conversations where id=any(all_ids)),
   summary=null,summary_version=null,
   assigned_to=coalesce(c.assigned_to,(select assigned_to from public.marketing_conversations
     where id=any(old_ids) and assigned_to is not null order by updated_at desc,id limit 1)),
   tags=array(select distinct unnest(tags) from public.marketing_conversations where id=any(all_ids) order by 1),
   escalation_reasons=array(select distinct unnest(escalation_reasons) from public.marketing_conversations where id=any(all_ids) order by 1),
   opted_out=(select bool_or(opted_out) from public.marketing_conversations where id=any(all_ids)),
   takeover=(select bool_or(takeover) from public.marketing_conversations where id=any(all_ids)),
   resolution_hold=(select bool_or(resolution_hold) from public.marketing_conversations where id=any(all_ids)),
   whatsapp_generations=array(
    select unnest(whatsapp_generations) from public.marketing_conversations where id=any(all_ids)
    union
    select o.connection_generation from public.marketing_reply_outbox o
    join public.marketing_reply_drafts d on d.id=o.draft_id
    where d.conversation_id=keep and o.connection_generation is not null
    order by 1)
  where c.id=keep;

  delete from public.marketing_conversations where id=any(old_ids);
 end loop;
end;
$merge$;
alter table public.marketing_conversations enable trigger inbox_preserve_erased_optout;

create unique index inbox_whatsapp_conversation_identity
 on public.marketing_conversations(organization_id,brand_id,connection_id,participant_key)
 where channel='whatsapp';

-- Only the worker advances the WhatsApp inbound generation. Public Inbox mutations
-- accept a conversation version and cannot assign any of these identity columns.
do $functions$
declare
 def text;
 old_lookup constant text:='where connection_id=conn.id and connection_generation=ev.generation and participant_key=peer for update';
begin
 def:=pg_get_functiondef('marketing_private.inbox_generation_guard()'::regprocedure);
 execute replace(def,
  'new.connection_generation is distinct from old.connection_generation or new.connection_id is distinct from old.connection_id',
  $sql$new.connection_id is distinct from old.connection_id
   or (new.channel='whatsapp' and (new.participant_key,new.brand_id,new.organization_id,new.channel)
     is distinct from (old.participant_key,old.brand_id,old.organization_id,old.channel))
   or (new.connection_generation is distinct from old.connection_generation and not (
    old.channel='whatsapp' and new.connection_generation=x.credential_generation
    and new.connection_generation>old.connection_generation
    and new.whatsapp_generations @> old.whatsapp_generations
    and new.connection_generation=any(new.whatsapp_generations)))$sql$);

 def:=pg_get_functiondef('public.marketing_inbox_process_events(integer)'::regprocedure);
 if strpos(def,old_lookup)=0 or strpos(def,'returning id into inserted')=0 then
  raise exception 'Unexpected Inbox worker baseline';
 end if;
 def:=replace(def,old_lookup,$sql$where connection_id=conn.id and organization_id=conn.organization_id
   and brand_id=conn.brand_id and channel=conn.channel and participant_key=peer
   and (conn.channel='whatsapp' or connection_generation=ev.generation) for update$sql$);
 def:=replace(def,'on conflict(connection_id,connection_generation,participant_key) do nothing','on conflict do nothing');
 def:=replace(def,'delivery_state,evidence_source,provider_context)','delivery_state,evidence_source,provider_context,whatsapp_generation)');
 def:=replace(def,$sql$left(item->>'interaction_payload',1000)))) on conflict$sql$,
  $sql$left(item->>'interaction_payload',1000))),case when conn.channel='whatsapp' then ev.generation end) on conflict$sql$);
 if strpos(def,'case when conn.channel=''whatsapp'' then ev.generation end) on conflict')=0 then
  raise exception 'Unexpected Inbox message insert baseline';
 end if;
 def:=replace(def,'set version=version+1,updated_at=now(),',$sql$set version=version+1,updated_at=now(),
      whatsapp_generations=case when conn.channel='whatsapp' and not ev.generation=any(whatsapp_generations)
       then array_append(whatsapp_generations,ev.generation) else whatsapp_generations end,
      connection_generation=case when conn.channel='whatsapp' and ev.evidence_source='signed_webhook'
        and item->>'kind' in ('incoming','attachment') then ev.generation else connection_generation end,$sql$);
 -- Duplicates delivered again after rotation keep the original evidence and cannot refresh the window.
 execute def;

 def:=pg_get_functiondef('public.marketing_inbox_prepare_send(uuid,uuid)'::regprocedure);
 def:=replace(def,' if not marketing_private.inbox_assistant_draft_current(d)',
  $sql$ if c.channel='whatsapp' and exists(
  select 1 from public.marketing_reply_drafts other
  join public.marketing_reply_outbox prior on prior.draft_id=other.id
  where other.conversation_id=c.id and other.id<>d.id and prior.state in ('prepared','pending','reconciling')
 ) then raise exception 'A reply is already in progress.';end if;
 if not marketing_private.inbox_assistant_draft_current(d)$sql$);
 def:=replace(def,' update public.marketing_reply_outbox set execution_request=p_request',
  $sql$ if c.channel='whatsapp' and not conn.credential_generation=any(c.whatsapp_generations) then
  update public.marketing_conversations set whatsapp_generations=array_append(whatsapp_generations,conn.credential_generation)
  where id=c.id;
 end if;
 update public.marketing_reply_outbox set execution_request=p_request$sql$);
 execute def;

 def:=pg_get_functiondef('marketing_private.whatsapp_reconcile(uuid,integer)'::regprocedure);
 execute replace(def,' and (d.whatsapp_template is not null or c.connection_generation=p_generation)','');

 def:=pg_get_functiondef('marketing_private.whatsapp_reconcile_changes(uuid,integer)'::regprocedure);
 def:=replace(def,' and c.connection_generation=e.generation','');
 def:=replace(def,'evidence_source,provider_context)','evidence_source,provider_context,whatsapp_generation)');
 execute replace(def,$sql$'target_direction',e.payload->>'target_direction')$sql$,
  $sql$'target_direction',e.payload->>'target_direction'),e.generation$sql$);

 def:=pg_get_functiondef('marketing_private.whatsapp_campaign_reconcile(marketing_private.inbox_events)'::regprocedure);
 execute replace(def,'c.connection_generation=e.generation','m.whatsapp_generation=e.generation');

 def:=pg_get_functiondef('marketing_private.whatsapp_inbox_identity(public.marketing_conversations,uuid)'::regprocedure);
 execute replace(def,'c.connection_generation','m.whatsapp_generation');

 def:=pg_get_functiondef('marketing_private.whatsapp_test_staff_ready(public.marketing_conversations,public.marketing_connections)'::regprocedure);
 execute replace(def,'m.conversation_id=c.id and m.provider_message_id',
  'm.conversation_id=c.id and m.whatsapp_generation=e.generation and m.provider_message_id');

 def:=pg_get_functiondef('public.marketing_inbox_detail(uuid,integer,integer)'::regprocedure);
 if strpos(def,$sql$where m.conversation_id=c.id and m.kind in ('incoming','attachment')$sql$)=0 then
  raise exception 'Unexpected WhatsApp service window baseline';
 end if;
 execute replace(def,$sql$where m.conversation_id=c.id and m.kind in ('incoming','attachment')$sql$,
  $sql$where m.conversation_id=c.id and m.whatsapp_generation=c.connection_generation and m.kind in ('incoming','attachment')$sql$);
 def:=pg_get_functiondef('marketing_private.inbox_restore_erased_optout()'::regprocedure);
 execute replace(def,'t.generation=new.connection_generation',
  $sql$(new.channel='whatsapp' or t.generation=new.connection_generation)$sql$);

 def:=pg_get_functiondef('marketing_private.whatsapp_enqueue(jsonb)'::regprocedure);
 execute replace(def,'t.generation=c.credential_generation and t.peer_hash','t.peer_hash');

 -- A stable thread can contain evidence from multiple grants. The existing
 -- conversation erasure operates on the whole thread, including every prior peer payload.
 def:=pg_get_functiondef('marketing_private.inbox_erase_conversation(uuid,text)'::regprocedure);
 if strpos(def,'e.generation=c.connection_generation')=0 then
  raise exception 'Unexpected Inbox erasure baseline';
 end if;
 def:=replace(def,'e.generation=c.connection_generation',
  $sql$(c.channel='whatsapp' or e.generation=c.connection_generation)$sql$);
 def:=replace(def,'select c.id::text id union select id::text from public.marketing_conversation_messages',
  $sql$select c.id::text id
  union select prior->>'id' from public.marketing_events a
   cross join lateral jsonb_array_elements(a.details->'prior_threads') prior
   where a.action='whatsapp_conversations_reconciled' and a.details->>'conversation_id'=c.id::text
  union select id::text from public.marketing_conversation_messages$sql$);
 execute def;

 def:=pg_get_functiondef('marketing_private.marketing_meta_revoke_local(text,boolean,text,timestamp with time zone)'::regprocedure);
 execute replace(def,'connection_generation=subject.generation',
  $sql$(connection_generation=subject.generation or (channel='whatsapp' and subject.generation=any(whatsapp_generations)))$sql$);
 def:=pg_get_functiondef('public.marketing_privacy_prepare_meta(text,text,text,timestamp with time zone)'::regprocedure);
 execute replace(def,'c.connection_generation=s.generation',
  $sql$(c.connection_generation=s.generation or (c.channel='whatsapp' and s.generation=any(c.whatsapp_generations)))$sql$);
 def:=pg_get_functiondef('public.marketing_privacy_replay(jsonb)'::regprocedure);
 def:=replace(def,'and connection_generation=(peer->>''generation'')::int',
  $sql$and (connection_generation=(peer->>'generation')::int
   or (channel='whatsapp' and (peer->>'generation')::int=any(whatsapp_generations)))$sql$);
 execute replace(def,'and connection_generation=(grant_item->>''generation'')::int loop',
  $sql$and (connection_generation=(grant_item->>'generation')::int
   or (channel='whatsapp' and (grant_item->>'generation')::int=any(whatsapp_generations))) loop$sql$);
end;
$functions$;

commit;
