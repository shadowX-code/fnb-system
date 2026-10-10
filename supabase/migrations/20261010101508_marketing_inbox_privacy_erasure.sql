-- Verified Meta erasure extends the existing authority; no publishing/messaging gate changes.
-- Conversations are pinned to the grant generation; a later grant never inherits deleted history.
alter table public.marketing_conversations add column connection_generation integer;
update public.marketing_conversations c set connection_generation=x.credential_generation
from public.marketing_connections x where c.connection_id=x.id;
alter table public.marketing_conversations add constraint inbox_generation_required check
 ((channel='internal' and connection_generation is null) or (channel<>'internal' and connection_generation is not null));
create function marketing_private.inbox_generation_guard() returns trigger language plpgsql set search_path=public as $$
declare x public.marketing_connections;
begin
 if new.channel<>'internal' then
  select * into x from public.marketing_connections where id=new.connection_id;
  if x.id is null or x.organization_id<>new.organization_id or x.brand_id<>new.brand_id or x.channel<>new.channel then raise exception 'Conversation connection scope changed.';end if;
  if tg_op='INSERT' then new.connection_generation:=coalesce(new.connection_generation,x.credential_generation);
  elsif new.connection_generation is distinct from old.connection_generation or new.connection_id is distinct from old.connection_id then raise exception 'Conversation grant lineage is immutable.';end if;
 end if;
 return new;
end;$$;
create trigger inbox_generation_guard before insert or update on public.marketing_conversations for each row execute function marketing_private.inbox_generation_guard();
revoke all on function marketing_private.inbox_generation_guard() from public,anon,authenticated;
alter table public.marketing_conversations drop constraint marketing_conversations_connection_id_participant_key_key;
alter table public.marketing_conversations add constraint inbox_identity_generation unique(connection_id,connection_generation,participant_key);
alter table public.marketing_inbox_faqs add column source_conversation_id uuid references public.marketing_conversations(id);
create index inbox_faq_source on public.marketing_inbox_faqs(source_conversation_id);
-- Existing review evidence is the canonical provenance for AI-derived FAQ copies.
update public.marketing_inbox_faqs f set source_conversation_id=a.conversation_id
from public.marketing_events e join public.marketing_inbox_ai_artifacts a on a.id::text=e.details->>'artifact_id'
where e.action='inbox_ai_reviewed' and f.id::text=e.details->>'faq_id';
create function marketing_private.inbox_faq_lineage() returns trigger language plpgsql set search_path=public as $$
begin
 if new.action='inbox_ai_reviewed' and new.details->>'faq_id' is not null then
  update public.marketing_inbox_faqs f set source_conversation_id=a.conversation_id
  from public.marketing_inbox_ai_artifacts a where a.id::text=new.details->>'artifact_id' and f.id::text=new.details->>'faq_id' and f.brand_id=new.brand_id;
 end if;
 return new;
end;$$;
create trigger inbox_faq_privacy_lineage after insert on public.marketing_events for each row execute function marketing_private.inbox_faq_lineage();

create table marketing_private.inbox_erased_peers (
 connection_id uuid not null, generation integer not null, peer_hash text not null check(peer_hash ~ '^[a-f0-9]{64}$'),
 erased_at timestamptz not null, primary key(connection_id,generation,peer_hash)
);
create table marketing_private.privacy_cases (
 case_hash text primary key check(case_hash ~ '^[a-f0-9]{64}$'), verification_hash text not null check(verification_hash ~ '^[a-f0-9]{64}$'),
 method text not null check(method in ('meta_signed_request','operator_identity_review')), created_at timestamptz not null default now(),
 local_completed_at timestamptz, erased_conversations integer not null default 0, held_conversations integer not null default 0,
 backup_state text not null default 'pending' check(backup_state in ('pending','verified_expired','not_applicable')),
 processor_state text not null default 'pending' check(processor_state in ('pending','verified_deleted','verified_expired','not_applicable')),
 completed_at timestamptz, followup_evidence_hash text check(followup_evidence_hash ~ '^[a-f0-9]{64}$')
);
create table marketing_private.privacy_case_receipts (
 confirmation_hash text primary key check(confirmation_hash ~ '^[a-f0-9]{64}$'), case_hash text not null references marketing_private.privacy_cases(case_hash)
);
-- No legal hold is inferred from business usefulness. A privacy operator must record a legal basis,
-- externally retained evidence reference and a finite review date before erasure.
create table marketing_private.inbox_legal_holds (
 conversation_id uuid primary key, legal_basis text not null check(legal_basis in ('statutory_record','court_order','legal_claim')),
 evidence_hash text not null check(evidence_hash ~ '^[a-f0-9]{64}$'), review_at timestamptz not null check(review_at>created_at),
 created_at timestamptz not null default now(), case_hash text references marketing_private.privacy_cases(case_hash), archive jsonb
);
create table marketing_private.privacy_erasure_journal (
 case_hash text not null references marketing_private.privacy_cases(case_hash), conversation_id uuid not null,
 connection_id uuid not null, generation integer not null, erased_at timestamptz not null default now(), primary key(case_hash,conversation_id)
);
-- Anonymous monthly provider-usage totals survive, with no person/conversation/request identifiers.
create table marketing_private.inbox_erased_ai_usage (
 brand_id uuid not null references public.brands(id), month date not null, model text not null,
 calls bigint not null default 0, usage_missing bigint not null default 0, cost_missing bigint not null default 0, input_tokens bigint not null default 0, output_tokens bigint not null default 0, cost numeric,
 primary key(brand_id,month,model)
);

