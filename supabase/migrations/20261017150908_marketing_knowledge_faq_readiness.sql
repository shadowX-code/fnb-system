-- Preserve FAQ identities and approvals; new conversational answers need exact-revision human confirmation.
alter table public.marketing_inbox_faqs add column review_confirmation text check(review_confirmation in ('fact_free','supported')),
 add column reviewed_revision integer;
create function marketing_private.inbox_answer_requirement(answer_ text) returns text language plpgsql immutable set search_path=public as $$
declare t text:=lower(normalize(coalesce(answer_,''),NFKC)); remainder text;
begin
 if length(btrim(t))=0 then return 'uncertain';end if;
 if t ~ '(https?://|www\.|[0-9@]|rm[[:space:]]|price|cost|hour|open|clos|menu|address|location|offer|discount|promo|book|reserv|deliver|refund|allerg|halal|free|stock|available|tomorrow|tonight|营业|开门|关门|菜单|价格|地址|优惠|预订|外送|退款|过敏|免费|有货|明天|harga|pukul|buka|tutup|alamat|diskaun|tempah|penghantaran|percuma)' then return 'factual';end if;
 -- Positive bounded conversational vocabulary, never absence-of-keywords as proof of fact freedom.
 remainder:=regexp_replace(t,'[[:punct:][:space:]，。？！、：；“”‘’]+',' ','g');
 remainder:=regexp_replace(remainder,'(您好|你好|嗨|谢谢您|谢谢你|谢谢|不客气|欢迎|您的|你的|留言|消息|联系|我们|团队成员|团队|协助|处理|问题|有什么|可以|帮您|帮助您|帮你|帮助|请问|请|提供|更多|详情|收到|好的|会由|有什么需要|尽管告诉我们|很高兴|为您服务)','','g');
 remainder:=regexp_replace(remainder,'\m(hi|hello|hey|there|dear|thanks|thank|you|your|yours|so|much|very|for|the|a|an|and|or|us|we|our|i|me|my|it|is|are|re|welcome|message|messaging|reaching|reach|out|contacting|contact|getting|in|touch|how|can|could|may|help|assist|assistance|please|let|know|what|would|like|to|do|with|more|details|detail|share|tell|question|questions|team|member|members|will|be|happy|glad|of|about|today|this|that|received|noted|ok|okay|sure|no|problem|worries|tq|hai|helo|salam|terima|kasih|atas|sama|mesej|anda|kami|kita|saya|boleh|bantu|membantu|apa|ada|yang|ingin|sila|kongsi|maklumat|lanjut|soalan|pasukan|ahli|akan|dengan|untuk|telah|diterima|baik|ya|lah|ah)\M','','g');
 if btrim(remainder)='' then return 'conversational';end if;
 return 'uncertain';
end;$$;
revoke all on function marketing_private.inbox_answer_requirement(text) from public,anon,authenticated;
create function marketing_private.inbox_faq_approval_issue(f public.marketing_inbox_faqs) returns text language plpgsql stable set search_path=public as $$
begin
 if f.answer_kind='general' then
  if f.knowledge_revision<>0 or cardinality(f.reference_keys)<>0 or f.source_conversation_id is not null or marketing_private.inbox_answer_requirement(f.answer)<>'conversational' then return 'Review this answer against approved supporting knowledge.';end if;
  return null;
 end if;
 if not exists(select 1 from public.marketing_knowledge k join public.marketing_inbox_knowledge s on s.brand_id=k.brand_id and s.knowledge_revision=k.revision where k.brand_id=f.brand_id and k.revision=f.knowledge_revision) then return 'Open Brand Knowledge, verify the supporting facts and approve the current revision.';end if;
 if cardinality(f.reference_keys) not between 1 and 9 then return 'Edit this FAQ and select its approved supporting knowledge in Advanced Options.';end if;
 if exists(select 1 from unnest(f.reference_keys) key where not exists(select 1 from public.marketing_inbox_knowledge s where s.brand_id=f.brand_id and s.knowledge_revision=f.knowledge_revision and s.profile ? key)) then return 'Replace missing or superseded supporting knowledge before approval.';end if;
 return null;
end;$$;
revoke all on function marketing_private.inbox_faq_approval_issue(public.marketing_inbox_faqs) from public,anon,authenticated;
create or replace function marketing_private.inbox_faq_supported(f public.marketing_inbox_faqs) returns boolean language sql stable set search_path=public as $$
 select marketing_private.inbox_faq_approval_issue(f) is null and (f.answer_kind<>'general' or
 (f.review_confirmation='fact_free' and f.reviewed_revision=f.revision) or
 exists(select 1 from jsonb_array_elements(marketing_private.inbox_general_templates()) t where t->>'key'=f.template_key and t->'answers'->>f.language=f.answer));
