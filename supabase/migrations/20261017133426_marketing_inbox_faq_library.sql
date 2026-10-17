-- Extend the canonical FAQ authority; no new sending or AI execution path.
alter table public.marketing_inbox_faqs add column category text not null default 'General' check(length(btrim(category)) between 1 and 80), add column alternative_questions text[] not null default '{}';
alter table public.marketing_inbox_faqs drop constraint marketing_inbox_faqs_status_check;
alter table public.marketing_inbox_faqs add constraint marketing_inbox_faqs_status_check check(status in ('draft','approved','rejected','disabled'));

create function marketing_private.inbox_valid_questions(values_ text[]) returns boolean language sql immutable set search_path=public as $$
 select cardinality(values_)<=10 and not exists(select 1 from unnest(values_) x where x is null or length(btrim(x)) not between 1 and 500);
$$;
revoke all on function marketing_private.inbox_valid_questions(text[]) from public,anon,authenticated;
alter table public.marketing_inbox_faqs add constraint marketing_inbox_faq_alternatives check(marketing_private.inbox_valid_questions(alternative_questions));

create function marketing_private.inbox_match_faq(p_brand uuid,p_text text) returns uuid language sql stable set search_path=public as $$
 with matches as (
 select f.id from public.marketing_inbox_faqs f
 join public.marketing_knowledge k on k.brand_id=f.brand_id and k.revision=f.knowledge_revision
 join public.marketing_inbox_knowledge s on s.brand_id=k.brand_id and s.knowledge_revision=k.revision
 where f.brand_id=p_brand and f.status='approved'
 and exists(select 1 from unnest(array[f.question]||f.alternative_questions) q where lower(regexp_replace(btrim(q),'\s+',' ','g'))=lower(regexp_replace(btrim(p_text),'\s+',' ','g')))
 limit 2)
 select case when count(*)=1 then (array_agg(id))[1] end from matches;
