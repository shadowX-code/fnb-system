-- Extend the existing request/artifact lifecycle; no new chatbot, sender or ownership state.
alter table marketing_private.inbox_ai_runs add column evidence jsonb, add column evidence_hash text,
 add column latency_ms integer, add column match_source text, add column failure_reason text;

create function marketing_private.inbox_assistant_material(p_conversation uuid) returns jsonb
language plpgsql stable set search_path=public as $$
declare c public.marketing_conversations; facts jsonb; faqs jsonb; history jsonb; latest_question text; matched uuid; all_sources jsonb;
begin
 select * into c from public.marketing_conversations where id=p_conversation;
 -- Private team notes are not customer context. Internal cases may supply synthetic acceptance questions.
 select coalesce(jsonb_agg(jsonb_build_object('kind',kind,'text',left(body,1000)) order by occurred_at,id),'[]') into history
 from(select id,kind,body,occurred_at from public.marketing_conversation_messages where conversation_id=c.id and (kind in ('incoming','echo') or c.channel='internal' and kind='note') order by occurred_at desc,id desc limit 12)x;
 select body into latest_question from public.marketing_conversation_messages where conversation_id=c.id and (kind='incoming' or c.channel='internal' and kind='note') order by occurred_at desc,id desc limit 1;
 select coalesce(jsonb_object_agg(x.key,x.value),'{}') into facts from public.marketing_inbox_knowledge k join public.marketing_knowledge current_k on current_k.brand_id=k.brand_id and current_k.revision=k.knowledge_revision cross join lateral jsonb_each(k.profile) x
 where k.brand_id=c.brand_id and x.key in ('positioning','identity','audience','voice','rules') and x.value->>'provenance'='verified_brand_fact';
 matched:=marketing_private.inbox_match_faq(c.brand_id,coalesce(latest_question,''));
 -- Hash all Active records plus live operational validation. Any change invalidates cached proposals.
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'revision',revision,'issue',marketing_private.inbox_faq_use_issue(f)) order by id),'[]') into all_sources from public.marketing_inbox_faqs f where brand_id=c.brand_id and is_active;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'revision',revision,'question',question,'category',category,'alternatives',alternative_questions,'answer',case when issue is null then answer else null end,'use_issue',issue) order by rank desc,id),'[]') into faqs
 from(select f.*,marketing_private.inbox_faq_use_issue(f) issue,
  case when f.id=matched then 100 else 0 end + case when f.match_intent=marketing_private.inbox_faq_intent(coalesce(latest_question,'')) and f.match_intent<>'unknown' then 20 else 0 end +
  (select count(*)::integer from regexp_split_to_table(lower(coalesce(latest_question,'')),'[^[:alnum:]一-龥]+') term where length(term)>2 and position(term in lower(f.question||' '||array_to_string(f.alternative_questions,' ')))>0) rank
 from public.marketing_inbox_faqs f where f.brand_id=c.brand_id and f.is_active order by rank desc,f.id limit 12)x;
 return jsonb_build_object('facts',facts,'faqs',faqs,'history',history,'deterministic_faq_id',matched,'outlet_known',false,'active_faq_count',jsonb_array_length(all_sources),'latest_truncated',length(coalesce(latest_question,''))>1000,
 'source_hash',encode(extensions.digest(jsonb_build_array(facts,all_sources)::text,'sha256'),'hex'));
end;$$;
revoke all on function marketing_private.inbox_assistant_material(uuid) from public,anon,authenticated,service_role;