create function marketing_private.inbox_erase_conversation(p_conversation uuid,p_case text) returns void
language plpgsql security definer set search_path=public as $$
declare c public.marketing_conversations; ids text[]; held boolean; snapshot jsonb;
begin
 select * into c from public.marketing_conversations where id=p_conversation for update;
 if c.id is null then return;end if;
 if c.channel='internal' or not exists(select 1 from marketing_private.privacy_cases where case_hash=p_case) then raise exception 'Verified external privacy case required.';end if;
 select array_agg(id) into ids from (
  select c.id::text id union select id::text from public.marketing_conversation_messages where conversation_id=c.id
  union select id::text from public.marketing_reply_drafts where conversation_id=c.id
  union select id::text from public.marketing_inbox_ai_artifacts where conversation_id=c.id
  union select id::text from public.marketing_inbox_faqs where source_conversation_id=c.id
  union select request_id::text from marketing_private.inbox_ai_runs where conversation_id=c.id
  union select execution_request::text from public.marketing_reply_outbox where draft_id in(select id from public.marketing_reply_drafts where conversation_id=c.id)
 ) v where id is not null;
 select exists(select 1 from marketing_private.inbox_legal_holds where conversation_id=c.id) into held;
 if held then
  select jsonb_build_object('conversation',to_jsonb(c),'messages',coalesce((select jsonb_agg(m) from public.marketing_conversation_messages m where conversation_id=c.id),'[]'),
   'replies',coalesce((select jsonb_agg(d) from public.marketing_reply_drafts d where conversation_id=c.id),'[]'),
   'receipts',coalesce((select jsonb_agg(o) from public.marketing_reply_outbox o where draft_id in(select id from public.marketing_reply_drafts where conversation_id=c.id)),'[]'),
   'ai',coalesce((select jsonb_agg(a) from public.marketing_inbox_ai_artifacts a where conversation_id=c.id),'[]')) into snapshot;
  update marketing_private.inbox_legal_holds set archive=snapshot,case_hash=p_case where conversation_id=c.id;
 end if;
 insert into marketing_private.inbox_erased_ai_usage(brand_id,month,model,calls,usage_missing,cost_missing,input_tokens,output_tokens,cost)
 select c.brand_id,date_trunc('month',created_at)::date,coalesce(provider_model,'unavailable'),count(*),count(*) filter(where input_tokens is null or output_tokens is null),count(*) filter(where cost is null),coalesce(sum(input_tokens),0),coalesce(sum(output_tokens),0),sum(cost)
 from marketing_private.inbox_ai_runs where conversation_id=c.id group by 2,3
 on conflict(brand_id,month,model) do update set calls=inbox_erased_ai_usage.calls+excluded.calls,usage_missing=inbox_erased_ai_usage.usage_missing+excluded.usage_missing,cost_missing=inbox_erased_ai_usage.cost_missing+excluded.cost_missing,input_tokens=inbox_erased_ai_usage.input_tokens+excluded.input_tokens,
 output_tokens=inbox_erased_ai_usage.output_tokens+excluded.output_tokens,cost=case when inbox_erased_ai_usage.cost is null or excluded.cost is null then null else inbox_erased_ai_usage.cost+excluded.cost end;
 -- Cached canonical command results can contain bodies. Retain a retry tombstone, never the body.
 update public.marketing_requests r set result=jsonb_build_object('state','erased')
 where exists(select 1 from unnest(ids) i where strpos(r.result::text,i)>0)
 or r.request_id::text in(select e.details->>'request_id' from public.marketing_events e where exists(select 1 from unnest(ids) i where strpos(e.details::text,i)>0));
 update public.marketing_events e set details=jsonb_build_object('privacy_erased',true),actor_employee_id=null
 where exists(select 1 from unnest(ids) i where strpos(e.details::text,i)>0);
 -- Remove pending/processed payloads for this participant, retaining only hashed event dedup evidence.
 update marketing_private.inbox_events e set payload='{}',state='blocked',error_code='privacy_erased'
 where e.connection_id=c.connection_id and e.generation=c.connection_generation and
 (case when coalesce(e.payload->>'medium','dm')='comment' then 'comment:'||(e.payload->>'thread_id')||':'||(e.payload->>'peer_id') else e.payload->>'peer_id' end)=c.participant_key;
 insert into marketing_private.inbox_erased_peers values(c.connection_id,c.connection_generation,encode(extensions.digest(c.participant_key,'sha256'),'hex'),now())
 on conflict(connection_id,generation,peer_hash) do update set erased_at=excluded.erased_at;
 insert into marketing_private.privacy_erasure_journal(case_hash,conversation_id,connection_id,generation) values(p_case,c.id,c.connection_id,c.connection_generation) on conflict do nothing;
 delete from public.marketing_inbox_reads where conversation_id=c.id;
 delete from public.marketing_reply_outbox where draft_id in(select id from public.marketing_reply_drafts where conversation_id=c.id);
 delete from public.marketing_reply_drafts where conversation_id=c.id;
 delete from marketing_private.inbox_ai_runs where conversation_id=c.id;
 delete from public.marketing_inbox_faqs where source_conversation_id=c.id;
 delete from public.marketing_inbox_ai_artifacts where conversation_id=c.id;
 delete from public.marketing_conversation_messages where conversation_id=c.id;
 delete from public.marketing_conversations where id=c.id;
 update marketing_private.privacy_cases set erased_conversations=erased_conversations+1,held_conversations=held_conversations+case when held then 1 else 0 end where case_hash=p_case;
