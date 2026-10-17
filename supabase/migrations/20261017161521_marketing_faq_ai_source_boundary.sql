CREATE OR REPLACE FUNCTION public.marketing_inbox_ai_claim(p_request uuid, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r marketing_private.inbox_ai_runs; c public.marketing_conversations; facts jsonb; history jsonb;
begin
 if auth.role()<>'service_role' then raise exception 'Service only.';end if;
 select * into r from marketing_private.inbox_ai_runs where request_id=p_request and actor_employee_id=p_actor for update;
 if r.request_id is null or r.state<>'prepared' then return null;end if;
 select * into c from public.marketing_conversations where id=r.conversation_id for share;
 perform 1 from public.brands where id=c.brand_id for share;
 if not marketing_private.actor_allowed(p_actor,c.organization_id,c.brand_id,'marketing_inbox.ai') or c.version<>r.source_version or not exists(select 1 from public.marketing_inbox_policies where brand_id=c.brand_id and ai_allowed) or not exists(select 1 from public.marketing_knowledge where brand_id=c.brand_id and revision=r.knowledge_revision) then update marketing_private.inbox_ai_runs set state='superseded' where request_id=p_request;return null;end if;
 select coalesce(jsonb_object_agg(x.key,x.value),'{}'::jsonb) into facts from public.marketing_inbox_knowledge k cross join lateral jsonb_each(k.profile) x where k.brand_id=c.brand_id and k.knowledge_revision=r.knowledge_revision and x.key in ('positioning','identity','audience','voice','rules','references');
 select coalesce(jsonb_agg(jsonb_build_object('kind',kind,'text',body) order by occurred_at),'[]') into history from (select kind,body,occurred_at from public.marketing_conversation_messages where conversation_id=c.id and kind in ('incoming','echo','note') order by occurred_at desc limit 30) x;
 update marketing_private.inbox_ai_runs set state='claimed',lease=gen_random_uuid() where request_id=p_request returning * into r;
 return jsonb_build_object('lease',r.lease,'kind',r.kind,'facts',facts,'history',history,'escalated',cardinality(c.escalation_reasons)>0);
end;$function$
;
CREATE OR REPLACE FUNCTION public.marketing_inbox_ai_finish(p_request uuid, p_lease uuid, p_body jsonb, p_model text, p_input integer, p_output integer, p_error boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r marketing_private.inbox_ai_runs; c public.marketing_conversations; a public.marketing_inbox_ai_artifacts; facts jsonb;
begin
 if auth.role()<>'service_role' then raise exception 'Service only.';end if;
 select * into r from marketing_private.inbox_ai_runs where request_id=p_request and lease=p_lease for update;
 if r.request_id is null then raise exception 'AI lease unavailable.';end if;
 if r.state<>'claimed' then return jsonb_build_object('state',r.state);end if;
 update marketing_private.inbox_ai_runs set provider_model=nullif(p_model,''),input_tokens=p_input,output_tokens=p_output where request_id=p_request;
 if p_error then update marketing_private.inbox_ai_runs set state='failed' where request_id=p_request;return jsonb_build_object('state','failed');end if;
 select * into c from public.marketing_conversations where id=r.conversation_id for update;
 perform 1 from public.brands where id=c.brand_id for share;
 if c.version<>r.source_version or not marketing_private.actor_allowed(r.actor_employee_id,c.organization_id,c.brand_id,'marketing_inbox.ai') or not exists(select 1 from public.marketing_inbox_policies where brand_id=c.brand_id and ai_allowed) or not exists(select 1 from public.marketing_knowledge where brand_id=c.brand_id and revision=r.knowledge_revision) then update marketing_private.inbox_ai_runs set state='superseded' where request_id=p_request;return jsonb_build_object('state','superseded');end if;
 select coalesce(jsonb_object_agg(x.key,x.value),'{}'::jsonb) into facts from public.marketing_inbox_knowledge k cross join lateral jsonb_each(k.profile) x where k.brand_id=c.brand_id and k.knowledge_revision=r.knowledge_revision and x.key in ('positioning','identity','audience','voice','rules','references');
 if jsonb_typeof(p_body) is distinct from 'object' or octet_length(p_body::text)>12000 or length(trim(coalesce(p_body->>'text',''))) not between 1 and 4000 or jsonb_typeof(p_body->'reference_keys') is distinct from 'array' or exists(select 1 from jsonb_array_elements_text(p_body->'reference_keys') x where not facts ? x) or jsonb_array_length(p_body->'reference_keys')>9 or jsonb_typeof(p_body->'human_required') is distinct from 'boolean' or length(coalesce(p_body->>'question',''))>500 or coalesce(p_body->>'language','') not in ('EN','ZH','BM') or p_input<0 or p_output<0 or length(p_model)>100 then raise exception 'AI evidence invalid.';end if;
 if r.kind in ('reply','faq') and jsonb_array_length(p_body->'reference_keys')=0 and not coalesce((p_body->>'human_required')::boolean,false) then raise exception 'Reply facts require citations.';end if;
 if cardinality(marketing_private.inbox_risk(p_body->>'text'))>0 or coalesce((p_body->>'human_required')::boolean,false) then
  update public.marketing_conversations set takeover=true,priority='urgent',escalation_reasons=array(select distinct unnest(escalation_reasons||array['uncertain'])),version=version+1,updated_at=now() where id=c.id returning * into c;
 end if;
 insert into public.marketing_inbox_ai_artifacts(conversation_id,source_version,knowledge_revision,kind,body,model,input_tokens,output_tokens,created_by) values(c.id,c.version,r.knowledge_revision,r.kind,p_body,p_model,p_input,p_output,r.actor_employee_id) returning * into a;
 update marketing_private.inbox_ai_runs set state='completed',artifact_id=a.id where request_id=p_request;
 insert into public.marketing_events(organization_id,brand_id,action,actor_employee_id,details) values(c.organization_id,c.brand_id,'inbox_ai_proposed',r.actor_employee_id,jsonb_build_object('artifact_id',a.id,'kind',a.kind,'model',p_model,'input_tokens',p_input,'output_tokens',p_output,'cost_available',false));
 return jsonb_build_object('state','completed','artifact_id',a.id);
end;$function$
;
