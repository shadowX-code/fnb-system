-- Disambiguate the existing-draft query from the PL/pgSQL row variable. No policy change.
create or replace function public.marketing_inbox_prepare_staff_reply(p_request uuid,p_conversation uuid,p_version integer,p_body text,p_artifact uuid default null) returns jsonb
language plpgsql security definer set search_path=public as $$
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
 if exists(select 1 from public.marketing_reply_outbox o join public.marketing_reply_drafts existing_draft on existing_draft.id=o.draft_id where existing_draft.conversation_id=c.id and (o.state in ('prepared','pending','reconciling') or (existing_draft.source_version=c.version and existing_draft.body=p_body and o.execution_request is not null))) then raise exception 'A reply is already in progress or recorded. Check its result.';end if;
 if p_artifact is not null then
  select * into artifact from public.marketing_inbox_ai_artifacts where id=p_artifact and conversation_id=c.id and source_version=c.version and kind='reply' and state='proposed';
  if artifact.id is null or coalesce((artifact.body->>'human_required')::boolean,false) or not exists(select 1 from public.marketing_knowledge where brand_id=c.brand_id and revision=artifact.knowledge_revision) then raise exception 'Suggestion changed or needs approval.';end if;
 end if;
 insert into public.marketing_reply_drafts(conversation_id,body,source_version,provenance,status,created_by,reviewed_by,reviewed_at,knowledge_revision,source_references,staff_confirmed)
 values(c.id,p_body,c.version,case when p_artifact is null then 'human' else 'ai_suggestion' end,'approved',actor,actor,now(),artifact.knowledge_revision,case when p_artifact is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('artifact_id',artifact.id,'human_edited',p_body is distinct from artifact.body->>'text')) end,true) returning * into d;
 insert into public.marketing_reply_outbox(draft_id,reason) values(d.id,'staff_confirmed_reply');
 perform public.marketing_inbox_prepare_send(p_request,d.id);
 if p_artifact is not null then update public.marketing_inbox_ai_artifacts set state='approved',reviewed_by=actor where id=artifact.id;end if;
 result:=jsonb_build_object('draft_id',d.id);
 insert into public.marketing_requests values(p_request,actor,fp,result);
 insert into public.marketing_events(organization_id,brand_id,action,actor_employee_id,details) values(c.organization_id,c.brand_id,'inbox_staff_confirm_reply',actor,jsonb_build_object('draft_id',d.id,'request_id',p_request,'source_version',c.version));
 return result;
end;$$;
