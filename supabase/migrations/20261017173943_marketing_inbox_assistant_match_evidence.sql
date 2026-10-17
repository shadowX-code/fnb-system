-- Matched but unavailable FAQ identities are distinct from usable cited facts.
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
 p_body:=p_body||jsonb_build_object('assistant_version','2.2','source_hash',r.evidence_hash,'sources',sources,'matches',(select coalesce(jsonb_agg(jsonb_build_object('id',q->>'id','question',q->>'question','use_issue',q->>'use_issue')),'[]') from jsonb_array_elements(r.evidence->'faqs') q where q->>'id' in (select jsonb_array_elements_text(p_body->'matched_faq_ids'))),'suggest_only',true);
 if octet_length(p_body::text)>32768 then raise exception 'AI source evidence is too large.';end if;
 insert into public.marketing_inbox_ai_artifacts(conversation_id,source_version,knowledge_revision,kind,body,model,input_tokens,output_tokens,created_by) values(c.id,c.version,r.knowledge_revision,r.kind,p_body,p_model,p_input,p_output,r.actor_employee_id) returning * into a;
 update marketing_private.inbox_ai_runs set state='completed',artifact_id=a.id where request_id=p_request;
 insert into public.marketing_events(organization_id,brand_id,action,actor_employee_id,details) values(c.organization_id,c.brand_id,'inbox_ai_proposed',r.actor_employee_id,jsonb_build_object('artifact_id',a.id,'kind',a.kind,'model',p_model,'match_source',p_body->>'match_source','latency_ms',p_body->'latency_ms','input_tokens',p_input,'output_tokens',p_output,'estimated_cost_usd',a.cost,'failure_reason',p_body->>'failure_reason'));
 return jsonb_build_object('state','completed','artifact_id',a.id,'classification',p_body->>'classification');
end;$$;