$$;
revoke all on function marketing_private.inbox_match_faq(uuid,text) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.marketing_inbox_configure(p_request uuid, p_brand uuid, p_revision integer, p_command text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare org uuid; actor uuid; fp text; prior public.marketing_requests; k public.marketing_knowledge; snapshot jsonb; f public.marketing_inbox_faqs; policy public.marketing_inbox_policies; result jsonb;
begin
 select organization_id into org from public.brands where id=p_brand;
 actor:=marketing_private.require_access(org,p_brand,case when p_command in ('approve_knowledge','approve_faq','reject_faq') then 'marketing_inbox.approve' else 'marketing_inbox.configure' end);
 if p_request is null or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>15000 then raise exception 'Invalid configuration intent.';end if;
 fp:=encode(extensions.digest(jsonb_build_array('inbox_config',p_brand,p_revision,p_command,p_payload)::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));select * into prior from public.marketing_requests where request_id=p_request;
 if prior.request_id is not null then if prior.actor_employee_id<>actor or prior.fingerprint<>fp then raise exception 'Request identity changed.';end if;return prior.result;end if;
 perform 1 from public.brands where id=p_brand for update;
 select * into k from public.marketing_knowledge where brand_id=p_brand for share;
 if p_command='approve_knowledge' then
  if k.revision is distinct from p_revision then raise exception 'Knowledge changed. Reload before approval.';end if;
  select jsonb_object_agg(key,value) into snapshot from jsonb_each(k.profile) where value->>'provenance'='verified_brand_fact' and length(trim(value->>'text'))>0;
  if snapshot is null then raise exception 'Verified brand facts are required.';end if;
  insert into public.marketing_inbox_knowledge(brand_id,knowledge_revision,profile,approved_by) values(p_brand,k.revision,snapshot,actor) on conflict do nothing;
  result:=jsonb_build_object('knowledge_revision',k.revision,'approved',true);
 elsif p_command='policy' then
  select * into policy from public.marketing_inbox_policies where brand_id=p_brand for update;
  if coalesce(policy.revision,0) is distinct from p_revision then raise exception 'Policy changed. Reload before saving.';end if;
  insert into public.marketing_inbox_policies(brand_id,automation_mode,ai_allowed,updated_by,staff_reply_requires_approval) values(p_brand,p_payload->>'automation_mode',(p_payload->>'ai_allowed')::boolean,actor,coalesce((p_payload->>'staff_reply_requires_approval')::boolean,policy.staff_reply_requires_approval,false))
   on conflict(brand_id) do update set revision=marketing_inbox_policies.revision+1,automation_mode=excluded.automation_mode,ai_allowed=excluded.ai_allowed,staff_reply_requires_approval=excluded.staff_reply_requires_approval,updated_by=actor,updated_at=now() returning to_jsonb(marketing_inbox_policies) into result;
 elsif p_command='disable_faq' then
  select * into f from public.marketing_inbox_faqs where id=(p_payload->>'id')::uuid and brand_id=p_brand for update;
  if f.id is null or f.revision is distinct from p_revision then raise exception 'FAQ changed. Reload before disabling.';end if;
  update public.marketing_inbox_faqs set status='disabled',revision=revision+1,approved_by=null,updated_at=now() where id=f.id returning to_jsonb(marketing_inbox_faqs) into result;
 elsif p_command='save_faq' then
  if p_payload ? 'alternative_questions' and (jsonb_typeof(p_payload->'alternative_questions') is distinct from 'array' or exists(select 1 from jsonb_array_elements(p_payload->'alternative_questions') x where jsonb_typeof(x)<>'string')) then raise exception 'Provide up to ten alternative questions.';end if;

  if not exists(select 1 from public.marketing_inbox_knowledge where brand_id=p_brand and knowledge_revision=k.revision) then raise exception 'Approve current Brand Knowledge first.';end if;
  if jsonb_typeof(p_payload->'reference_keys') is distinct from 'array' or jsonb_array_length(p_payload->'reference_keys') not between 1 and 9 or exists(select 1 from jsonb_array_elements_text(p_payload->'reference_keys') r where not exists(select 1 from public.marketing_inbox_knowledge s where s.brand_id=p_brand and s.knowledge_revision=k.revision and s.profile ? r)) then raise exception 'Cite approved facts.';end if;
  if p_payload->>'id' is not null then
   select * into f from public.marketing_inbox_faqs where id=(p_payload->>'id')::uuid and brand_id=p_brand for update;
   if f.id is null or f.revision is distinct from p_revision then raise exception 'FAQ changed. Reload before saving.';end if;
   update public.marketing_inbox_faqs set revision=revision+1,question=p_payload->>'question',answer=p_payload->>'answer',language=p_payload->>'language',reference_keys=array(select jsonb_array_elements_text(p_payload->'reference_keys')),knowledge_revision=k.revision,status='draft',approved_by=null,category=coalesce(nullif(btrim(p_payload->>'category'),''),f.category),alternative_questions=case when p_payload ? 'alternative_questions' then array(select jsonb_array_elements_text(p_payload->'alternative_questions')) else f.alternative_questions end,updated_at=now() where id=f.id returning * into f;
  else
   if (select count(*) from public.marketing_inbox_faqs where brand_id=p_brand)>=100 then raise exception 'Review existing FAQs before adding more.';end if;
   insert into public.marketing_inbox_faqs(brand_id,question,answer,language,reference_keys,knowledge_revision,created_by,category,alternative_questions) values(p_brand,p_payload->>'question',p_payload->>'answer',p_payload->>'language',array(select jsonb_array_elements_text(p_payload->'reference_keys')),k.revision,actor,coalesce(nullif(btrim(p_payload->>'category'),''),'General'),array(select jsonb_array_elements_text(coalesce(p_payload->'alternative_questions','[]')))) returning * into f;
  end if;result:=to_jsonb(f);
 elsif p_command in ('approve_faq','reject_faq') then
  select * into f from public.marketing_inbox_faqs where id=(p_payload->>'id')::uuid and brand_id=p_brand for update;
  if f.id is null or f.revision is distinct from p_revision or f.status<>'draft' or f.knowledge_revision is distinct from k.revision then raise exception 'FAQ or knowledge changed.';end if;
  if p_command='approve_faq' and cardinality(marketing_private.inbox_risk(f.question||' '||f.answer||' '||array_to_string(f.alternative_questions,' ')))>0 then raise exception 'Sensitive FAQs require human handling.';end if;
  update public.marketing_inbox_faqs set status=case p_command when 'approve_faq' then 'approved' else 'rejected' end,approved_by=actor,updated_at=now() where id=f.id returning to_jsonb(marketing_inbox_faqs) into result;
 else raise exception 'Configuration command unavailable.';end if;
 insert into public.marketing_requests values(p_request,actor,fp,result);
 insert into public.marketing_events(organization_id,brand_id,action,actor_employee_id,details) values(org,p_brand,'inbox_'||p_command,actor,jsonb_build_object('request_id',p_request,'revision',p_revision));
 return result;
end;$function$
;
CREATE OR REPLACE FUNCTION public.marketing_inbox_faq_preview(p_conversation uuid, p_text text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c public.marketing_conversations; actor uuid; k public.marketing_knowledge; f public.marketing_inbox_faqs; mode text;
begin
 select * into c from public.marketing_conversations where id=p_conversation;actor:=marketing_private.require_access(c.organization_id,c.brand_id,'marketing_inbox.reply');
 if length(trim(coalesce(p_text,''))) not between 1 and 500 then raise exception 'Provide a bounded FAQ question.';end if;
 if cardinality(marketing_private.inbox_risk(p_text))>0 or cardinality(c.escalation_reasons)>0 then return jsonb_build_object('state','escalate','sending_enabled',false);end if;
 select automation_mode into mode from public.marketing_inbox_policies where brand_id=c.brand_id;
 if coalesce(mode,'suggest')='off' then return jsonb_build_object('state','off','sending_enabled',false);end if;
 select * into k from public.marketing_knowledge where brand_id=c.brand_id;
 if not exists(select 1 from public.marketing_inbox_knowledge where brand_id=c.brand_id and knowledge_revision=k.revision) then return jsonb_build_object('state','knowledge_unapproved','sending_enabled',false);end if;
 select * into f from public.marketing_inbox_faqs where id=marketing_private.inbox_match_faq(c.brand_id,p_text);
 return jsonb_build_object('state',case when f.id is null then 'human_required' when c.takeover then 'human_takeover' when c.channel<>'internal' and (c.last_inbound_at is null or c.last_inbound_at+interval '24 hours'<=now()) then 'window_closed' else 'faq_ready' end,'faq',case when f.id is not null then to_jsonb(f) end,'sending_enabled',false);
end;$function$
;
CREATE OR REPLACE FUNCTION public.marketing_inbox_process_events(p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
   if c.id is null and (item->>'kind' in ('incoming','attachment') or item->>'kind'='echo') then
    insert into public.marketing_conversations(organization_id,brand_id,channel,connection_id,participant_key,title,medium,connection_generation)
    values(conn.organization_id,conn.brand_id,conn.channel,conn.id,peer,conn.account_name||case event_medium when 'comment' then ' comments' else ' conversation' end,event_medium,ev.generation) on conflict(connection_id,connection_generation,participant_key) do nothing;
    select * into c from public.marketing_conversations where connection_id=conn.id and connection_generation=ev.generation and participant_key=peer for update;
   end if;
   if c.id is not null then
    inserted:=null;
    insert into public.marketing_conversation_messages(conversation_id,kind,body,provider_message_id,occurred_at,delivery_state,evidence_source)
    values(c.id,item->>'kind',coalesce(item->>'body',''),item->>'event_id',(item->>'occurred_at')::timestamptz,case item->>'kind' when 'delivery' then 'delivered' when 'read' then 'read' else 'observed' end,ev.evidence_source) on conflict do nothing returning id into inserted;
    if inserted is not null and item->>'kind' not in ('delivery','read') then
     risks:=marketing_private.inbox_risk(item->>'body');
     update public.marketing_conversations set version=version+1,updated_at=now(),
      last_inbound_at=case when event_medium='dm' and item->>'kind' in ('incoming','attachment') then greatest(last_inbound_at,(item->>'occurred_at')::timestamptz) else last_inbound_at end,
      status=case when ev.evidence_source<>'historical_import' and item->>'kind' in ('incoming','attachment') then 'open' else status end,
      escalation_reasons=array(select distinct unnest(escalation_reasons||risks)),priority=case when cardinality(risks)>0 then 'urgent' else priority end,takeover=takeover or cardinality(risks)>0 where id=c.id returning * into c;
     if ev.evidence_source<>'historical_import' and event_medium='dm' and not c.opted_out and item->>'kind' in ('incoming','attachment') and cardinality(c.escalation_reasons)=0 then
      select automation_mode into mode from public.marketing_inbox_policies where brand_id=c.brand_id;
      if coalesce(mode,'suggest')<>'off' and not c.takeover then
       select * into f from public.marketing_inbox_faqs where id=marketing_private.inbox_match_faq(c.brand_id,item->>'body');
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
end;$function$
;
CREATE OR REPLACE FUNCTION public.marketing_inbox_detail(p_conversation uuid, p_page integer DEFAULT 1, p_size integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c public.marketing_conversations; actor uuid; messages jsonb; total integer; drafts jsonb; artifacts jsonb; members jsonb; audit_messages jsonb;
begin
 select * into c from public.marketing_conversations where id=p_conversation;if c.id is null then raise exception 'Conversation unavailable.';end if;
 actor:=marketing_private.require_access(c.organization_id,c.brand_id,'marketing_inbox.view');
 if p_page is null or p_size is null or p_page<1 or p_size not between 1 and 50 then raise exception 'Invalid history page.';end if;
 with timeline as (
 select to_jsonb(m)||jsonb_build_object('actor_name',coalesce(nullif(btrim(e.nickname),''),e.full_name),'send_state',coalesce(o.state,case when m.kind='echo' then marketing_private.provider_outbound_state(c.id,m.provider_message_id,m.occurred_at) end),'message_origin',case when m.kind='echo' and o.state is null then 'meta' when m.kind='echo' then 'feedx' end) val,m.occurred_at,m.id
 from public.marketing_conversation_messages m left join public.employees e on e.id=m.actor_employee_id
 left join lateral (select o.state from public.marketing_reply_outbox o join public.marketing_reply_drafts d on d.id=o.draft_id where d.conversation_id=c.id and m.kind='echo' and o.provider_message_id=m.provider_message_id order by o.sent_at desc limit 1) o on true
 where m.conversation_id=c.id and m.kind in ('incoming','echo','attachment','note')
 union all
 select jsonb_build_object('id',d.id,'kind','echo','body',d.body,'provider_message_id',o.provider_message_id,'occurred_at',o.sent_at,'send_state',o.state),o.sent_at,d.id
 from public.marketing_reply_outbox o join public.marketing_reply_drafts d on d.id=o.draft_id where d.conversation_id=c.id and o.state in ('sent','delivered','read') and o.provider_message_id is not null and o.sent_at is not null
 and not exists(select 1 from public.marketing_conversation_messages m where m.conversation_id=c.id and m.kind='echo' and m.provider_message_id=o.provider_message_id)
 ) select count(*) into total from timeline;
 with timeline as (
 select to_jsonb(m)||jsonb_build_object('actor_name',coalesce(nullif(btrim(e.nickname),''),e.full_name),'send_state',coalesce(o.state,case when m.kind='echo' then marketing_private.provider_outbound_state(c.id,m.provider_message_id,m.occurred_at) end),'message_origin',case when m.kind='echo' and o.state is null then 'meta' when m.kind='echo' then 'feedx' end) val,m.occurred_at,m.id
 from public.marketing_conversation_messages m left join public.employees e on e.id=m.actor_employee_id
 left join lateral (select o.state from public.marketing_reply_outbox o join public.marketing_reply_drafts d on d.id=o.draft_id where d.conversation_id=c.id and m.kind='echo' and o.provider_message_id=m.provider_message_id order by o.sent_at desc limit 1) o on true
 where m.conversation_id=c.id and m.kind in ('incoming','echo','attachment','note')
 union all
 select jsonb_build_object('id',d.id,'kind','echo','body',d.body,'provider_message_id',o.provider_message_id,'occurred_at',o.sent_at,'send_state',o.state),o.sent_at,d.id
 from public.marketing_reply_outbox o join public.marketing_reply_drafts d on d.id=o.draft_id where d.conversation_id=c.id and o.state in ('sent','delivered','read') and o.provider_message_id is not null and o.sent_at is not null
 and not exists(select 1 from public.marketing_conversation_messages m where m.conversation_id=c.id and m.kind='echo' and m.provider_message_id=o.provider_message_id)
 ) select coalesce(jsonb_agg(x.val order by x.occurred_at,x.id),'[]') into messages from (select * from timeline order by occurred_at desc,id desc limit p_size offset (p_page-1)*p_size) x;
 select coalesce(jsonb_agg(to_jsonb(d) order by created_at desc),'[]') into drafts from (select * from public.marketing_reply_drafts where conversation_id=c.id order by created_at desc limit 50) d;
 select coalesce(jsonb_agg(to_jsonb(a) order by created_at desc),'[]') into artifacts from (select * from public.marketing_inbox_ai_artifacts where conversation_id=c.id order by created_at desc limit 50) a;
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',coalesce(nullif(btrim(e.nickname),''),e.full_name)) order by e.full_name),'[]') into members from public.organization_memberships m join public.employees e on e.id=m.employee_id
 where m.organization_id=c.organization_id and marketing_private.actor_allowed(e.id,c.organization_id,c.brand_id,'marketing_inbox.view');
 select coalesce(jsonb_agg(to_jsonb(x) order by x.occurred_at,x.id),'[]') into audit_messages from (select * from public.marketing_conversation_messages where conversation_id=c.id and kind in ('delivery','read') order by occurred_at desc,id desc limit 50) x;
 return jsonb_build_object('knowledge',(select jsonb_build_object('revision',k.revision,'approved_for_replies',s.brand_id is not null) from public.marketing_knowledge k left join public.marketing_inbox_knowledge s on s.brand_id=k.brand_id and s.knowledge_revision=k.revision where k.brand_id=c.brand_id),'policy',coalesce((select to_jsonb(p) from public.marketing_inbox_policies p where p.brand_id=c.brand_id),'{"automation_mode":"suggest","ai_allowed":false}'::jsonb),'reply_requires_approval',marketing_private.inbox_reply_review_required(c.id),'reply_authority',(select jsonb_build_object('verified',coalesce(a.send_verified and a.webhook_verified and a.generation=conn.credential_generation and c.connection_generation=conn.credential_generation and conn.status='test_authorized' and conn.expires_at>now(),false),'recent',coalesce(a.verified_at>now()-interval '1 hour',false)) from public.marketing_connections conn left join marketing_private.inbox_authority a on a.connection_id=conn.id where conn.id=c.connection_id),'timeline_projected',true,'audit_messages',audit_messages,'conversation',(to_jsonb(c)-'participant_key')||jsonb_build_object('customer_profile',marketing_private.inbox_profile(c.id)),'messages',messages,'total',total,'drafts',drafts,'artifacts',artifacts,'members',members,
 'window_expires_at',c.last_inbound_at+interval '24 hours','window_open',c.medium='dm' and not c.opted_out and c.last_inbound_at+interval '24 hours'>now(),'channel_capability',marketing_private.inbox_channel(c.connection_id),'sending_enabled',false,'read_through_sequence',(select coalesce(max(sequence),0) from public.marketing_conversation_messages where conversation_id=c.id),'unread_count',marketing_private.inbox_unread(c.id,actor),'outbox',(select coalesce(jsonb_agg(to_jsonb(o)-'lease'),'[]') from public.marketing_reply_outbox o join public.marketing_reply_drafts d on d.id=o.draft_id where d.conversation_id=c.id));
end;$function$
;