end;$$;

-- Operator-only verified customer request: OAuth authorizer IDs are NOT Messenger/Instagram peer IDs.
-- Verification evidence lives in the restricted privacy case system, represented here only by hashes.
create function public.marketing_inbox_privacy_erase_verified(p_org uuid,p_brand uuid,p_conversation uuid,p_case_hash text,p_verification_hash text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare c public.marketing_conversations;
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='Privacy operator service required.';end if;
 if coalesce(p_case_hash,'') !~ '^[a-f0-9]{64}$' or coalesce(p_verification_hash,'') !~ '^[a-f0-9]{64}$' then raise exception 'Verified privacy evidence required.';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_case_hash,0));
 if exists(select 1 from marketing_private.privacy_cases where case_hash=p_case_hash) then
  if not exists(select 1 from marketing_private.privacy_erasure_journal where case_hash=p_case_hash and conversation_id=p_conversation and connection_id in(select id from public.marketing_connections where organization_id=p_org and brand_id=p_brand)) then raise exception 'Privacy request scope changed.';end if;
  return jsonb_build_object('status','local_completed_followup_pending');
 end if;
 select * into c from public.marketing_conversations where id=p_conversation and organization_id=p_org and brand_id=p_brand and channel<>'internal' for update;
 if c.id is null then raise exception 'Verified external conversation scope required.';end if;
 insert into marketing_private.privacy_cases(case_hash,verification_hash,method) values(p_case_hash,p_verification_hash,'operator_identity_review');
 perform marketing_private.inbox_erase_conversation(c.id,p_case_hash);
 update marketing_private.privacy_cases set local_completed_at=now() where case_hash=p_case_hash;
 return jsonb_build_object('status','local_completed_followup_pending');
end;$$;

-- Keep the previous social-publishing revocation authority intact, but no longer expose it as a bypass.
alter function public.marketing_meta_revoke(text,boolean,text,timestamptz) set schema marketing_private;
create function public.marketing_meta_revoke(p_user_id text,p_deletion boolean,p_confirmation_hash text,p_issued_at timestamptz) returns void
language plpgsql security definer set search_path=public as $$
declare subject record; conv record; case_id text;
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='Verified Meta service required.';end if;
 if coalesce(p_user_id,'') !~ '^[0-9]+$' or p_issued_at is null or p_issued_at>now()+interval '5 minutes' or (p_deletion and coalesce(p_confirmation_hash,'') !~ '^[a-f0-9]{64}$') then raise exception 'Invalid Meta removal request.';end if;
 case_id:=coalesce(p_confirmation_hash,encode(extensions.digest(p_user_id||':'||p_issued_at::text,'sha256'),'hex'));
 insert into marketing_private.privacy_cases(case_hash,verification_hash,method) values(case_id,encode(extensions.digest(p_user_id||':'||p_issued_at::text,'sha256'),'hex'),'meta_signed_request') on conflict do nothing;
 for subject in select s.* from marketing_private.meta_subjects s join public.marketing_connections x on x.id=s.connection_id
 where s.meta_user_id=p_user_id and s.connected_at<=p_issued_at+interval '1 second' order by s.connection_id,s.generation for update of x loop
  for conv in select id from public.marketing_conversations where connection_id=subject.connection_id and connection_generation=subject.generation order by id for update loop
   perform marketing_private.inbox_erase_conversation(conv.id,case_id);
  end loop;
  -- Unprocessed payloads may never have had a conversation; erase those too.
  update marketing_private.inbox_events set payload='{}',state='blocked',error_code='privacy_erased' where connection_id=subject.connection_id and generation=subject.generation;
  delete from marketing_private.inbox_authority where connection_id=subject.connection_id and generation=subject.generation;
  delete from marketing_private.inbox_comment_authority where connection_id=subject.connection_id and generation=subject.generation;
 end loop;
 perform marketing_private.marketing_meta_revoke(p_user_id,p_deletion,p_confirmation_hash,p_issued_at);
 update marketing_private.privacy_cases set local_completed_at=now() where case_hash=case_id;
 if p_deletion then insert into marketing_private.privacy_case_receipts values(p_confirmation_hash,case_id) on conflict do nothing;end if;