create or replace function public.marketing_inbox_ai_prepare(p_request uuid,p_conversation uuid,p_version integer,p_kind text) returns jsonb language plpgsql security definer set search_path=public as $$
declare c public.marketing_conversations; actor uuid; k integer; fp text; r marketing_private.inbox_ai_runs; material jsonb;
begin
 select * into c from public.marketing_conversations where id=p_conversation for share;
 actor:=marketing_private.require_access(c.organization_id,c.brand_id,'marketing_inbox.ai');
 if p_request is null or coalesce(p_kind,'') not in ('reply','summary','faq') or c.version is distinct from p_version then raise exception 'Reload current conversation before requesting AI.';end if;
 if not exists(select 1 from public.marketing_inbox_policies where brand_id=c.brand_id and ai_allowed and automation_mode<>'off') then raise exception 'Brand AI consent is disabled.';end if;
 select coalesce(max(revision),0) into k from public.marketing_knowledge where brand_id=c.brand_id;
 material:=marketing_private.inbox_assistant_material(c.id);
 fp:=encode(extensions.digest(jsonb_build_array(c.id,c.version,k,p_kind,material->>'source_hash')::text,'sha256'),'hex');
 -- Serialize actor/conversation generation; a fresh UUID cannot start overlapping provider work.
 perform pg_advisory_xact_lock(hashtextextended(c.id::text,21));
 update marketing_private.inbox_ai_runs set state='failed',failure_reason='request_expired' where conversation_id=c.id and state in ('prepared','claimed') and created_at<now()-interval '2 minutes';
 select * into r from marketing_private.inbox_ai_runs where request_id=p_request;
 if r.request_id is not null then if r.actor_employee_id<>actor or r.fingerprint<>fp then raise exception 'AI request identity changed.';end if;return jsonb_build_object('state',r.state,'artifact_id',r.artifact_id);end if;
 select * into r from marketing_private.inbox_ai_runs where conversation_id=c.id and state in ('prepared','claimed') order by created_at desc limit 1;
 if r.request_id is not null then return jsonb_build_object('state','generating');end if;
 select r0.* into r from marketing_private.inbox_ai_runs r0 join public.marketing_inbox_ai_artifacts a on a.id=r0.artifact_id where r0.conversation_id=c.id and r0.actor_employee_id=actor and r0.fingerprint=fp and r0.state='completed' and a.state='proposed' order by r0.created_at desc limit 1;
 if r.request_id is not null then return jsonb_build_object('state','completed','artifact_id',r.artifact_id,'cached',true);end if;
 if exists(select 1 from marketing_private.inbox_ai_runs where conversation_id=c.id and state='failed' and created_at>now()-interval '1 minute') then return jsonb_build_object('state','cooldown');end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text,2));
 if (select count(*) from marketing_private.inbox_ai_runs where actor_employee_id=actor and created_at>now()-interval '24 hours')>=20 then raise exception 'Daily AI request limit reached.';end if;
 insert into marketing_private.inbox_ai_runs(request_id,conversation_id,actor_employee_id,fingerprint,source_version,knowledge_revision,kind,evidence,evidence_hash) values(p_request,c.id,actor,fp,c.version,k,p_kind,material-'history',material->>'source_hash');
 return jsonb_build_object('state','prepared');
end;$$;