$$;
create or replace function public.marketing_save_knowledge(p_brand uuid,p_expected_revision integer,p_profile jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare org uuid; actor uuid; current_revision integer; result jsonb;
begin
 select organization_id into org from public.brands where id=p_brand;
 actor:=marketing_private.require_access(org,p_brand,'marketing_settings.manage');
 perform 1 from public.brands where id=p_brand for update;
 select revision into current_revision from public.marketing_knowledge where brand_id=p_brand;
 if coalesce(current_revision,0) is distinct from p_expected_revision then raise exception using errcode='40001',message='Brand knowledge changed. Reload before saving.'; end if;
 if p_profile is null or jsonb_typeof(p_profile)<>'object' or octet_length(p_profile::text)>65536 or exists(
 select 1 from jsonb_each(p_profile) x where x.key not in ('positioning','audience','voice','identity','menu','products','pricing','rules','references','services','promotions')
 or jsonb_typeof(x.value)<>'object' or coalesce(x.value->>'provenance','') not in ('verified_brand_fact','external_research','ai_suggestion','pending_verification')
 or length(coalesce(x.value->>'text',''))>8000 or (x.value->>'provenance'='external_research' and coalesce(x.value->>'source_url','') !~ '^https://')) then raise exception 'Provide bounded brand knowledge with evidence provenance.'; end if;
 insert into public.marketing_knowledge values(p_brand,1,p_profile,actor,now()) on conflict(brand_id) do update set revision=marketing_knowledge.revision+1,profile=excluded.profile,updated_by=actor,updated_at=now() returning to_jsonb(marketing_knowledge) into result;
 insert into public.marketing_events(organization_id,brand_id,action,actor_employee_id,details) values(org,p_brand,'knowledge_saved',actor,jsonb_build_object('revision',result->'revision','profile',p_profile));
 return result;
end; $$;

CREATE OR REPLACE FUNCTION public.marketing_inbox_configure(p_request uuid, p_brand uuid, p_revision integer, p_command text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare org uuid; actor uuid; fp text; prior public.marketing_requests; k public.marketing_knowledge; snapshot jsonb; f public.marketing_inbox_faqs; policy public.marketing_inbox_policies; result jsonb; kind text; proposed_refs text[]; requirement text;
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

  -- Draft support is optional and untrusted until exact-revision approval.
  if jsonb_typeof(coalesce(p_payload->'reference_keys','[]'::jsonb)) is distinct from 'array' or jsonb_array_length(coalesce(p_payload->'reference_keys','[]'::jsonb))>9 or exists(select 1 from jsonb_array_elements(coalesce(p_payload->'reference_keys','[]'::jsonb)) x where jsonb_typeof(x)<>'string' or length(btrim(x#>>'{}')) not between 1 and 100) then raise exception 'Provide up to nine supporting fact keys.';end if;
  requirement:=marketing_private.inbox_answer_requirement(p_payload->>'answer');
  proposed_refs:=array(select jsonb_array_elements_text(coalesce(p_payload->'reference_keys','[]'::jsonb)));
  if cardinality(proposed_refs)=0 and requirement<>'conversational' then
   select coalesce(array_agg(key),'{}') into proposed_refs from public.marketing_inbox_knowledge s cross join lateral jsonb_each(s.profile) x where s.brand_id=p_brand and s.knowledge_revision=k.revision and length(x.value->>'text')>=6 and position(lower(x.value->>'text') in lower(p_payload->>'answer'))>0;
  end if;
  kind:=case when requirement='conversational' and cardinality(proposed_refs)=0 then 'general' else 'factual' end;
  if p_payload->>'id' is not null then
   select * into f from public.marketing_inbox_faqs where id=(p_payload->>'id')::uuid and brand_id=p_brand for update;
   if f.id is null or f.revision is distinct from p_revision then raise exception 'FAQ changed. Reload before saving.';end if;
   if f.source_conversation_id is not null then kind:='factual';end if;
   update public.marketing_inbox_faqs set revision=revision+1,question=p_payload->>'question',answer=p_payload->>'answer',language=p_payload->>'language',reference_keys=proposed_refs,knowledge_revision=case when kind='general' then 0 else coalesce(k.revision,0) end,answer_kind=kind,template_key=null,review_confirmation=null,reviewed_revision=null,match_intent=coalesce(p_payload->>'match_intent','exact'),status='draft',approved_by=null,category=coalesce(nullif(btrim(p_payload->>'category'),''),f.category),alternative_questions=case when p_payload ? 'alternative_questions' then array(select jsonb_array_elements_text(p_payload->'alternative_questions')) else f.alternative_questions end,updated_at=now() where id=f.id returning * into f;
  else
   if (select count(*) from public.marketing_inbox_faqs where brand_id=p_brand)>=100 then raise exception 'Review existing FAQs before adding more.';end if;
   insert into public.marketing_inbox_faqs(brand_id,question,answer,language,reference_keys,knowledge_revision,created_by,category,alternative_questions,answer_kind,template_key,match_intent) values(p_brand,p_payload->>'question',p_payload->>'answer',p_payload->>'language',proposed_refs,case when kind='general' then 0 else coalesce(k.revision,0) end,actor,coalesce(nullif(btrim(p_payload->>'category'),''),'General'),array(select jsonb_array_elements_text(coalesce(p_payload->'alternative_questions','[]'))),kind,null,coalesce(p_payload->>'match_intent','exact')) returning * into f;
  end if;result:=to_jsonb(f);
 elsif p_command in ('request_faq_review','approve_faq','reject_faq') then
  select * into f from public.marketing_inbox_faqs where id=(p_payload->>'id')::uuid and brand_id=p_brand for update;
  if f.id is null or f.revision is distinct from p_revision or f.status not in ('draft','review') then raise exception 'FAQ changed. Reload before review.';end if;
  if p_command='request_faq_review' and f.status<>'draft' then raise exception 'FAQ is already awaiting approval.';end if;
  if p_command in ('request_faq_review','approve_faq') then
   if marketing_private.inbox_faq_approval_issue(f) is not null then raise exception '%',marketing_private.inbox_faq_approval_issue(f);end if;
  end if;
  if p_command='approve_faq' and f.answer_kind='general' and p_payload->>'review_confirmation' is distinct from 'fact_free' then raise exception 'Confirm that this answer makes no Brand or operational factual claims.';end if;
  if p_command='approve_faq' and f.answer_kind='factual' and marketing_private.inbox_answer_requirement(f.answer)='uncertain' and p_payload->>'review_confirmation' is distinct from 'supported' then raise exception 'Confirm that the answer is supported by the selected verified knowledge.';end if;
  if p_command='approve_faq' and cardinality(marketing_private.inbox_risk(f.question||' '||f.answer||' '||array_to_string(f.alternative_questions,' ')))>0 then raise exception 'Sensitive FAQs require human handling.';end if;
  update public.marketing_inbox_faqs set status=case p_command when 'approve_faq' then 'approved' when 'request_faq_review' then 'review' else 'rejected' end,
   review_confirmation=case when p_command='approve_faq' then p_payload->>'review_confirmation' end,reviewed_revision=case when p_command='approve_faq' then f.revision end,revision=revision+case when p_command='request_faq_review' then 1 else 0 end,approved_by=case when p_command='request_faq_review' then null else actor end,updated_at=now() where id=f.id returning to_jsonb(marketing_inbox_faqs) into result;
 else raise exception 'Configuration command unavailable.';end if;
 insert into public.marketing_requests values(p_request,actor,fp,result);
 insert into public.marketing_events(organization_id,brand_id,action,actor_employee_id,details) values(org,p_brand,'inbox_'||p_command,actor,jsonb_build_object('request_id',p_request,'revision',p_revision));
 return result;
end;$function$
;


-- Read-only operational projection: Restaurant owns these fields; no copies enter editable knowledge.
create function public.marketing_knowledge_workspace(p_brand uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare org uuid; r jsonb; approved integer; mapped jsonb;
begin
 select organization_id into org from public.brands where id=p_brand;
 perform marketing_private.require_access(org,p_brand,'marketing_settings.view');
 r:=public.marketing_read(org,p_brand,'settings');
 select max(knowledge_revision) into approved from public.marketing_inbox_knowledge where brand_id=p_brand;
 select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'address',o.address,'location',o.location,'is_active',o.is_active,'updated_at',o.updated_at) order by o.name),'[]') into mapped from public.brand_outlets bo join public.outlets o on o.id=bo.outlet_id where bo.brand_id=p_brand and bo.organization_id=org;
 return r||jsonb_build_object('knowledge_approval_revision',approved,'canonical_outlets',mapped);
end;$$;
revoke all on function public.marketing_knowledge_workspace(uuid) from public,anon;
grant execute on function public.marketing_knowledge_workspace(uuid) to authenticated;
create or replace function public.marketing_faq_settings_read(p_brand uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare org uuid; r jsonb; faqs jsonb;
begin
 select organization_id into org from public.brands where id=p_brand;
 r:=public.marketing_inbox_read(org,p_brand,p_size=>1);
 select coalesce(jsonb_agg(f||jsonb_build_object('answer_requirement',case when f->>'source_conversation_id' is not null then 'factual' else marketing_private.inbox_answer_requirement(f->>'answer') end,'approval_issue',marketing_private.inbox_faq_approval_issue(jsonb_populate_record(null::public.marketing_inbox_faqs,f)))),'[]') into faqs from jsonb_array_elements(r->'faqs') f;
 return jsonb_build_object('knowledge',r->'knowledge','faqs',faqs,'policy',r->'policy','general_templates',marketing_private.inbox_general_templates(),'outlet_scope_supported',false);
end;$$;