end;$$;

alter table marketing_private.removal_requests add column case_hash text references marketing_private.privacy_cases(case_hash);
create or replace function public.marketing_meta_removal_once(p_request_hash text,p_user_id text,p_deletion boolean,p_confirmation_hash text,p_issued_at timestamptz) returns void
language plpgsql security definer set search_path=public as $$
declare previous text; case_id text;
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='Verified Meta service required.';end if;
 if coalesce(p_request_hash,'') !~ '^[a-f0-9]{64}$' or (p_deletion and coalesce(p_confirmation_hash,'') !~ '^[a-f0-9]{64}$') then raise exception 'Invalid removal identity.';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request_hash,0));
 select case_hash into previous from marketing_private.removal_requests where request_hash=p_request_hash;
 if found then
  -- Old receipts have unknown Inbox scope; do not manufacture a completed status or repeat erasure.
  if p_deletion and previous is not null then insert into marketing_private.privacy_case_receipts values(p_confirmation_hash,previous) on conflict do nothing;end if;
  return;
 end if;
 perform public.marketing_meta_revoke(p_user_id,p_deletion,p_confirmation_hash,p_issued_at);
 case_id:=coalesce(p_confirmation_hash,encode(extensions.digest(p_user_id||':'||p_issued_at::text,'sha256'),'hex'));
 insert into marketing_private.removal_requests(request_hash,case_hash) values(p_request_hash,case_id);
end;$$;
create or replace function public.marketing_meta_deletion_status(p_hash text) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('status',case when c.held_conversations>0 then 'retained_legal_review' when c.local_completed_at is null then 'processing' when c.backup_state='pending' or c.processor_state='pending' then 'local_completed_followup_pending' else 'completed' end,
 'local_completed_at',c.local_completed_at,'completed_at',case when c.held_conversations=0 and c.backup_state<>'pending' and c.processor_state<>'pending' then c.completed_at else null end)
 from marketing_private.privacy_case_receipts r join marketing_private.privacy_cases c on c.case_hash=r.case_hash where r.confirmation_hash=p_hash;
$$;

-- Follow-up is explicit evidence, never an invented automatic backup/provider expiry.
create function public.marketing_privacy_complete_followup(p_case text,p_backup text,p_processor text,p_evidence text) returns void
language plpgsql security definer set search_path=public as $$
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='Privacy operator service required.';end if;
 if p_backup not in ('pending','verified_expired','not_applicable') or p_processor not in ('pending','verified_deleted','verified_expired','not_applicable') or coalesce(p_evidence,'') !~ '^[a-f0-9]{64}$' then raise exception 'Verified processor and backup evidence required.';end if;
 update marketing_private.privacy_cases set backup_state=p_backup,processor_state=p_processor,followup_evidence_hash=p_evidence,completed_at=case when p_backup<>'pending' and p_processor<>'pending' and held_conversations=0 then now() else null end where case_hash=p_case and local_completed_at is not null;
 if not found then raise exception 'Completed local privacy case required.';end if;
end;$$;