create or replace function public.marketing_inbox_ai_claim(p_request uuid,p_actor uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare r marketing_private.inbox_ai_runs; c public.marketing_conversations; material jsonb;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service only.';end if;
 select * into r from marketing_private.inbox_ai_runs where request_id=p_request and actor_employee_id=p_actor for update;
 if r.request_id is null or r.state<>'prepared' then return null;end if;
 select * into c from public.marketing_conversations where id=r.conversation_id for share;
 material:=marketing_private.inbox_assistant_material(c.id);
 if not marketing_private.actor_allowed(p_actor,c.organization_id,c.brand_id,'marketing_inbox.ai') or c.version<>r.source_version or material->>'source_hash' is distinct from r.evidence_hash or not exists(select 1 from public.marketing_inbox_policies where brand_id=c.brand_id and ai_allowed and automation_mode<>'off') then update marketing_private.inbox_ai_runs set state='superseded' where request_id=p_request;return null;end if;
 update marketing_private.inbox_ai_runs set state='claimed',lease=gen_random_uuid() where request_id=p_request returning * into r;
 return material||jsonb_build_object('lease',r.lease,'kind',r.kind,'escalated',cardinality(c.escalation_reasons)>0,'staff_owned',c.assigned_to is not null or c.takeover);
end;$$;

create function marketing_private.inbox_assistant_evidence_current(a public.marketing_inbox_ai_artifacts) returns boolean language plpgsql stable set search_path=public as $$
declare material jsonb; c public.marketing_conversations;
begin
 select * into c from public.marketing_conversations where id=a.conversation_id;
 if a.body->>'assistant_version'='2.2' then
  material:=marketing_private.inbox_assistant_material(c.id);
  return coalesce(a.source_version=c.version and a.body->>'source_hash'=material->>'source_hash',false);
 end if;
 return a.source_version=c.version and exists(select 1 from public.marketing_knowledge where brand_id=c.brand_id and revision=a.knowledge_revision);
end;$$;
revoke all on function marketing_private.inbox_assistant_evidence_current(public.marketing_inbox_ai_artifacts) from public,anon,authenticated,service_role;

create or replace function public.marketing_inbox_ai_finish(p_request uuid,p_lease uuid,p_body jsonb,p_model text,p_input integer,p_output integer,p_error boolean default false) returns jsonb language plpgsql security definer set search_path=public as $$
declare r marketing_private.inbox_ai_runs; c public.marketing_conversations; a public.marketing_inbox_ai_artifacts; material jsonb; refs jsonb; ref text; source jsonb; sources jsonb:='[]';
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service only.';end if;
 select * into r from marketing_private.inbox_ai_runs where request_id=p_request and lease=p_lease for update;
 if r.request_id is null then raise exception 'AI lease unavailable.';end if;
 if r.state<>'claimed' then return jsonb_build_object('state',r.state,'artifact_id',r.artifact_id);end if;
 if p_input<0 or p_output<0 or length(p_model)>100 or coalesce(p_body->>'latency_ms','0') !~ '^[0-9]{1,6}$' then raise exception 'Invalid AI usage.';end if;
 update marketing_private.inbox_ai_runs set provider_model=nullif(p_model,''),input_tokens=p_input,output_tokens=p_output,latency_ms=(coalesce(p_body->>'latency_ms','0'))::integer,match_source=case when p_body->>'match_source' in ('deterministic','semantic','fallback') then p_body->>'match_source' else null end,failure_reason=left(p_body->>'failure_reason',80) where request_id=p_request;
 if p_error then update marketing_private.inbox_ai_runs set state='failed' where request_id=p_request;return jsonb_build_object('state','failed');end if;
 select * into c from public.marketing_conversations where id=r.conversation_id for update;
 material:=marketing_private.inbox_assistant_material(c.id);
 if c.version<>r.source_version or material->>'source_hash' is distinct from r.evidence_hash or not marketing_private.actor_allowed(r.actor_employee_id,c.organization_id,c.brand_id,'marketing_inbox.ai') or not exists(select 1 from public.marketing_inbox_policies where brand_id=c.brand_id and ai_allowed and automation_mode<>'off') then update marketing_private.inbox_ai_runs set state='superseded' where request_id=p_request;return jsonb_build_object('state','superseded');end if;
 if jsonb_typeof(p_body) is distinct from 'object' or octet_length(p_body::text)>16000 or length(trim(coalesce(p_body->>'text',''))) not between 1 and (case when r.kind='reply' then 2000 else 4000 end) or jsonb_typeof(p_body->'reference_keys') is distinct from 'array' or jsonb_array_length(p_body->'reference_keys')>12 or jsonb_typeof(p_body->'human_required') is distinct from 'boolean' or coalesce(p_body->>'language','') not in ('EN','ZH','BM') or coalesce(p_body->>'classification','') not in ('suggestion_available','needs_human_attention','insufficient_knowledge') or jsonb_typeof(p_body->'matched_faq_ids') is distinct from 'array' or jsonb_array_length(p_body->'matched_faq_ids')>12 or jsonb_typeof(p_body->'unresolved_questions') is distinct from 'array' or jsonb_array_length(p_body->'unresolved_questions')>8 or jsonb_typeof(p_body->'handoff_reasons') is distinct from 'array' or jsonb_array_length(p_body->'handoff_reasons')>8 then raise exception 'AI evidence invalid.';end if;
 for ref in select jsonb_array_elements_text(p_body->'matched_faq_ids') loop
  if not exists(select 1 from jsonb_array_elements(r.evidence->'faqs') f where f->>'id'=ref) then raise exception 'Unknown FAQ evidence.';end if;
 end loop;
 for ref in select jsonb_array_elements_text(p_body->'reference_keys') loop
  if ref like 'faq:%' then
   select f into source from jsonb_array_elements(r.evidence->'faqs') f where 'faq:'||(f->>'id')||':'||(f->>'revision')=ref and f->>'use_issue' is null;
   if source is null then raise exception 'Unavailable FAQ evidence.';end if;
   sources:=sources||jsonb_build_array(jsonb_build_object('key',ref,'kind','faq','id',source->>'id','revision',source->'revision','label',source->>'question'));
  else
   if not (r.evidence->'facts' ? ref) then raise exception 'Unknown knowledge evidence.';end if;
   sources:=sources||jsonb_build_array(jsonb_build_object('key',ref,'kind','brand_intelligence','label',ref));
  end if;
 end loop;
 if p_body->>'classification'='suggestion_available' and (jsonb_array_length(sources)=0 or (p_body->>'human_required')::boolean) then raise exception 'Supported answer requires sources.';end if;
 -- Handoff is advisory: no automatic assignment, status, closure, takeover or send.
 p_body:=p_body||jsonb_build_object('assistant_version','2.2','source_hash',r.evidence_hash,'sources',sources,'suggest_only',true);
 insert into public.marketing_inbox_ai_artifacts(conversation_id,source_version,knowledge_revision,kind,body,model,input_tokens,output_tokens,created_by) values(c.id,c.version,r.knowledge_revision,r.kind,p_body,p_model,p_input,p_output,r.actor_employee_id) returning * into a;
 update marketing_private.inbox_ai_runs set state='completed',artifact_id=a.id where request_id=p_request;
 insert into public.marketing_events(organization_id,brand_id,action,actor_employee_id,details) values(c.organization_id,c.brand_id,'inbox_ai_proposed',r.actor_employee_id,jsonb_build_object('artifact_id',a.id,'kind',a.kind,'model',p_model,'match_source',p_body->>'match_source','latency_ms',p_body->'latency_ms','input_tokens',p_input,'output_tokens',p_output,'estimated_cost_usd',a.cost,'failure_reason',p_body->>'failure_reason'));
 return jsonb_build_object('state','completed','artifact_id',a.id,'classification',p_body->>'classification');
end;$$;
CREATE OR REPLACE FUNCTION public.marketing_inbox_prepare_staff_reply(p_request uuid, p_conversation uuid, p_version integer, p_body text, p_artifact uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c public.marketing_conversations; actor uuid; fp text; prior public.marketing_requests; d public.marketing_reply_drafts; artifact public.marketing_inbox_ai_artifacts; result jsonb;
begin
 select * into c from public.marketing_conversations where id=p_conversation;
 if c.id is null then raise exception 'Conversation unavailable.';end if;
 actor:=marketing_private.require_access(c.organization_id,c.brand_id,'marketing_inbox.reply');
 perform marketing_private.require_access(c.organization_id,c.brand_id,'marketing_inbox.send');
 if p_request is null or p_version is null or p_body is null or length(trim(p_body)) not between 1 and 2000 then raise exception 'Provide a reply of 1–2000 characters.';end if;
 fp:=encode(extensions.digest(jsonb_build_object('command','staff_reply','conversation',c.id,'version',p_version,'body',p_body,'artifact',p_artifact)::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));select * into prior from public.marketing_requests where request_id=p_request;
 if prior.request_id is not null then
  if prior.actor_employee_id<>actor or prior.fingerprint<>fp then raise exception 'Reply request changed.';end if;
  -- No new draft or send intent on an exact retry. The existing send material rechecks live authority.
  return prior.result;
 end if;
 select * into c from public.marketing_conversations where id=p_conversation for update;
 if c.version<>p_version then raise exception 'Conversation changed. Review the latest messages.';end if;
 if marketing_private.inbox_reply_review_required(c.id) or cardinality(marketing_private.inbox_risk(p_body))>0 then raise exception 'This reply requires review and approval.';end if;
 if exists(select 1 from public.marketing_reply_outbox o join public.marketing_reply_drafts existing_draft on existing_draft.id=o.draft_id where existing_draft.conversation_id=c.id and (o.state in ('prepared','pending','reconciling') or (existing_draft.source_version=c.version and existing_draft.body=p_body and o.execution_request is not null and o.state<>'failed'))) then raise exception 'A reply is already in progress or recorded. Check its result.';end if;
 if p_artifact is not null then
  select * into artifact from public.marketing_inbox_ai_artifacts where id=p_artifact and conversation_id=c.id and source_version=c.version and kind='reply' and state='proposed';
  if artifact.id is null or coalesce((artifact.body->>'human_required')::boolean,false) or not marketing_private.inbox_assistant_evidence_current(artifact) then raise exception 'Suggestion changed or needs approval.';end if;
 end if;
 insert into public.marketing_reply_drafts(conversation_id,body,source_version,provenance,status,created_by,reviewed_by,reviewed_at,knowledge_revision,source_references,staff_confirmed)
 values(c.id,p_body,c.version,case when p_artifact is null then 'human' else 'ai_suggestion' end,'approved',actor,actor,now(),case when artifact.body->>'assistant_version'='2.2' then null else artifact.knowledge_revision end,case when p_artifact is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('artifact_id',artifact.id,'human_edited',p_body is distinct from artifact.body->>'text')) end,true) returning * into d;
 insert into public.marketing_reply_outbox(draft_id,reason) values(d.id,'staff_confirmed_reply');
 perform public.marketing_inbox_prepare_send(p_request,d.id);
 if p_artifact is not null then update public.marketing_inbox_ai_artifacts set state='approved',reviewed_by=actor where id=artifact.id;end if;
 result:=jsonb_build_object('draft_id',d.id);
 insert into public.marketing_requests values(p_request,actor,fp,result);
 insert into public.marketing_events(organization_id,brand_id,action,actor_employee_id,details) values(c.organization_id,c.brand_id,'inbox_staff_confirm_reply',actor,jsonb_build_object('draft_id',d.id,'request_id',p_request,'source_version',c.version));
 return result;
end;$function$
;
CREATE OR REPLACE FUNCTION public.marketing_inbox_review_ai(p_artifact uuid, p_approve boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a public.marketing_inbox_ai_artifacts; c public.marketing_conversations; actor uuid; d public.marketing_reply_drafts; f public.marketing_inbox_faqs;
begin
 -- Match the worker's conversation -> artifact lock order.
 select c0.* into c from public.marketing_conversations c0 join public.marketing_inbox_ai_artifacts a0 on a0.conversation_id=c0.id where a0.id=p_artifact for update of c0;
 perform 1 from public.brands where id=c.brand_id for share;
 actor:=marketing_private.require_access(c.organization_id,c.brand_id,case when p_approve then 'marketing_inbox.approve' else 'marketing_inbox.ai' end);
 select * into a from public.marketing_inbox_ai_artifacts where id=p_artifact for update;
 if p_approve is null then raise exception 'Choose approve or reject.';end if;
 if a.state<>'proposed' then return to_jsonb(a);end if;
 if p_approve and not marketing_private.inbox_assistant_evidence_current(a) then raise exception 'AI proposal evidence changed. Request a fresh suggestion.';end if;
 if p_approve then
  if a.kind='summary' then update public.marketing_conversations set summary=a.body->>'text',summary_version=c.version where id=c.id;
  elsif a.kind='reply' then insert into public.marketing_reply_drafts(conversation_id,body,source_version,knowledge_revision,provenance,source_references,created_by) values(c.id,a.body->>'text',c.version,case when a.body->>'assistant_version'='2.2' then null else a.knowledge_revision end,'ai_suggestion',jsonb_build_array(jsonb_build_object('artifact_id',a.id,'human_required',a.body->'human_required')),actor) returning * into d;
  elsif a.kind='faq' then
   if cardinality(marketing_private.inbox_risk(coalesce(a.body->>'question','')||' '||(a.body->>'text')))>0 or coalesce((a.body->>'human_required')::boolean,true) then raise exception 'Sensitive FAQ needs human handling.';end if;
   if (select count(*) from public.marketing_inbox_faqs where brand_id=c.brand_id)>=100 then raise exception 'FAQ limit reached.';end if;
   insert into public.marketing_inbox_faqs(brand_id,question,answer,language,reference_keys,knowledge_revision,created_by) values(c.brand_id,a.body->>'question',a.body->>'text',a.body->>'language',array(select jsonb_array_elements_text(a.body->'reference_keys')),a.knowledge_revision,actor) returning * into f;
  end if;
 end if;
 update public.marketing_inbox_ai_artifacts set state=case when p_approve then 'approved' else 'rejected' end,reviewed_by=actor where id=a.id returning * into a;
 insert into public.marketing_events(organization_id,brand_id,action,actor_employee_id,details) values(c.organization_id,c.brand_id,'inbox_ai_reviewed',actor,jsonb_build_object('artifact_id',a.id,'state',a.state,'draft_id',d.id,'faq_id',f.id));
 return to_jsonb(a);
end;$function$
;

create function marketing_private.inbox_assistant_draft_current(d public.marketing_reply_drafts) returns boolean language plpgsql stable set search_path=public as $$
declare ref jsonb; a public.marketing_inbox_ai_artifacts;
begin
 for ref in select * from jsonb_array_elements(d.source_references) loop
  if ref->>'artifact_id' is not null then
   select * into a from public.marketing_inbox_ai_artifacts where id=(ref->>'artifact_id')::uuid and conversation_id=d.conversation_id;
   if a.id is null or not marketing_private.inbox_assistant_evidence_current(a) then return false;end if;
  end if;
 end loop;
 return true;
end;$$;
revoke all on function marketing_private.inbox_assistant_draft_current(public.marketing_reply_drafts) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.marketing_inbox_command(p_request uuid, p_org uuid, p_brand uuid, p_conversation uuid, p_version integer, p_command text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare actor uuid; permission text; c public.marketing_conversations; d public.marketing_reply_drafts; fp text; prior public.marketing_requests; result jsonb; reasons text[]; target uuid; faq public.marketing_inbox_faqs; artifact public.marketing_inbox_ai_artifacts;
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
   select f.* into faq from public.marketing_inbox_faqs f where f.id=(p_payload->>'faq_id')::uuid and f.brand_id=c.brand_id and f.is_active and marketing_private.inbox_faq_supported(f);
   if faq.id is null then raise exception 'Active FAQ is unavailable or needs operational confirmation.';end if;
   insert into public.marketing_reply_drafts(conversation_id,body,source_version,knowledge_revision,provenance,source_references,created_by) values(c.id,faq.answer,c.version,null,'approved_faq',jsonb_build_array(jsonb_build_object('faq_id',faq.id,'faq_revision',faq.revision,'source','active_faq')),actor) returning * into d;
  elsif p_command='draft' then
   if nullif(p_payload->>'source_artifact','') is not null then
    select * into artifact from public.marketing_inbox_ai_artifacts where id=(p_payload->>'source_artifact')::uuid and conversation_id=c.id and kind='reply' and state='proposed';
    if artifact.id is null or not marketing_private.inbox_assistant_evidence_current(artifact) then raise exception 'Suggestion changed. Request a fresh suggestion.';end if;
   end if;
   insert into public.marketing_reply_drafts(conversation_id,body,source_version,provenance,source_references,created_by) values(c.id,trim(p_payload->>'body'),c.version,case when artifact.id is null then 'human' else 'ai_suggestion' end,case when artifact.id is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('artifact_id',artifact.id,'human_required',artifact.body->'human_required')) end,actor) returning * into d;
  elsif p_command in ('review_reply','approve_reply','reject_reply','cancel_reply') then
   select * into d from public.marketing_reply_drafts where id=(p_payload->>'draft_id')::uuid and conversation_id=c.id for update;
   if d.id is null or d.source_version<>c.version then raise exception 'Reply evidence changed. Prepare a fresh draft.';end if;
   if p_command='review_reply' and d.status='draft' then update public.marketing_reply_drafts set status='review' where id=d.id returning * into d;
   elsif p_command in ('approve_reply','reject_reply') and d.status='review' then
    if not marketing_private.inbox_assistant_draft_current(d) then raise exception 'Suggestion sources changed.';end if;
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

CREATE OR REPLACE FUNCTION public.marketing_inbox_prepare_send(p_request uuid, p_draft uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
 if not marketing_private.inbox_assistant_draft_current(d) then raise exception 'Suggestion sources changed.';end if;
 if d.knowledge_revision is not null and not exists(select 1 from public.marketing_knowledge where brand_id=c.brand_id and revision=d.knowledge_revision) then raise exception 'Approved knowledge changed.';end if;
 update public.marketing_reply_outbox set execution_request=p_request,execution_actor=actor,connection_generation=conn.credential_generation,source_version=c.version,authorized_at=now(),state='prepared',reason='staff_execution_requested' where draft_id=d.id;
 insert into public.marketing_events(organization_id,brand_id,action,actor_employee_id,details) values(c.organization_id,c.brand_id,'inbox_authorize_send',actor,jsonb_build_object('draft_id',d.id,'request_id',p_request));
 return jsonb_build_object('state','prepared');
end;$function$
;

CREATE OR REPLACE FUNCTION public.marketing_inbox_send_material(p_draft uuid, p_auth_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
 if o.state in ('prepared','pending','reconciling') and (d.status<>'approved' or (d.staff_confirmed and (marketing_private.inbox_reply_review_required(c.id) or cardinality(marketing_private.inbox_risk(d.body))>0)) or d.source_version<>c.version or o.source_version<>c.version or c.opted_out or c.status='resolved' or c.medium<>'dm' or
  c.last_inbound_at is null or c.last_inbound_at<=now()-interval '24 hours' or c.last_inbound_at>now() or conn.credential_generation<>o.connection_generation or
  a.generation is distinct from conn.credential_generation or not coalesce(a.send_verified and a.webhook_verified,false) or a.verified_at<=now()-interval '1 hour' or conn.expires_at<=now() or c.connection_generation is distinct from conn.credential_generation or conn.status<>'test_authorized' or
  not marketing_private.inbox_assistant_draft_current(d) or (d.knowledge_revision is not null and not exists(select 1 from public.marketing_knowledge where brand_id=c.brand_id and revision=d.knowledge_revision))) then raise exception 'Messaging authority changed.';end if;
 select to_jsonb(conn)||jsonb_build_object('sealed_token',s.sealed_token,'meta_user_id',s.meta_user_id,'oauth_accounts_generation_verified',marketing_private.oauth_accounts_generation_verified(conn.id)) into v from marketing_private.credentials s where s.connection_id=conn.id;
 return jsonb_build_object('connection',v,'recipient',c.participant_key,'text',d.body,'state',o.state,'failure_code',case when o.state='failed' then o.reason else null end,'receipt',o.provider_message_id,'lease',o.lease,'authority',jsonb_build_object('execution_enabled',true,'send_verified',a.send_verified,'webhook_verified',a.webhook_verified,'exact_authorizer_verified',a.send_verified,'page_tasks',array['MESSAGE'],'granted_scopes',a.granted_scopes,'last_inbound_at',c.last_inbound_at,'page_id',a.page_id,'opted_out',c.opted_out,'medium',c.medium));
end;$function$
;

revoke all on function public.marketing_inbox_ai_prepare(uuid,uuid,integer,text) from public,anon;
grant execute on function public.marketing_inbox_ai_prepare(uuid,uuid,integer,text) to authenticated;
revoke all on function public.marketing_inbox_ai_claim(uuid,uuid),public.marketing_inbox_ai_finish(uuid,uuid,jsonb,text,integer,integer,boolean) from public,anon,authenticated;
grant execute on function public.marketing_inbox_ai_claim(uuid,uuid),public.marketing_inbox_ai_finish(uuid,uuid,jsonb,text,integer,integer,boolean) to service_role;

-- Deterministic/fallback-without-provider work has proven zero provider tokens; failures with unknown usage remain null.
create or replace function marketing_private.inbox_estimate_ai_cost() returns trigger language plpgsql security definer set search_path=public as $$
declare model_ text:=coalesce(to_jsonb(new)->>'provider_model',to_jsonb(new)->>'model');
begin
 new.cost:=case when model_ in ('deterministic-faq','unavailable') and new.input_tokens=0 and new.output_tokens=0 then 0
 when model_ ~ '^gpt-5-mini(-[0-9]{4}-[0-9]{2}-[0-9]{2})?$' and new.input_tokens>=0 and new.output_tokens>=0 then (new.input_tokens*0.25+new.output_tokens*2.0)/1000000 else null end;
 return new;
end;$$;
