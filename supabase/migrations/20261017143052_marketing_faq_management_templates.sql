-- One FAQ model, independent factual/general eligibility and bounded reviewed topic matching.
alter table public.marketing_inbox_faqs add column answer_kind text not null default 'factual' check(answer_kind in ('factual','general')),
 add column template_key text,
 add column match_intent text not null default 'exact' check(match_intent in ('exact','greeting','thanks','brand_identity','menu','operating_hours','locations'));
create function marketing_private.inbox_general_templates() returns jsonb language sql immutable set search_path=public as $$
 select '[{"key": "greeting", "name": "Greeting", "answers": {"EN": "Hello! How can we help you?", "ZH": "您好！有什么可以帮您？", "BM": "Hai! Ada apa yang boleh kami bantu?"}}, {"key": "thanks", "name": "Thanks", "answers": {"EN": "You’re welcome. Thank you for your message!", "ZH": "不客气，谢谢您的留言！", "BM": "Sama-sama. Terima kasih atas mesej anda!"}}, {"key": "handoff", "name": "Human handoff", "answers": {"EN": "Thank you for your message. A team member will help with your question.", "ZH": "谢谢您的留言，我们会由团队成员协助处理您的问题。", "BM": "Terima kasih atas mesej anda. Ahli pasukan akan membantu dengan soalan anda."}}]'::jsonb;
$$;
revoke all on function marketing_private.inbox_general_templates() from public,anon,authenticated;
create function marketing_private.inbox_faq_supported(f public.marketing_inbox_faqs) returns boolean language sql stable set search_path=public as $$
 select case when f.answer_kind='general' then
  cardinality(f.reference_keys)=0 and f.knowledge_revision=0 and exists(select 1 from jsonb_array_elements(marketing_private.inbox_general_templates()) t where t->>'key'=f.template_key and t->'answers'->>f.language=f.answer)
 else exists(select 1 from public.marketing_knowledge k join public.marketing_inbox_knowledge s on s.brand_id=k.brand_id and s.knowledge_revision=k.revision
 where k.brand_id=f.brand_id and k.revision=f.knowledge_revision and cardinality(f.reference_keys) between 1 and 9 and not exists(select 1 from unnest(f.reference_keys) key where not s.profile ? key)) end;
$$;
revoke all on function marketing_private.inbox_faq_supported(public.marketing_inbox_faqs) from public,anon,authenticated;
create function marketing_private.inbox_faq_normalize(value_ text) returns text language sql immutable set search_path=public as $$
 select regexp_replace(lower(normalize(coalesce(value_,''),NFKC)),'[[:space:][:punct:]，。？！、：；“”‘’]','','g');
$$;
revoke all on function marketing_private.inbox_faq_normalize(text) from public,anon,authenticated;
create function marketing_private.inbox_faq_intent(value_ text) returns text language sql immutable set search_path=public as $$
 select case
 when q ~ '^(hi|hello|hey|helo|hai|salam|你好|您好|嗨|哈啰|哈喽)$' then 'greeting'
 when q ~ '^(thanks|thankyou|tq|terimakasih|谢谢|谢谢你|多谢)$' then 'thanks'
 when q ~ '^(whatisyourbrandname|whatsyourbrandname|namajenama|apakahnamajenama|你们叫什么名字|品牌名称|你们的品牌名称)$' then 'brand_identity'
 when q ~ '^(whatareyour(opening|business)hours|whattimedoyouopen|openinghours|bukapukulberapa|jambuka|bukajamberapa|pukulberapabuka|营业时间|几点开门|你们几点开门|几点营业|你们的营业时间)$' then 'operating_hours'
 when q ~ '^(menu|menup(ls|lease)|gotmenu|cansendmenu(ah)?|caniseethe?menu|canihaveyourmenu|canyou(send|share)(me)?(the|your)?menu|boleh(tengok|lihat)menu|bolehkongsimenu|有菜单吗|可以看菜单吗|可以发菜单吗|发菜单|你们的菜单)$' then 'menu'
 when q ~ '^(whereareyoulocated|whereisyour(store|restaurant|shop)|whatisyouraddress|address|lokasi|alamat(kedai)?|kedai(kat|di)mana|地址|你们在哪里|店在哪里|地点)$' then 'locations'
 else null end from (select marketing_private.inbox_faq_normalize(value_) q) x;