create or replace function public.marketing_inbox_process_events(p_limit integer default 20) returns jsonb language plpgsql security definer set search_path=public as $$
declare ev marketing_private.inbox_events; conn public.marketing_connections; c public.marketing_conversations; item jsonb; risks text[]; inserted uuid; processed integer:=0; blocked integer:=0; failed integer:=0; f public.marketing_inbox_faqs; mode text; peer text; event_medium text;
begin
 if auth.role()<>'service_role' then raise exception 'Service only.';end if;
 if p_limit is null or p_limit not between 1 and 50 then raise exception 'Invalid drain limit.';end if;
 for ev in select * from marketing_private.inbox_events where state in ('pending','retry') and due_at<=now() order by due_at,event_key limit p_limit for update skip locked loop
  begin
   select * into conn from public.marketing_connections where id=ev.connection_id for share;
   item:=ev.payload; event_medium:=coalesce(item->>'medium','dm'); peer:=case when event_medium='comment' then 'comment:'||(item->>'thread_id')||':'||(item->>'peer_id') else item->>'peer_id' end;
   if conn.credential_generation<>ev.generation or not coalesce(case when event_medium='comment' then (marketing_private.inbox_comment_channel(conn.id)->>'receiving_verified')::boolean else (marketing_private.inbox_channel(conn.id)->>'receiving_verified')::boolean end,false) then
    update marketing_private.inbox_events set state='blocked',error_code='messaging_authorization_unverified',attempts=attempts+1 where event_key=ev.event_key;blocked:=blocked+1;continue;
   end if;
   if exists(select 1 from marketing_private.inbox_erased_peers t where t.connection_id=conn.id and t.generation=ev.generation and t.peer_hash=encode(extensions.digest(peer,'sha256'),'hex') and (item->>'occurred_at')::timestamptz<=t.erased_at) then
    update marketing_private.inbox_events set payload='{}',state='blocked',error_code='privacy_erased' where event_key=ev.event_key;blocked:=blocked+1;continue;
   end if;
   perform 1 from public.brands where id=conn.brand_id for share;
   item:=ev.payload;
   -- Echo/receipt-only events cannot manufacture a new customer conversation.
   select * into c from public.marketing_conversations where connection_id=conn.id and connection_generation=ev.generation and participant_key=peer for update;
   if c.id is null and item->>'kind' in ('incoming','attachment') then
    insert into public.marketing_conversations(organization_id,brand_id,channel,connection_id,participant_key,title,medium,connection_generation)
    values(conn.organization_id,conn.brand_id,conn.channel,conn.id,peer,conn.account_name||case event_medium when 'comment' then ' comments' else ' conversation' end,event_medium,ev.generation) on conflict(connection_id,connection_generation,participant_key) do nothing;
    select * into c from public.marketing_conversations where connection_id=conn.id and connection_generation=ev.generation and participant_key=peer for update;
   end if;
   if c.id is not null then
    inserted:=null;
    insert into public.marketing_conversation_messages(conversation_id,kind,body,provider_message_id,occurred_at,delivery_state)
    values(c.id,item->>'kind',coalesce(item->>'body',''),item->>'event_id',(item->>'occurred_at')::timestamptz,case item->>'kind' when 'delivery' then 'delivered' when 'read' then 'read' else 'observed' end) on conflict do nothing returning id into inserted;
    if inserted is not null then
     risks:=marketing_private.inbox_risk(item->>'body');
     update public.marketing_conversations set version=version+1,updated_at=now(),
      last_inbound_at=case when event_medium='dm' and item->>'kind' in ('incoming','attachment') then greatest(last_inbound_at,(item->>'occurred_at')::timestamptz) else last_inbound_at end,
      status=case when item->>'kind' in ('incoming','attachment') then 'open' else status end,
      escalation_reasons=array(select distinct unnest(escalation_reasons||risks)),priority=case when cardinality(risks)>0 then 'urgent' else priority end,takeover=takeover or cardinality(risks)>0 where id=c.id returning * into c;
     if event_medium='dm' and not c.opted_out and item->>'kind' in ('incoming','attachment') and cardinality(c.escalation_reasons)=0 then
      select automation_mode into mode from public.marketing_inbox_policies where brand_id=c.brand_id;
      if coalesce(mode,'suggest')<>'off' and not c.takeover then
       select f0.* into f from public.marketing_inbox_faqs f0 join public.marketing_knowledge k on k.brand_id=f0.brand_id and k.revision=f0.knowledge_revision
       join public.marketing_inbox_knowledge s on s.brand_id=k.brand_id and s.knowledge_revision=k.revision
       where f0.brand_id=c.brand_id and f0.status='approved' and lower(regexp_replace(trim(f0.question),'\s+',' ','g'))=lower(regexp_replace(trim(item->>'body'),'\s+',' ','g')) order by f0.updated_at desc limit 1;
       if f.id is not null and c.last_inbound_at+interval '24 hours'>now() and cardinality(marketing_private.inbox_risk(f.answer))=0 then
        insert into public.marketing_reply_drafts(conversation_id,body,source_version,knowledge_revision,provenance,source_references) values(c.id,f.answer,c.version,f.knowledge_revision,'approved_faq',to_jsonb(f.reference_keys));
       else
        update public.marketing_conversations set takeover=true,escalation_reasons=array['uncertain'],priority='high' where id=c.id;
       end if;
      end if;
     end if;
    end if;
   end if;
   update marketing_private.inbox_events set state='processed',attempts=attempts+1,error_code=null where event_key=ev.event_key;processed:=processed+1;
  exception when others then
   update marketing_private.inbox_events set state=case when attempts>=4 then 'failed' else 'retry' end,attempts=attempts+1,due_at=now()+make_interval(secs=>least(3600,30*power(2,attempts)::integer)),error_code='inbox_processing_failed' where event_key=ev.event_key;failed:=failed+1;
  end;
 end loop;
 return jsonb_build_object('processed',processed,'blocked',blocked,'retry_or_failed',failed);
end;$$;

