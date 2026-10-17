-- Draft preparation is independent of factual approval. Existing send/match/AI authorities remain unchanged.
alter table public.marketing_inbox_faqs drop constraint marketing_inbox_faqs_status_check;
alter table public.marketing_inbox_faqs add constraint marketing_inbox_faqs_status_check check(status in ('draft','review','approved','rejected','disabled'));
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

  -- Draft support is optional and untrusted until exact-revision approval.
  if jsonb_typeof(coalesce(p_payload->'reference_keys','[]'::jsonb)) is distinct from 'array' or jsonb_array_length(coalesce(p_payload->'reference_keys','[]'::jsonb))>9 or exists(select 1 from jsonb_array_elements(coalesce(p_payload->'reference_keys','[]'::jsonb)) x where jsonb_typeof(x)<>'string' or length(btrim(x#>>'{}')) not between 1 and 100) then raise exception 'Provide up to nine supporting fact keys.';end if;
  if p_payload->>'id' is not null then
   select * into f from public.marketing_inbox_faqs where id=(p_payload->>'id')::uuid and brand_id=p_brand for update;
   if f.id is null or f.revision is distinct from p_revision then raise exception 'FAQ changed. Reload before saving.';end if;
   update public.marketing_inbox_faqs set revision=revision+1,question=p_payload->>'question',answer=p_payload->>'answer',language=p_payload->>'language',reference_keys=array(select jsonb_array_elements_text(coalesce(p_payload->'reference_keys','[]'::jsonb))),knowledge_revision=coalesce(k.revision,0),status='draft',approved_by=null,category=coalesce(nullif(btrim(p_payload->>'category'),''),f.category),alternative_questions=case when p_payload ? 'alternative_questions' then array(select jsonb_array_elements_text(p_payload->'alternative_questions')) else f.alternative_questions end,updated_at=now() where id=f.id returning * into f;
  else
   if (select count(*) from public.marketing_inbox_faqs where brand_id=p_brand)>=100 then raise exception 'Review existing FAQs before adding more.';end if;
   insert into public.marketing_inbox_faqs(brand_id,question,answer,language,reference_keys,knowledge_revision,created_by,category,alternative_questions) values(p_brand,p_payload->>'question',p_payload->>'answer',p_payload->>'language',array(select jsonb_array_elements_text(coalesce(p_payload->'reference_keys','[]'::jsonb))),coalesce(k.revision,0),actor,coalesce(nullif(btrim(p_payload->>'category'),''),'General'),array(select jsonb_array_elements_text(coalesce(p_payload->'alternative_questions','[]')))) returning * into f;
  end if;result:=to_jsonb(f);
 elsif p_command in ('request_faq_review','approve_faq','reject_faq') then
  select * into f from public.marketing_inbox_faqs where id=(p_payload->>'id')::uuid and brand_id=p_brand for update;
  if f.id is null or f.revision is distinct from p_revision or f.status not in ('draft','review') then raise exception 'FAQ changed. Reload before review.';end if;
  if p_command='request_faq_review' and f.status<>'draft' then raise exception 'FAQ is already awaiting approval.';end if;
  if p_command in ('request_faq_review','approve_faq') then
   if not exists(select 1 from public.marketing_inbox_knowledge where brand_id=p_brand and knowledge_revision=k.revision) then raise exception 'Approve current Brand Knowledge before requesting or granting FAQ approval.';end if;
   if f.knowledge_revision is distinct from k.revision then raise exception 'Edit and save this FAQ against current Brand Knowledge before approval.';end if;
   if cardinality(f.reference_keys) not between 1 and 9 or exists(select 1 from unnest(f.reference_keys) r where not exists(select 1 from public.marketing_inbox_knowledge s where s.brand_id=p_brand and s.knowledge_revision=k.revision and s.profile ? r)) then raise exception 'Select valid approved supporting facts before requesting or granting FAQ approval.';end if;
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