$$;
revoke all on function marketing_private.inbox_faq_intent(text) from public,anon,authenticated;
create or replace function marketing_private.inbox_match_faq(p_brand uuid,p_text text) returns uuid language sql stable set search_path=public as $$
 with eligible as (
 select f.id,case when exists(select 1 from unnest(array[f.question]||f.alternative_questions) q where marketing_private.inbox_faq_normalize(q)=marketing_private.inbox_faq_normalize(p_text)) then 2 else 1 end priority
 from public.marketing_inbox_faqs f where f.brand_id=p_brand and marketing_private.inbox_faq_normalize(p_text)<>'' and f.status='approved' and marketing_private.inbox_faq_supported(f)
 and (exists(select 1 from unnest(array[f.question]||f.alternative_questions) q where marketing_private.inbox_faq_normalize(q)=marketing_private.inbox_faq_normalize(p_text)) or f.match_intent=marketing_private.inbox_faq_intent(p_text))
 ),best as(select id from eligible where priority=(select max(priority) from eligible) limit 2)
 select case when count(*)=1 then (array_agg(id))[1] end from best;
$$;

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

  if coalesce(p_payload->>'answer_kind','factual') not in ('factual','general') then raise exception 'Choose a factual answer or a general template.';end if;
  if p_payload->>'answer_kind'='general' and (coalesce(jsonb_array_length(p_payload->'reference_keys'),0)<>0 or not exists(select 1 from jsonb_array_elements(marketing_private.inbox_general_templates()) t where t->>'key'=p_payload->>'template_key' and t->'answers'->>(p_payload->>'language')=p_payload->>'answer')) then raise exception 'General templates must use the supplied fact-free wording without supporting fact claims.';end if;
  -- Draft support is optional and untrusted until exact-revision approval.
  if jsonb_typeof(coalesce(p_payload->'reference_keys','[]'::jsonb)) is distinct from 'array' or jsonb_array_length(coalesce(p_payload->'reference_keys','[]'::jsonb))>9 or exists(select 1 from jsonb_array_elements(coalesce(p_payload->'reference_keys','[]'::jsonb)) x where jsonb_typeof(x)<>'string' or length(btrim(x#>>'{}')) not between 1 and 100) then raise exception 'Provide up to nine supporting fact keys.';end if;
  if p_payload->>'id' is not null then
   select * into f from public.marketing_inbox_faqs where id=(p_payload->>'id')::uuid and brand_id=p_brand for update;
   if f.id is null or f.revision is distinct from p_revision then raise exception 'FAQ changed. Reload before saving.';end if;
   update public.marketing_inbox_faqs set revision=revision+1,question=p_payload->>'question',answer=p_payload->>'answer',language=p_payload->>'language',reference_keys=array(select jsonb_array_elements_text(coalesce(p_payload->'reference_keys','[]'::jsonb))),knowledge_revision=case when p_payload->>'answer_kind'='general' then 0 else coalesce(k.revision,0) end,answer_kind=coalesce(p_payload->>'answer_kind','factual'),template_key=p_payload->>'template_key',match_intent=coalesce(p_payload->>'match_intent','exact'),status='draft',approved_by=null,category=coalesce(nullif(btrim(p_payload->>'category'),''),f.category),alternative_questions=case when p_payload ? 'alternative_questions' then array(select jsonb_array_elements_text(p_payload->'alternative_questions')) else f.alternative_questions end,updated_at=now() where id=f.id returning * into f;
  else
   if (select count(*) from public.marketing_inbox_faqs where brand_id=p_brand)>=100 then raise exception 'Review existing FAQs before adding more.';end if;
   insert into public.marketing_inbox_faqs(brand_id,question,answer,language,reference_keys,knowledge_revision,created_by,category,alternative_questions,answer_kind,template_key,match_intent) values(p_brand,p_payload->>'question',p_payload->>'answer',p_payload->>'language',array(select jsonb_array_elements_text(coalesce(p_payload->'reference_keys','[]'::jsonb))),case when p_payload->>'answer_kind'='general' then 0 else coalesce(k.revision,0) end,actor,coalesce(nullif(btrim(p_payload->>'category'),''),'General'),array(select jsonb_array_elements_text(coalesce(p_payload->'alternative_questions','[]'))),coalesce(p_payload->>'answer_kind','factual'),p_payload->>'template_key',coalesce(p_payload->>'match_intent','exact')) returning * into f;
  end if;result:=to_jsonb(f);
 elsif p_command in ('request_faq_review','approve_faq','reject_faq') then
  select * into f from public.marketing_inbox_faqs where id=(p_payload->>'id')::uuid and brand_id=p_brand for update;
  if f.id is null or f.revision is distinct from p_revision or f.status not in ('draft','review') then raise exception 'FAQ changed. Reload before review.';end if;
  if p_command='request_faq_review' and f.status<>'draft' then raise exception 'FAQ is already awaiting approval.';end if;
  if p_command in ('request_faq_review','approve_faq') then
   if not marketing_private.inbox_faq_supported(f) then raise exception 'Factual FAQs need current approved supporting facts; general templates must retain their fact-free wording.';end if;
  end if;
  if p_command='approve_faq' and cardinality(marketing_private.inbox_risk(f.question||' '||f.answer||' '||array_to_string(f.alternative_questions,' ')))>0 then raise exception 'Sensitive FAQs require human handling.';end if;
  update public.marketing_inbox_faqs set status=case p_command when 'approve_faq' then 'approved' when 'request_faq_review' then 'review' else 'rejected' end,
   revision=revision+case when p_command='request_faq_review' then 1 else 0 end,approved_by=case when p_command='request_faq_review' then null else actor end,updated_at=now() where id=f.id returning to_jsonb(marketing_inbox_faqs) into result;
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
 select * into f from public.marketing_inbox_faqs where id=marketing_private.inbox_match_faq(c.brand_id,p_text);
 return jsonb_build_object('state',case when f.id is null and not exists(select 1 from public.marketing_inbox_knowledge where brand_id=c.brand_id and knowledge_revision=k.revision) then 'knowledge_unapproved' when f.id is null then 'human_required' when c.takeover then 'human_takeover' when c.channel<>'internal' and (c.last_inbound_at is null or c.last_inbound_at+interval '24 hours'<=now()) then 'window_closed' else 'faq_ready' end,'faq',case when f.id is not null then to_jsonb(f)||jsonb_build_object('match_method',case when exists(select 1 from unnest(array[f.question]||f.alternative_questions) q where marketing_private.inbox_faq_normalize(q)=marketing_private.inbox_faq_normalize(p_text)) then 'approved_phrasing' else 'reviewed_topic' end) end,'sending_enabled',false);
end;$function$
;
CREATE OR REPLACE FUNCTION public.marketing_inbox_command(p_request uuid, p_org uuid, p_brand uuid, p_conversation uuid, p_version integer, p_command text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare actor uuid; permission text; c public.marketing_conversations; d public.marketing_reply_drafts; fp text; prior public.marketing_requests; result jsonb; reasons text[]; target uuid; faq public.marketing_inbox_faqs;
begin
 permission:=case when p_command in ('draft','faq_draft','review_reply','cancel_reply') then 'marketing_inbox.reply' when p_command in ('approve_reply','reject_reply') then 'marketing_inbox.approve' else 'marketing_inbox.manage' end;
 actor:=marketing_private.require_access(p_org,p_brand,permission);
 if p_brand is null or p_request is null or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>15000 then raise exception 'Provide bounded brand-scoped intent.';end if;
 fp:=encode(extensions.digest(jsonb_build_object('org',p_org,'brand',p_brand,'conversation',p_conversation,'version',p_version,'command',p_command,'payload',p_payload)::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));select * into prior from public.marketing_requests where request_id=p_request;
 if prior.request_id is not null then if prior.actor_employee_id<>actor or prior.fingerprint<>fp then raise exception 'Request identity changed.';end if;return prior.result;end if;
 if p_command='create' then
  insert into public.marketing_conversations(organization_id,brand_id,channel,title,created_by) values(p_org,p_brand,'internal',trim(p_payload->>'title'),actor) returning * into c;
 else
  select * into c from public.marketing_conversations where id=p_conversation and organization_id=p_org and brand_id=p_brand for update;
  if c.id is null then raise exception 'Conversation unavailable.';end if;
  if c.version is distinct from p_version then raise exception using errcode='40001',message='Conversation changed. Reload before saving.';end if;
  perform 1 from public.brands where id=c.brand_id for share;
  if p_command='update' then
   target:=nullif(p_payload->>'assigned_to','')::uuid;
   if target is not null and not marketing_private.actor_allowed(target,p_org,p_brand,'marketing_inbox.view') then raise exception 'Choose an active brand-authorized team member.';end if;
   if jsonb_typeof(p_payload->'tags') is distinct from 'array' or jsonb_array_length(p_payload->'tags')>10 or exists(select 1 from jsonb_array_elements_text(p_payload->'tags') t where length(trim(t)) not between 1 and 40) then raise exception 'Provide up to ten bounded tags.';end if;
   update public.marketing_conversations set assigned_to=target,status=p_payload->>'status',priority=case when cardinality(escalation_reasons)>0 then 'urgent' else p_payload->>'priority' end,
    tags=array(select distinct trim(t) from jsonb_array_elements_text(p_payload->'tags') t),takeover=case when cardinality(escalation_reasons)>0 then true else coalesce((p_payload->>'takeover')::boolean,true) end,version=version+1,updated_at=now() where id=c.id returning * into c;
  elsif p_command='note' then
   if length(trim(coalesce(p_payload->>'body',''))) not between 1 and 8000 then raise exception 'Provide a bounded internal note.';end if;
   reasons:=marketing_private.inbox_risk(p_payload->>'body');
   insert into public.marketing_conversation_messages(conversation_id,kind,body,occurred_at,actor_employee_id,delivery_state) values(c.id,'note',p_payload->>'body',now(),actor,'internal');
   update public.marketing_conversations set version=version+1,updated_at=now(),escalation_reasons=array(select distinct unnest(escalation_reasons||reasons)),takeover=takeover or cardinality(reasons)>0,priority=case when cardinality(reasons)>0 then 'urgent' else priority end where id=c.id returning * into c;
  elsif p_command='escalate' then
   if coalesce(p_payload->>'reason','') not in ('complaint','refund','allergen','food_safety','uncertain') then raise exception 'Choose an escalation reason.';end if;
   update public.marketing_conversations set escalation_reasons=array(select distinct unnest(escalation_reasons||array[p_payload->>'reason'])),priority='urgent',takeover=true,status='open',version=version+1,updated_at=now() where id=c.id returning * into c;
  elsif p_command='clear_escalation' then
   if length(trim(coalesce(p_payload->>'reason',''))) not between 1 and 1000 then raise exception 'Record human resolution evidence.';end if;
   insert into public.marketing_conversation_messages(conversation_id,kind,body,occurred_at,actor_employee_id,delivery_state) values(c.id,'note','Escalation resolved: '||(p_payload->>'reason'),now(),actor,'internal');
   update public.marketing_conversations set escalation_reasons='{}',takeover=true,version=version+1,updated_at=now() where id=c.id returning * into c;
  elsif p_command='faq_draft' then
   select f.* into faq from public.marketing_inbox_faqs f where f.id=(p_payload->>'faq_id')::uuid and f.brand_id=c.brand_id and f.status='approved' and marketing_private.inbox_faq_supported(f);
   if faq.id is null then raise exception 'Approved FAQ unavailable.';end if;
   insert into public.marketing_reply_drafts(conversation_id,body,source_version,knowledge_revision,provenance,source_references,created_by) values(c.id,faq.answer,c.version,case when faq.answer_kind='factual' then faq.knowledge_revision end,'approved_faq',to_jsonb(faq.reference_keys),actor) returning * into d;
  elsif p_command='draft' then
   insert into public.marketing_reply_drafts(conversation_id,body,source_version,provenance,created_by) values(c.id,trim(p_payload->>'body'),c.version,'human',actor) returning * into d;
  elsif p_command in ('review_reply','approve_reply','reject_reply','cancel_reply') then
   select * into d from public.marketing_reply_drafts where id=(p_payload->>'draft_id')::uuid and conversation_id=c.id for update;
   if d.id is null or d.source_version<>c.version then raise exception 'Reply evidence changed. Prepare a fresh draft.';end if;
   if p_command='review_reply' and d.status='draft' then update public.marketing_reply_drafts set status='review' where id=d.id returning * into d;
   elsif p_command in ('approve_reply','reject_reply') and d.status='review' then
    if d.knowledge_revision is not null and not exists(select 1 from public.marketing_knowledge k join public.marketing_inbox_knowledge s on s.brand_id=k.brand_id and s.knowledge_revision=k.revision where k.brand_id=p_brand and k.revision=d.knowledge_revision) then raise exception 'Approved knowledge changed. Prepare a fresh suggestion.';end if;
    update public.marketing_reply_drafts set status=case p_command when 'approve_reply' then 'approved' else 'rejected' end,reviewed_by=actor,reviewed_at=now() where id=d.id returning * into d;
    if p_command='approve_reply' then insert into public.marketing_reply_outbox(draft_id) values(d.id);end if;
   elsif p_command='cancel_reply' and d.status in ('draft','review') then update public.marketing_reply_drafts set status='cancelled' where id=d.id returning * into d;
   else raise exception 'Reply transition unavailable.';end if;
  else raise exception 'Inbox command unavailable.';end if;
 end if;
 result:=jsonb_build_object('conversation',to_jsonb(c)-'participant_key','draft',case when d.id is not null then to_jsonb(d) else null end,'external_sent',false);
 insert into public.marketing_requests values(p_request,actor,fp,result);
 insert into public.marketing_events(organization_id,brand_id,action,actor_employee_id,details) values(p_org,p_brand,'inbox_'||p_command,actor,jsonb_build_object('conversation_id',c.id,'version',c.version,'draft_id',d.id,'request_id',p_request));
 return result;
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
        insert into public.marketing_reply_drafts(conversation_id,body,source_version,knowledge_revision,provenance,source_references) values(c.id,f.answer,c.version,case when f.answer_kind='factual' then f.knowledge_revision end,'approved_faq',to_jsonb(f.reference_keys));
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

create function public.marketing_faq_settings_read(p_brand uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare r jsonb;o uuid;
begin
 select organization_id into o from public.brands where id=p_brand;
 r:=public.marketing_inbox_read(o,p_brand,p_size=>1);
 return jsonb_build_object('knowledge',r->'knowledge','faqs',r->'faqs','policy',r->'policy','general_templates',marketing_private.inbox_general_templates(),'outlet_scope_supported',false);
end;$$;
revoke all on function public.marketing_faq_settings_read(uuid) from public,anon;
grant execute on function public.marketing_faq_settings_read(uuid) to authenticated;