alter table marketing_private.inbox_erased_peers enable row level security;
revoke all on marketing_private.inbox_erased_peers from public,anon,authenticated;
alter table marketing_private.privacy_cases enable row level security;
revoke all on marketing_private.privacy_cases from public,anon,authenticated;
alter table marketing_private.privacy_case_receipts enable row level security;
revoke all on marketing_private.privacy_case_receipts from public,anon,authenticated;
alter table marketing_private.inbox_legal_holds enable row level security;
revoke all on marketing_private.inbox_legal_holds from public,anon,authenticated;
alter table marketing_private.privacy_erasure_journal enable row level security;
revoke all on marketing_private.privacy_erasure_journal from public,anon,authenticated;
alter table marketing_private.inbox_erased_ai_usage enable row level security;
revoke all on marketing_private.inbox_erased_ai_usage from public,anon,authenticated;
revoke all on function marketing_private.inbox_erase_conversation(uuid,text),marketing_private.inbox_faq_lineage(),marketing_private.marketing_meta_revoke(text,boolean,text,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.marketing_meta_revoke(text,boolean,text,timestamptz),public.marketing_inbox_privacy_erase_verified(uuid,uuid,uuid,text,text),public.marketing_privacy_complete_followup(text,text,text,text) from public,anon,authenticated;
grant execute on function public.marketing_meta_revoke(text,boolean,text,timestamptz),public.marketing_inbox_privacy_erase_verified(uuid,uuid,uuid,text,text),public.marketing_privacy_complete_followup(text,text,text,text) to service_role;

create function public.marketing_privacy_release_hold(p_conversation uuid,p_evidence text) returns void
language plpgsql security definer set search_path=public as $$
declare case_id text;
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='Privacy operator service required.';end if;
 if coalesce(p_evidence,'') !~ '^[a-f0-9]{64}$' then raise exception 'Verified legal-release evidence required.';end if;
 select case_hash into case_id from marketing_private.inbox_legal_holds where conversation_id=p_conversation and archive is not null for update;
 if not found then raise exception 'Retained legal case required.';end if;
 delete from marketing_private.inbox_legal_holds where conversation_id=p_conversation;
 update marketing_private.privacy_cases set held_conversations=held_conversations-1,followup_evidence_hash=p_evidence,
 completed_at=case when held_conversations=1 and backup_state<>'pending' and processor_state<>'pending' then now() else null end where case_hash=case_id;
end;$$;
revoke all on function public.marketing_privacy_release_hold(uuid,text) from public,anon,authenticated;
grant execute on function public.marketing_privacy_release_hold(uuid,text) to service_role;

create or replace function public.marketing_inbox_prepare_send(p_request uuid,p_draft uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare d public.marketing_reply_drafts; c public.marketing_conversations; o public.marketing_reply_outbox; conn public.marketing_connections; a marketing_private.inbox_authority; actor uuid;
begin
 select * into d from public.marketing_reply_drafts where id=p_draft;
 select * into c from public.marketing_conversations where id=d.conversation_id for update;
 actor:=marketing_private.require_access(c.organization_id,c.brand_id,'marketing_inbox.send');
 select * into o from public.marketing_reply_outbox where draft_id=d.id for update;
 if o.execution_request is not null then
  if o.execution_request<>p_request or o.execution_actor<>actor then raise exception 'Execution request changed.';end if;
  return jsonb_build_object('state',o.state,'provider_message_id',o.provider_message_id);
 end if;
 select * into conn from public.marketing_connections where id=c.connection_id;
 select * into a from marketing_private.inbox_authority where connection_id=conn.id;
 if p_request is null or d.status<>'approved' or d.source_version<>c.version or c.channel='internal' or c.medium<>'dm' or c.opted_out or c.status='resolved' or length(d.body)>2000 or
  c.last_inbound_at is null or c.last_inbound_at>now() or c.last_inbound_at<=now()-interval '24 hours' or
  a.generation is distinct from conn.credential_generation or not coalesce(a.send_verified and a.webhook_verified,false) or a.verified_at<=now()-interval '1 hour' or
  c.connection_generation is distinct from conn.credential_generation or conn.status<>'test_authorized' or conn.expires_at<=now() then raise exception 'Messaging authority or approved reply unavailable.';end if;
 if d.knowledge_revision is not null and not exists(select 1 from public.marketing_knowledge where brand_id=c.brand_id and revision=d.knowledge_revision) then raise exception 'Approved knowledge changed.';end if;
 update public.marketing_reply_outbox set execution_request=p_request,execution_actor=actor,connection_generation=conn.credential_generation,source_version=c.version,authorized_at=now(),state='prepared',reason='staff_execution_requested' where draft_id=d.id;
 insert into public.marketing_events(organization_id,brand_id,action,actor_employee_id,details) values(c.organization_id,c.brand_id,'inbox_authorize_send',actor,jsonb_build_object('draft_id',d.id,'request_id',p_request));
 return jsonb_build_object('state','prepared');
end;$$;


create or replace function public.marketing_inbox_send_material(p_draft uuid,p_auth_user uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare d public.marketing_reply_drafts; c public.marketing_conversations; o public.marketing_reply_outbox; conn public.marketing_connections; a marketing_private.inbox_authority; actor uuid; v jsonb;
begin
 if auth.role()<>'service_role' then raise exception 'Service only.';end if;
 select * into d from public.marketing_reply_drafts where id=p_draft;
 select * into c from public.marketing_conversations where id=d.conversation_id;
 select id into actor from public.employees where auth_user_id=p_auth_user;
 if actor is null or not marketing_private.actor_allowed(actor,c.organization_id,c.brand_id,'marketing_inbox.send') then raise exception 'Inbox send scope denied.';end if;
 select * into o from public.marketing_reply_outbox where draft_id=p_draft;
 select * into conn from public.marketing_connections where id=c.connection_id;
 select * into a from marketing_private.inbox_authority where connection_id=conn.id;
 if o.execution_actor is distinct from actor or o.execution_request is null then raise exception 'Staff execution approval unavailable.';end if;
 if o.state in ('prepared','pending','reconciling') and (d.status<>'approved' or d.source_version<>c.version or o.source_version<>c.version or c.opted_out or c.status='resolved' or c.medium<>'dm' or
  c.last_inbound_at is null or c.last_inbound_at<=now()-interval '24 hours' or c.last_inbound_at>now() or conn.credential_generation<>o.connection_generation or
  a.generation is distinct from conn.credential_generation or not coalesce(a.send_verified and a.webhook_verified,false) or a.verified_at<=now()-interval '1 hour' or conn.expires_at<=now() or c.connection_generation is distinct from conn.credential_generation or conn.status<>'test_authorized' or
  (d.knowledge_revision is not null and not exists(select 1 from public.marketing_knowledge where brand_id=c.brand_id and revision=d.knowledge_revision))) then raise exception 'Messaging authority changed.';end if;
 select to_jsonb(conn)||jsonb_build_object('sealed_token',s.sealed_token,'meta_user_id',s.meta_user_id) into v from marketing_private.credentials s where s.connection_id=conn.id;
 return jsonb_build_object('connection',v,'recipient',c.participant_key,'text',d.body,'state',o.state,'receipt',o.provider_message_id,'lease',o.lease,'authority',jsonb_build_object('execution_enabled',true,'send_verified',a.send_verified,'webhook_verified',a.webhook_verified,'exact_authorizer_verified',a.send_verified,'page_tasks',array['MESSAGE'],'granted_scopes',a.granted_scopes,'last_inbound_at',c.last_inbound_at,'page_id',a.page_id,'opted_out',c.opted_out,'medium',c.medium));
end;$$;


create function marketing_private.inbox_erasure_replay_guard() returns trigger language plpgsql security definer set search_path=public as $$
declare peer text;
begin
 peer:=case when coalesce(new.payload->>'medium','dm')='comment' then 'comment:'||(new.payload->>'thread_id')||':'||(new.payload->>'peer_id') else new.payload->>'peer_id' end;
 if peer is not null and exists(select 1 from marketing_private.inbox_erased_peers t where t.connection_id=new.connection_id and t.generation=new.generation and t.peer_hash=encode(extensions.digest(peer,'sha256'),'hex') and (new.payload->>'occurred_at')::timestamptz<=t.erased_at) then
  new.payload:='{}';new.state:='blocked';new.error_code:='privacy_erased';
 end if;
 return new;
end;$$;
create trigger inbox_erasure_replay_guard before insert or update of payload on marketing_private.inbox_events for each row execute function marketing_private.inbox_erasure_replay_guard();
revoke all on function marketing_private.inbox_erasure_replay_guard() from public,anon,authenticated;

create or replace function public.marketing_inbox_read(p_org uuid,p_brand uuid default null,p_status text default '',p_channel text default '',p_search text default '',p_page integer default 1,p_size integer default 20,p_assignee text default '',p_unread boolean default false) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=marketing_private.require_access(p_org,p_brand,'marketing_inbox.view'); rows jsonb; total integer; channels jsonb; members jsonb; policy jsonb; faqs jsonb; knowledge jsonb; usage jsonb;
begin
 if p_page is null or p_size is null or p_page<1 or p_size not between 1 and 100 or p_status is null or p_channel is null or p_search is null or p_assignee is null or p_unread is null or (p_assignee not in ('','me','unassigned') and p_assignee !~ '^[0-9a-fA-F-]{36}$') or length(p_search)>100 or p_status not in ('','open','pending','resolved') or p_channel not in ('','internal','facebook','instagram') then raise exception 'Invalid Inbox filters.';end if;
 select count(*) into total from public.marketing_conversations c where c.organization_id=p_org and (p_brand is null or c.brand_id=p_brand) and marketing_private.brand_allowed(p_org,c.brand_id)
 and (p_status='' or c.status=p_status) and (p_channel='' or c.channel=p_channel) and (p_search='' or position(lower(p_search) in lower(c.title))>0 or exists(select 1 from public.marketing_conversation_messages m where m.conversation_id=c.id and position(lower(p_search) in lower(m.body))>0)) and (p_assignee='' or (p_assignee='me' and c.assigned_to=actor) or (p_assignee='unassigned' and c.assigned_to is null) or c.assigned_to::text=p_assignee) and (not p_unread or marketing_private.inbox_unread(c.id,actor)>0);
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into rows from (
 select c.id,c.organization_id,c.brand_id,b.name brand_name,c.channel,c.title,c.status,c.priority,c.assigned_to,c.tags,c.takeover,c.escalation_reasons,c.version,c.last_inbound_at,c.updated_at,c.medium,c.intent,c.language,c.opted_out,marketing_private.inbox_unread(c.id,actor) unread_count
 from public.marketing_conversations c join public.brands b on b.id=c.brand_id where c.organization_id=p_org and (p_brand is null or c.brand_id=p_brand) and marketing_private.brand_allowed(p_org,c.brand_id)
 and (p_status='' or c.status=p_status) and (p_channel='' or c.channel=p_channel) and (p_search='' or position(lower(p_search) in lower(c.title))>0 or exists(select 1 from public.marketing_conversation_messages m where m.conversation_id=c.id and position(lower(p_search) in lower(m.body))>0)) and (p_assignee='' or (p_assignee='me' and c.assigned_to=actor) or (p_assignee='unassigned' and c.assigned_to is null) or c.assigned_to::text=p_assignee) and (not p_unread or marketing_private.inbox_unread(c.id,actor)>0) order by c.updated_at desc,c.id limit p_size offset (p_page-1)*p_size)x;
 select coalesce(jsonb_agg(marketing_private.inbox_channel(c.id)||jsonb_build_object('comments',marketing_private.inbox_comment_channel(c.id))),'[]') into channels from public.marketing_connections c where c.organization_id=p_org and (p_brand is null or c.brand_id=p_brand) and marketing_private.brand_allowed(p_org,c.brand_id);
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',e.full_name) order by e.full_name),'[]') into members from public.organization_memberships m join public.employees e on e.id=m.employee_id
 where m.organization_id=p_org and e.is_active and exists(select 1 from public.brands b where b.organization_id=p_org and (p_brand is null or b.id=p_brand) and marketing_private.brand_allowed(p_org,b.id) and marketing_private.actor_allowed(e.id,p_org,b.id,'marketing_inbox.view'));
 if p_brand is not null then
  select to_jsonb(p) into policy from public.marketing_inbox_policies p where p.brand_id=p_brand;
  select coalesce(jsonb_agg(to_jsonb(f) order by f.updated_at desc),'[]') into faqs from (select * from public.marketing_inbox_faqs where brand_id=p_brand order by updated_at desc limit 100) f;
  select jsonb_build_object('revision',k.revision,'profile',k.profile,'approved_for_replies',exists(select 1 from public.marketing_inbox_knowledge s where s.brand_id=k.brand_id and s.knowledge_revision=k.revision)) into knowledge from public.marketing_knowledge k where k.brand_id=p_brand;
 end if;
 select jsonb_build_object('requests',coalesce(sum(n),0),'input_tokens',sum(input_tokens),'output_tokens',sum(output_tokens),
 'usage_unavailable_requests',coalesce(sum(usage_missing),0),'cost',sum(cost),'cost_available',coalesce(sum(n),0)>0 and coalesce(sum(cost_missing),0)=0,
 'cost_estimated',true,'cost_currency','USD','cost_pricing_date','2026-10-10','cost_unavailable_requests',coalesce(sum(cost_missing),0)) into usage from (
 select count(*) n,sum(r.input_tokens) input_tokens,sum(r.output_tokens) output_tokens,count(*) filter(where r.input_tokens is null or r.output_tokens is null) usage_missing,sum(r.cost) cost,count(*) filter(where r.cost is null) cost_missing
 from marketing_private.inbox_ai_runs r join public.marketing_conversations c on c.id=r.conversation_id where c.organization_id=p_org and (p_brand is null or c.brand_id=p_brand) and marketing_private.brand_allowed(p_org,c.brand_id)
 union all select u.calls,u.input_tokens,u.output_tokens,u.usage_missing,u.cost,u.cost_missing from marketing_private.inbox_erased_ai_usage u join public.brands b on b.id=u.brand_id
 where b.organization_id=p_org and (p_brand is null or b.id=p_brand) and marketing_private.brand_allowed(p_org,b.id)
 ) totals;
 return jsonb_build_object('ai_usage',usage,'rows',rows,'total',total,'channels',channels,'members',members,'policy',coalesce(policy,'{"revision":0,"automation_mode":"suggest","ai_allowed":false}'),'faqs',coalesce(faqs,'[]'),'knowledge',knowledge,'external_execution_enabled',false);
end;$$;


create function public.marketing_privacy_record_hold(p_org uuid,p_brand uuid,p_conversation uuid,p_basis text,p_evidence text,p_review_at timestamptz) returns void
language plpgsql security definer set search_path=public as $$
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='Privacy operator service required.';end if;
 if p_basis is null or p_basis not in ('statutory_record','court_order','legal_claim') or coalesce(p_evidence,'') !~ '^[a-f0-9]{64}$' or p_review_at is null or p_review_at<=now() then raise exception 'Documented legal basis and review date required.';end if;
 perform 1 from public.marketing_conversations where id=p_conversation and organization_id=p_org and brand_id=p_brand and channel<>'internal' for update;
 if not found then raise exception 'External legal-hold scope required.';end if;
 insert into marketing_private.inbox_legal_holds(conversation_id,legal_basis,evidence_hash,review_at) values(p_conversation,p_basis,p_evidence,p_review_at);
end;$$;
revoke all on function public.marketing_privacy_record_hold(uuid,uuid,uuid,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.marketing_privacy_record_hold(uuid,uuid,uuid,text,text,timestamptz) to service_role;
