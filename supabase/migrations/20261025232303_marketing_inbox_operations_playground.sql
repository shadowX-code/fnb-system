-- Operational views reuse current attention/assignment/status authority. Reminders are personal read-state.
alter table public.marketing_inbox_reads add column remind_at timestamptz;

create function marketing_private.inbox_handoff_context(p_conversation uuid) returns jsonb
language sql stable security definer set search_path=public as $$
 select jsonb_build_object('reason',t.reason,'summary',t.summary,'updated_at',t.updated_at) from marketing_conversations c join marketing_private.inbox_automatic_turns t on t.conversation_id=c.id
 where c.id=p_conversation and c.status<>'resolved' and c.takeover and t.summary is not null
 and t.updated_at>coalesce((select max(e.created_at) from marketing_events e where e.organization_id=c.organization_id and e.brand_id=c.brand_id and e.action='inbox_resume_ai' and e.details->>'conversation_id'=c.id::text),'-infinity'::timestamptz)
 order by t.updated_at desc,t.id desc limit 1;
$$;
revoke all on function marketing_private.inbox_handoff_context(uuid) from public,anon,authenticated,service_role;

create function marketing_private.inbox_handoff_needed(p_conversation uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from marketing_conversations c where c.id=p_conversation and c.status<>'resolved' and (
  cardinality(c.escalation_reasons)>0 or marketing_private.inbox_handoff_context(c.id) is not null or exists(select 1 from marketing_inbox_ai_artifacts a where a.conversation_id=c.id and a.source_version=c.version and a.state='proposed' and a.body->>'classification'='needs_human_attention')));
$$;
revoke all on function marketing_private.inbox_handoff_needed(uuid) from public,anon,authenticated,service_role;

drop function public.marketing_inbox_read(uuid,uuid,text,text,text,integer,integer,text,boolean);
CREATE OR REPLACE FUNCTION public.marketing_inbox_read(p_org uuid, p_brand uuid DEFAULT NULL::uuid, p_status text DEFAULT ''::text, p_channel text DEFAULT ''::text, p_search text DEFAULT ''::text, p_page integer DEFAULT 1, p_size integer DEFAULT 20, p_assignee text DEFAULT ''::text, p_unread boolean DEFAULT false, p_view text DEFAULT 'all'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare actor uuid:=marketing_private.require_access(p_org,p_brand,'marketing_inbox.view'); rows jsonb; total integer; channels jsonb; members jsonb; policy jsonb; faqs jsonb; knowledge jsonb; usage jsonb; counts jsonb; view_counts jsonb;
begin
 if p_view is null or p_view not in ('all','needs_reply','mine','ai_handoff') then raise exception 'Invalid Inbox view.';end if;
 if p_page is null or p_size is null or p_page<1 or p_size not between 1 and 100 or p_status is null or p_channel is null or p_search is null or p_assignee is null or p_unread is null or (p_assignee not in ('','me','unassigned') and p_assignee !~ '^[0-9a-fA-F-]{36}$') or length(p_search)>100 or p_status not in ('','open','pending','resolved') or p_channel not in ('','social','internal','facebook','instagram','whatsapp') then raise exception 'Invalid Inbox filters.';end if;
 select jsonb_build_object('all',count(*),'open',count(*) filter(where c.status='open'),'pending',count(*) filter(where c.status='pending'),'resolved',count(*) filter(where c.status='resolved')) into counts from public.marketing_conversations c where c.organization_id=p_org and (p_brand is null or c.brand_id=p_brand) and marketing_private.brand_allowed(p_org,c.brand_id)
 and (p_view='all' or p_view='needs_reply' and marketing_private.inbox_needs_reply(c.id) or p_view='mine' and c.assigned_to=actor or p_view='ai_handoff' and marketing_private.inbox_handoff_needed(c.id))
 and (p_channel='' or (p_channel='social' and c.channel<>'internal') or c.channel=p_channel) and (p_search='' or position(lower(p_search) in lower(c.title))>0 or exists(select 1 from public.marketing_conversation_messages m where m.conversation_id=c.id and m.kind in ('incoming','echo','attachment','note') and position(lower(p_search) in lower(case when c.channel='whatsapp' then coalesce(marketing_private.whatsapp_message_state(m)->>'body',m.body) else m.body end))>0)) and (p_assignee='' or (p_assignee='me' and c.assigned_to=actor) or (p_assignee='unassigned' and c.assigned_to is null) or c.assigned_to::text=p_assignee) and (not p_unread or marketing_private.inbox_unread(c.id,actor)>0);
 select jsonb_build_object('all',count(*),'needs_reply',count(*) filter(where marketing_private.inbox_needs_reply(c.id)),'mine',count(*) filter(where c.assigned_to=actor),'ai_handoff',count(*) filter(where marketing_private.inbox_handoff_needed(c.id))) into view_counts from public.marketing_conversations c where c.organization_id=p_org and (p_brand is null or c.brand_id=p_brand) and marketing_private.brand_allowed(p_org,c.brand_id)
 and (p_status='' or c.status=p_status) and (p_channel='' or (p_channel='social' and c.channel<>'internal') or c.channel=p_channel) and (p_search='' or position(lower(p_search) in lower(c.title))>0 or exists(select 1 from public.marketing_conversation_messages m where m.conversation_id=c.id and m.kind in ('incoming','echo','attachment','note') and position(lower(p_search) in lower(case when c.channel='whatsapp' then coalesce(marketing_private.whatsapp_message_state(m)->>'body',m.body) else m.body end))>0)) and (p_assignee='' or (p_assignee='me' and c.assigned_to=actor) or (p_assignee='unassigned' and c.assigned_to is null) or c.assigned_to::text=p_assignee) and (not p_unread or marketing_private.inbox_unread(c.id,actor)>0);
 select count(*) into total from public.marketing_conversations c where c.organization_id=p_org and (p_brand is null or c.brand_id=p_brand) and marketing_private.brand_allowed(p_org,c.brand_id)
 and (p_view='all' or p_view='needs_reply' and marketing_private.inbox_needs_reply(c.id) or p_view='mine' and c.assigned_to=actor or p_view='ai_handoff' and marketing_private.inbox_handoff_needed(c.id))
 and (p_status='' or c.status=p_status) and (p_channel='' or (p_channel='social' and c.channel<>'internal') or c.channel=p_channel) and (p_search='' or position(lower(p_search) in lower(c.title))>0 or exists(select 1 from public.marketing_conversation_messages m where m.conversation_id=c.id and m.kind in ('incoming','echo','attachment','note') and position(lower(p_search) in lower(case when c.channel='whatsapp' then coalesce(marketing_private.whatsapp_message_state(m)->>'body',m.body) else m.body end))>0)) and (p_assignee='' or (p_assignee='me' and c.assigned_to=actor) or (p_assignee='unassigned' and c.assigned_to is null) or c.assigned_to::text=p_assignee) and (not p_unread or marketing_private.inbox_unread(c.id,actor)>0);
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into rows from (
 select c.id,marketing_private.inbox_handoff_needed(c.id) ai_handoff,(select ai_reply_mode from marketing_inbox_policies where brand_id=c.brand_id) ai_mode,(select state from marketing_private.inbox_automatic_turns where conversation_id=c.id order by created_at desc limit 1) ai_turn_state,(select remind_at from marketing_inbox_reads where conversation_id=c.id and employee_id=actor) remind_at,marketing_private.inbox_profile(c.id) customer_profile,c.organization_id,c.brand_id,b.name brand_name,c.channel,c.title,c.status,c.priority,c.assigned_to,c.tags,c.takeover,c.escalation_reasons,c.version,c.last_inbound_at,c.updated_at,c.pending_since,c.status_changed_at,coalesce(c.last_activity_at,latest.occurred_at,c.created_at) last_activity_at,c.resolution_hold,c.medium,c.intent,c.language,c.opted_out,marketing_private.inbox_needs_reply(c.id) needs_reply,latest.body latest_message,latest.kind latest_message_kind,latest.occurred_at latest_message_at,coalesce(nullif(btrim(e.nickname),''),e.full_name) assignee_name,marketing_private.inbox_unread(c.id,actor) unread_count
 from public.marketing_conversations c join public.brands b on b.id=c.brand_id left join public.employees e on e.id=c.assigned_to left join lateral (select last_message.body,last_message.kind,last_message.occurred_at from (select case when c.channel='whatsapp' then coalesce(marketing_private.whatsapp_message_state(m)->>'body',m.body) else m.body end body,m.kind,m.occurred_at,m.id from public.marketing_conversation_messages m where m.conversation_id=c.id and m.kind in ('incoming','echo','attachment','note') union all select d.body,'echo',o.sent_at,d.id from public.marketing_reply_outbox o join public.marketing_reply_drafts d on d.id=o.draft_id where d.conversation_id=c.id and o.state in ('sent','delivered','read') and o.provider_message_id is not null and o.sent_at is not null and not exists(select 1 from public.marketing_conversation_messages m where m.conversation_id=c.id and m.kind='echo' and m.provider_message_id=o.provider_message_id)) last_message order by last_message.occurred_at desc,last_message.id desc limit 1) latest on true where c.organization_id=p_org and (p_brand is null or c.brand_id=p_brand) and marketing_private.brand_allowed(p_org,c.brand_id)
 and (p_view='all' or p_view='needs_reply' and marketing_private.inbox_needs_reply(c.id) or p_view='mine' and c.assigned_to=actor or p_view='ai_handoff' and marketing_private.inbox_handoff_needed(c.id))
 and (p_status='' or c.status=p_status) and (p_channel='' or (p_channel='social' and c.channel<>'internal') or c.channel=p_channel) and (p_search='' or position(lower(p_search) in lower(c.title))>0 or exists(select 1 from public.marketing_conversation_messages m where m.conversation_id=c.id and m.kind in ('incoming','echo','attachment','note') and position(lower(p_search) in lower(case when c.channel='whatsapp' then coalesce(marketing_private.whatsapp_message_state(m)->>'body',m.body) else m.body end))>0)) and (p_assignee='' or (p_assignee='me' and c.assigned_to=actor) or (p_assignee='unassigned' and c.assigned_to is null) or c.assigned_to::text=p_assignee) and (not p_unread or marketing_private.inbox_unread(c.id,actor)>0) order by coalesce((select remind_at<=now() from marketing_inbox_reads where conversation_id=c.id and employee_id=actor),false) desc,c.updated_at desc,c.id limit p_size offset (p_page-1)*p_size)x;
 select coalesce(jsonb_agg(marketing_private.inbox_channel(c.id)||jsonb_build_object('comments',marketing_private.inbox_comment_channel(c.id))),'[]') into channels from public.marketing_connections c where c.organization_id=p_org and (p_brand is null or c.brand_id=p_brand) and marketing_private.brand_allowed(p_org,c.brand_id);
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',coalesce(nullif(btrim(e.nickname),''),e.full_name)) order by e.full_name),'[]') into members from public.organization_memberships m join public.employees e on e.id=m.employee_id
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
 return jsonb_build_object('needs_reply',(public.marketing_inbox_reply_count(p_org,p_brand)->'needs_reply'),'ai_usage',usage,'status_counts',counts,'view_counts',view_counts,'view',p_view,'rows',rows,'total',total,'channels',channels,'members',members,'policy',coalesce(policy,'{"revision":0,"automation_mode":"suggest","ai_allowed":false}'),'faqs',coalesce(faqs,'[]'),'knowledge',knowledge,'external_execution_enabled',false);
end;$function$;
revoke all on function public.marketing_inbox_read(uuid,uuid,text,text,text,integer,integer,text,boolean,text) from public,anon,authenticated;
grant execute on function public.marketing_inbox_read(uuid,uuid,text,text,text,integer,integer,text,boolean,text) to authenticated;

CREATE OR REPLACE FUNCTION public.marketing_inbox_command(p_request uuid, p_org uuid, p_brand uuid, p_conversation uuid, p_version integer, p_command text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare actor uuid; permission text; c public.marketing_conversations; d public.marketing_reply_drafts; fp text; prior public.marketing_requests; result jsonb; reasons text[]; target uuid; faq public.marketing_inbox_faqs; artifact public.marketing_inbox_ai_artifacts;
begin
 permission:=case when p_command='remind' then 'marketing_inbox.view' when p_command in ('draft','faq_draft','review_reply','cancel_reply') then 'marketing_inbox.reply' when p_command in ('approve_reply','reject_reply') then 'marketing_inbox.approve' else 'marketing_inbox.manage' end;
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
  if p_command in ('draft','faq_draft') and c.status='pending' then
   update marketing_conversations set status='open',version=version+1,updated_at=now() where id=c.id returning * into c;
  end if;
  if p_command='remind' then
   if exists(select 1 from jsonb_object_keys(p_payload) key where key<>'remind_at') or (nullif(p_payload->>'remind_at','')::timestamptz is not null and nullif(p_payload->>'remind_at','')::timestamptz not between now()+interval '5 minutes' and now()+interval '30 days') then raise exception 'Choose a reminder from five minutes to thirty days ahead.';end if;
   insert into marketing_inbox_reads(conversation_id,employee_id,remind_at) values(c.id,actor,nullif(p_payload->>'remind_at','')::timestamptz)
   on conflict(conversation_id,employee_id) do update set remind_at=excluded.remind_at;
  elsif p_command='outlet_context' then
   target:=nullif(p_payload->>'outlet_id','')::uuid;
   if exists(select 1 from jsonb_object_keys(p_payload) k where k<>'outlet_id') or (target is not null and not exists(select 1 from brand_outlets bo join outlets o on o.id=bo.outlet_id and o.is_active where bo.brand_id=p_brand and bo.outlet_id=target)) then raise exception 'Choose an active Outlet linked to this Brand, or clear the context.';end if;
   update marketing_conversations set outlet_id=target,outlet_context_evidence=jsonb_build_object('source','staff_confirmed','state',case when target is null then 'cleared' else 'matched' end),version=version+1,updated_at=now() where id=c.id returning * into c;
  elsif p_command='update' then if c.takeover and p_payload->>'takeover'='false' and exists(select 1 from marketing_inbox_policies where brand_id=c.brand_id and ai_reply_mode<>'suggest_only') then raise exception 'Use Resume AI after checking current eligibility.';end if;
   target:=nullif(p_payload->>'assigned_to','')::uuid;
   if target is not null and not marketing_private.actor_allowed(target,p_org,p_brand,'marketing_inbox.view') then raise exception 'Choose an active brand-authorized team member.';end if;
   if jsonb_typeof(p_payload->'tags') is distinct from 'array' or jsonb_array_length(p_payload->'tags')>10 or exists(select 1 from jsonb_array_elements_text(p_payload->'tags') t where length(trim(t)) not between 1 and 40) then raise exception 'Provide up to ten bounded tags.';end if;
   update public.marketing_conversations set assigned_to=target,status=p_payload->>'status',priority=case when cardinality(escalation_reasons)>0 then 'urgent' else p_payload->>'priority' end,
    resolution_hold=coalesce((p_payload->>'resolution_hold')::boolean,resolution_hold),tags=array(select distinct trim(t) from jsonb_array_elements_text(p_payload->'tags') t),takeover=case when cardinality(escalation_reasons)>0 then true else coalesce((p_payload->>'takeover')::boolean,true) end,version=version+1,updated_at=now() where id=c.id returning * into c;
  elsif p_command='note' then
   if length(trim(coalesce(p_payload->>'body',''))) not between 1 and 8000 then raise exception 'Provide a bounded internal note.';end if;
   reasons:=marketing_private.inbox_risk(p_payload->>'body');
   insert into public.marketing_conversation_messages(conversation_id,kind,body,occurred_at,actor_employee_id,delivery_state) values(c.id,'note',p_payload->>'body',now(),actor,'internal');
   update public.marketing_conversations set status='open',last_activity_at=now(),version=version+1,updated_at=now(),escalation_reasons=array(select distinct unnest(escalation_reasons||reasons)),takeover=takeover or cardinality(reasons)>0,priority=case when cardinality(reasons)>0 then 'urgent' else priority end where id=c.id returning * into c;
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

CREATE OR REPLACE FUNCTION public.marketing_inbox_detail(p_conversation uuid, p_page integer DEFAULT 1, p_size integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c public.marketing_conversations; actor uuid; messages jsonb; total integer; drafts jsonb; artifacts jsonb; members jsonb; audit_messages jsonb; assistant_hash text;
begin
 select * into c from public.marketing_conversations where id=p_conversation;if c.id is null then raise exception 'Conversation unavailable.';end if;
 actor:=marketing_private.require_access(c.organization_id,c.brand_id,'marketing_inbox.view');
 if p_page is null or p_size is null or p_page<1 or p_size not between 1 and 50 then raise exception 'Invalid history page.';end if;
 with timeline as (
 select to_jsonb(m)||jsonb_build_object('actor_name',coalesce(nullif(btrim(e.nickname),''),e.full_name),'send_state',coalesce(o.state,case when m.kind='echo' then marketing_private.provider_outbound_state(c.id,m.provider_message_id,m.occurred_at) end),'message_origin',case when m.kind='echo' and o.state is null then 'meta' when m.kind='echo' then 'feedx' end,'sender_type',case when m.kind='echo' and o.state is null then 'external_unknown' when m.kind='echo' and exists(select 1 from marketing_reply_outbox ob join marketing_reply_drafts dr on dr.id=ob.draft_id where dr.conversation_id=c.id and ob.provider_message_id=m.provider_message_id and ob.automatic_turn_id is not null) then 'feedx_ai' when m.kind='echo' then 'feedx_staff' end)||(case when c.channel='whatsapp' then marketing_private.whatsapp_message_state(m) else '{}'::jsonb end) val,m.occurred_at,m.id
 from public.marketing_conversation_messages m left join public.employees e on e.id=m.actor_employee_id
 left join lateral (select o.state from public.marketing_reply_outbox o join public.marketing_reply_drafts d on d.id=o.draft_id where d.conversation_id=c.id and m.kind='echo' and o.provider_message_id=m.provider_message_id order by o.sent_at desc limit 1) o on true
 where m.conversation_id=c.id and m.kind in ('incoming','echo','attachment','note')
 union all
 select jsonb_build_object('id',d.id,'kind','echo','body',d.body,'provider_message_id',o.provider_message_id,'occurred_at',o.sent_at,'send_state',o.state),o.sent_at,d.id
 from public.marketing_reply_outbox o join public.marketing_reply_drafts d on d.id=o.draft_id where d.conversation_id=c.id and o.state in ('sent','delivered','read') and o.provider_message_id is not null and o.sent_at is not null
 and not exists(select 1 from public.marketing_conversation_messages m where m.conversation_id=c.id and m.kind='echo' and m.provider_message_id=o.provider_message_id)
 ) select count(*) into total from timeline;
 with timeline as (
 select to_jsonb(m)||jsonb_build_object('actor_name',coalesce(nullif(btrim(e.nickname),''),e.full_name),'send_state',coalesce(o.state,case when m.kind='echo' then marketing_private.provider_outbound_state(c.id,m.provider_message_id,m.occurred_at) end),'message_origin',case when m.kind='echo' and o.state is null then 'meta' when m.kind='echo' then 'feedx' end,'sender_type',case when m.kind='echo' and o.state is null then 'external_unknown' when m.kind='echo' and exists(select 1 from marketing_reply_outbox ob join marketing_reply_drafts dr on dr.id=ob.draft_id where dr.conversation_id=c.id and ob.provider_message_id=m.provider_message_id and ob.automatic_turn_id is not null) then 'feedx_ai' when m.kind='echo' then 'feedx_staff' end)||(case when c.channel='whatsapp' then marketing_private.whatsapp_message_state(m) else '{}'::jsonb end) val,m.occurred_at,m.id
 from public.marketing_conversation_messages m left join public.employees e on e.id=m.actor_employee_id
 left join lateral (select o.state from public.marketing_reply_outbox o join public.marketing_reply_drafts d on d.id=o.draft_id where d.conversation_id=c.id and m.kind='echo' and o.provider_message_id=m.provider_message_id order by o.sent_at desc limit 1) o on true
 where m.conversation_id=c.id and m.kind in ('incoming','echo','attachment','note')
 union all
 select jsonb_build_object('id',d.id,'kind','echo','body',d.body,'provider_message_id',o.provider_message_id,'occurred_at',o.sent_at,'send_state',o.state),o.sent_at,d.id
 from public.marketing_reply_outbox o join public.marketing_reply_drafts d on d.id=o.draft_id where d.conversation_id=c.id and o.state in ('sent','delivered','read') and o.provider_message_id is not null and o.sent_at is not null
 and not exists(select 1 from public.marketing_conversation_messages m where m.conversation_id=c.id and m.kind='echo' and m.provider_message_id=o.provider_message_id)
 ) select coalesce(jsonb_agg(x.val order by x.occurred_at,x.id),'[]') into messages from (select * from timeline order by occurred_at desc,id desc limit p_size offset (p_page-1)*p_size) x;
 select coalesce(jsonb_agg(to_jsonb(d) order by created_at desc),'[]') into drafts from (select * from public.marketing_reply_drafts where conversation_id=c.id order by created_at desc limit 50) d;
 if exists(select 1 from public.marketing_inbox_ai_artifacts a where a.conversation_id=c.id and a.state='proposed' and a.body->>'assistant_version'='2.2') and exists(select 1 from public.marketing_inbox_policies where brand_id=c.brand_id and ai_allowed and automation_mode<>'off') then assistant_hash:=marketing_private.inbox_assistant_material(c.id)->>'source_hash';end if;
 select coalesce(jsonb_agg(case when a.state='proposed' and a.body->>'assistant_version'='2.2' and (a.source_version<>c.version or a.body->>'source_hash' is distinct from assistant_hash) then to_jsonb(a)||jsonb_build_object('state','superseded') else to_jsonb(a) end order by created_at desc),'[]') into artifacts from (select * from public.marketing_inbox_ai_artifacts where conversation_id=c.id order by created_at desc limit 50) a;
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',coalesce(nullif(btrim(e.nickname),''),e.full_name)) order by e.full_name),'[]') into members from public.organization_memberships m join public.employees e on e.id=m.employee_id
 where m.organization_id=c.organization_id and marketing_private.actor_allowed(e.id,c.organization_id,c.brand_id,'marketing_inbox.view');
 select coalesce(jsonb_agg(to_jsonb(x) order by x.occurred_at,x.id),'[]') into audit_messages from (select * from public.marketing_conversation_messages where conversation_id=c.id and kind in ('delivery','read') order by occurred_at desc,id desc limit 50) x;
 return jsonb_build_object('remind_at',(select remind_at from marketing_inbox_reads where conversation_id=c.id and employee_id=actor),'needs_human_attention',marketing_private.inbox_handoff_needed(c.id),'ai_handling',jsonb_build_object('handoff',marketing_private.inbox_handoff_context(c.id),'mode',coalesce((select ai_reply_mode from marketing_inbox_policies where brand_id=c.brand_id),'suggest_only'),'last_turn',(select jsonb_build_object('state',state,'reason',reason,'summary',summary,'updated_at',updated_at) from marketing_private.inbox_automatic_turns where conversation_id=c.id order by created_at desc limit 1)),'outlet_context',marketing_private.inbox_outlet_context(c.id),'ai_feedback',coalesce((select jsonb_agg(to_jsonb(f)-'actor_employee_id') from marketing_inbox_ai_feedback f join marketing_inbox_ai_artifacts a on a.id=f.artifact_id where a.conversation_id=c.id and f.actor_employee_id=actor),'[]'::jsonb),'outlet_options',(select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'name',o.name) order by o.name),'[]') from brand_outlets bo join outlets o on o.id=bo.outlet_id and o.is_active where bo.brand_id=c.brand_id),'knowledge',(select jsonb_build_object('revision',k.revision,'approved_for_replies',s.brand_id is not null) from public.marketing_knowledge k left join public.marketing_inbox_knowledge s on s.brand_id=k.brand_id and s.knowledge_revision=k.revision where k.brand_id=c.brand_id),'policy',coalesce((select to_jsonb(p) from public.marketing_inbox_policies p where p.brand_id=c.brand_id),'{"automation_mode":"suggest","ai_allowed":false}'::jsonb),'reply_requires_approval',marketing_private.inbox_reply_review_required(c.id),'reply_authority',(select jsonb_build_object('verified',coalesce(a.send_verified and a.webhook_verified and a.generation=conn.credential_generation and c.connection_generation=conn.credential_generation and conn.status='test_authorized' and conn.expires_at>now(),false),'recent',coalesce(a.verified_at>now()-interval '1 hour',false)) from public.marketing_connections conn left join marketing_private.inbox_authority a on a.connection_id=conn.id where conn.id=c.connection_id),'timeline_projected',true,'audit_messages',audit_messages,'conversation',(to_jsonb(c)-'participant_key')||jsonb_build_object('customer_profile',marketing_private.inbox_profile(c.id)),'messages',messages,'total',total,'drafts',drafts,'artifacts',artifacts,'members',members,
 'window_expires_at',c.last_inbound_at+interval '24 hours','window_open',c.medium='dm' and not c.opted_out and c.last_inbound_at+interval '24 hours'>now(),'channel_capability',marketing_private.inbox_channel(c.connection_id),'sending_enabled',false,'read_through_sequence',(select coalesce(max(sequence),0) from public.marketing_conversation_messages where conversation_id=c.id),'unread_count',marketing_private.inbox_unread(c.id,actor),'outbox',(select coalesce(jsonb_agg(to_jsonb(o)-'lease'),'[]') from public.marketing_reply_outbox o join public.marketing_reply_drafts d on d.id=o.draft_id where d.conversation_id=c.id));
end;$function$
;

CREATE OR REPLACE FUNCTION public.marketing_inbox_mark_read(p_conversation uuid, p_through bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c public.marketing_conversations; actor uuid; maximum bigint;
begin
 select * into c from public.marketing_conversations where id=p_conversation for share;
 actor:=marketing_private.require_access(c.organization_id,c.brand_id,'marketing_inbox.view');
 select coalesce(max(sequence),0) into maximum from public.marketing_conversation_messages where conversation_id=c.id;
 if p_through is null or p_through<0 or p_through>maximum then raise exception 'Read evidence unavailable.';end if;
 insert into public.marketing_inbox_reads(conversation_id,employee_id,through_sequence,read_at) values(c.id,actor,p_through,now()) on conflict(conversation_id,employee_id) do update set through_sequence=greatest(marketing_inbox_reads.through_sequence,excluded.through_sequence),read_at=now();
end;$function$
;

-- One Brand knowledge resolver and reply validator serve real Inbox and isolated simulations.
create function marketing_private.inbox_ai_knowledge(p_brand uuid,p_question text) returns jsonb language plpgsql stable set search_path=public as $$
declare facts jsonb;faqs jsonb;latest_question text:=coalesce(p_question,'');matched uuid;all_sources jsonb;
begin
 select coalesce(jsonb_object_agg(x.key,x.value),'{}') into facts from public.marketing_inbox_knowledge k join public.marketing_knowledge current_k on current_k.brand_id=k.brand_id and current_k.revision=k.knowledge_revision cross join lateral jsonb_each(k.profile) x
 where k.brand_id=p_brand and x.key in ('positioning','identity','audience','voice','rules') and x.value->>'provenance'='verified_brand_fact';
 matched:=marketing_private.inbox_match_faq(p_brand,coalesce(latest_question,''));
 -- Hash all Active records plus live operational validation. Any change invalidates cached proposals.
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'revision',revision,'issue',marketing_private.inbox_faq_use_issue(f)) order by id),'[]') into all_sources from public.marketing_inbox_faqs f where brand_id=p_brand and is_active;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'revision',revision,'question',question,'category',category,'alternatives',alternative_questions,'answer',case when issue is null then answer else null end,'use_issue',issue) order by rank desc,id),'[]') into faqs
 from(select f.*,marketing_private.inbox_faq_use_issue(f) issue,
  case when f.id=matched then 100 else 0 end + case when f.match_intent=marketing_private.inbox_faq_intent(coalesce(latest_question,'')) and f.match_intent<>'unknown' then 20 else 0 end +
  (select count(*)::integer from regexp_split_to_table(lower(coalesce(latest_question,'')),'[^[:alnum:]一-龥]+') term where length(term)>2 and position(term in lower(f.question||' '||array_to_string(f.alternative_questions,' ')))>0) rank
 from public.marketing_inbox_faqs f where f.brand_id=p_brand and f.is_active order by rank desc,f.id limit 12)x;
 return jsonb_build_object('facts',facts,'faqs',faqs,'deterministic_faq_id',matched,'outlet_known',false,'active_faq_count',jsonb_array_length(all_sources),'latest_truncated',length(coalesce(latest_question,''))>1000,
 'source_hash',encode(extensions.digest(jsonb_build_array(facts,all_sources)::text,'sha256'),'hex'));
end;$$;
create function marketing_private.inbox_outlet_context_for(p_brand uuid,p_outlet uuid,p_evidence jsonb) returns jsonb language plpgsql stable set search_path=public as $$
declare ids uuid[];target uuid;source text;begin
 select array_agg(o.id order by o.id) into ids from outlets o join brand_outlets b on b.outlet_id=o.id where b.brand_id=p_brand and o.is_active;
 if p_outlet=any(ids) then target:=p_outlet;source:=coalesce(p_evidence->>'source','staff_confirmed');
 elsif p_outlet is not null then source:='mapping_changed';
 elsif coalesce(p_evidence->>'state','') in ('clarification_required','cleared') then source:='clarification_required';
 elsif cardinality(ids)=1 then target:=ids[1];source:='single_outlet';
 else source:='unknown';end if;
 return jsonb_build_object('outlet_id',target,'source',source,'name',(select name from outlets where id=target),'eligible_count',coalesce(cardinality(ids),0),'known',target is not null);
end;$$;
create or replace function marketing_private.inbox_outlet_context(p_conversation uuid) returns jsonb language sql stable set search_path=public as $$
 select marketing_private.inbox_outlet_context_for(brand_id,outlet_id,outlet_context_evidence) from marketing_conversations where id=p_conversation;
$$;
create function marketing_private.inbox_current_question(p_conversation uuid) returns text language sql stable set search_path=public as $$
 select body from marketing_conversation_messages m join marketing_conversations c on c.id=m.conversation_id where c.id=p_conversation and (m.kind='incoming' or c.channel='internal' and m.kind='note') order by m.occurred_at desc,m.sequence desc limit 1;
$$;
create function marketing_private.inbox_ai_material_for(p_brand uuid,p_outlet uuid,p_question text,p_context jsonb,p_history jsonb) returns jsonb language plpgsql stable set search_path=public as $$
declare r jsonb; k public.marketing_knowledge; direct jsonb;extra jsonb;bounded jsonb:='{}';source_row record; context jsonb:=p_context;question text:=p_question;
begin
 r:=marketing_private.inbox_ai_knowledge(p_brand,p_question)||jsonb_build_object('history',p_history,'current_question',p_question);
 select * into k from public.marketing_knowledge where brand_id=p_brand;
 if k.confirmed_revision=k.revision then
  select coalesce(jsonb_object_agg(key,value),'{}') into extra from jsonb_each(k.profile) where key=any(k.confirmed_keys) and length(trim(value->>'text'))>0 and value->>'provenance'='verified_brand_fact';
  r:=jsonb_set(r,'{facts}',coalesce(r->'facts','{}')||extra);
 end if;
 direct:=marketing_private.customer_knowledge_facts(p_brand,p_outlet,coalesce(question,''));
 r:=jsonb_set(r,'{outlet_known}',to_jsonb(exists(select 1 from brand_outlets bo join outlets o on o.id=bo.outlet_id and o.is_active where bo.brand_id=p_brand and bo.outlet_id=p_outlet)));
 r:=jsonb_set(r,'{facts}',coalesce(r->'facts','{}')||direct)||jsonb_build_object('outlet_context',context);
 -- Fingerprint all live facts, even those outside the bounded candidate set.
 r:=jsonb_set(r,'{source_hash}',to_jsonb(encode(extensions.digest(jsonb_build_array(r->>'source_hash',r->'facts',p_outlet,r->'outlet_known')::text,'sha256'),'hex')));
 -- Bound direct retrieval by the latest question, retaining intelligence and source integrity.
 for source_row in select key,value from jsonb_each(r->'facts') where key like 'menu:%' loop
  select coalesce(jsonb_agg(item),'[]') into extra from (select item from jsonb_array_elements(source_row.value->'items') item order by (select count(*) from regexp_split_to_table(lower(coalesce(question,'')),'[^[:alnum:]一-龥]+') word where length(word)>2 and position(word in lower(item::text))>0) desc,item->>'name' limit 8)x;
  r:=jsonb_set(r,array['facts',source_row.key,'items'],extra);
 end loop;
 select coalesce(jsonb_object_agg(key,value),'{}') into extra from (
  select key,value from jsonb_each(r->'facts') order by case when key in ('identity','positioning','audience','voice','rules') then 100 else 0 end+
   (select count(*)::int from regexp_split_to_table(lower(coalesce(question,'')),'[^[:alnum:]一-龥]+') word where length(word)>2 and position(word in lower(value::text))>0) desc,key limit 16
 )x;
 for source_row in select key,value from jsonb_each(extra) order by case when key in ('identity','positioning','audience','voice','rules') then 0 else 1 end,key loop
  if octet_length((bounded||jsonb_build_object(source_row.key,source_row.value))::text)<=24000 then bounded:=bounded||jsonb_build_object(source_row.key,source_row.value);end if;
 end loop;
 return jsonb_set(r,'{facts}',bounded);
end;$$;
create or replace function marketing_private.inbox_assistant_material_v22(p_conversation uuid) returns jsonb language plpgsql stable set search_path=public as $$
declare c marketing_conversations;history jsonb;begin
 select * into c from marketing_conversations where id=p_conversation;
 -- Private team notes are not customer context. Internal cases may supply synthetic acceptance questions.
 select coalesce(jsonb_agg(jsonb_build_object('kind',kind,'text',left(body,1000)) order by occurred_at,sequence),'[]') into history
 from(select id,kind,body,occurred_at,sequence from public.marketing_conversation_messages where conversation_id=c.id and (kind in ('incoming','echo') or c.channel='internal' and kind='note') order by occurred_at desc,sequence desc limit 12)x;
return marketing_private.inbox_ai_knowledge(c.brand_id,marketing_private.inbox_current_question(c.id))||jsonb_build_object('history',history,'current_question',marketing_private.inbox_current_question(c.id));end;$$;
create or replace function marketing_private.inbox_assistant_material(p_conversation uuid) returns jsonb language plpgsql stable set search_path=public as $$
declare c marketing_conversations;history jsonb;context jsonb;begin
 select * into c from marketing_conversations where id=p_conversation;
 select coalesce(jsonb_agg(jsonb_build_object('kind',kind,'text',left(body,1000)) order by occurred_at,sequence),'[]') into history from(select kind,body,occurred_at,sequence from marketing_conversation_messages where conversation_id=c.id and (kind in ('incoming','echo') or c.channel='internal' and kind='note') order by occurred_at desc,sequence desc limit 12)x;
 context:=marketing_private.inbox_outlet_context(c.id);
 return marketing_private.inbox_ai_material_for(c.brand_id,nullif(context->>'outlet_id','')::uuid,marketing_private.inbox_current_question(c.id),context,history);
end;$$;
create function marketing_private.inbox_ai_sources(p_body jsonb,p_evidence jsonb,p_kind text) returns jsonb language plpgsql stable set search_path=public as $$
declare sources jsonb:='[]';ref text;source jsonb;begin
 if jsonb_typeof(p_body) is distinct from 'object' or octet_length(p_body::text)>16000 or length(trim(coalesce(p_body->>'text',''))) not between 1 and (case when p_kind='reply' then 2000 else 4000 end) or jsonb_typeof(p_body->'reference_keys') is distinct from 'array' or jsonb_array_length(p_body->'reference_keys')>12 or jsonb_typeof(p_body->'human_required') is distinct from 'boolean' or coalesce(p_body->>'language','') not in ('EN','ZH','BM') or coalesce(p_body->>'classification','') not in ('suggestion_available','needs_human_attention','insufficient_knowledge') or jsonb_typeof(p_body->'matched_faq_ids') is distinct from 'array' or jsonb_array_length(p_body->'matched_faq_ids')>12 or jsonb_typeof(p_body->'unresolved_questions') is distinct from 'array' or jsonb_array_length(p_body->'unresolved_questions')>8 or jsonb_typeof(p_body->'handoff_reasons') is distinct from 'array' or jsonb_array_length(p_body->'handoff_reasons')>8 then raise exception 'AI evidence invalid.';end if;
 for ref in select jsonb_array_elements_text(p_body->'matched_faq_ids') loop
  if not exists(select 1 from jsonb_array_elements(p_evidence->'faqs') f where f->>'id'=ref) then raise exception 'Unknown FAQ evidence.';end if;
 end loop;
 for ref in select jsonb_array_elements_text(p_body->'reference_keys') loop
  if ref like 'faq:%' then
   select f into source from jsonb_array_elements(p_evidence->'faqs') f where 'faq:'||(f->>'id')||':'||(f->>'revision')=ref and f->>'use_issue' is null;
   if source is null then raise exception 'Unavailable FAQ evidence.';end if;
   sources:=sources||jsonb_build_array(jsonb_build_object('key',ref,'kind','faq','id',source->>'id','revision',source->'revision','label',source->>'question'));
  else
   if not (p_evidence->'facts' ? ref) then raise exception 'Unknown knowledge evidence.';end if;
   sources:=sources||jsonb_build_array(jsonb_build_object('key',ref,'kind',case when ref like 'menu:%' then 'menu' when ref like 'promotion:%' then 'promotion' when ref like 'outlet:%' then 'outlet' else 'brand_intelligence' end,'label',coalesce(p_evidence->'facts'->ref->>'label',ref)));
  end if;
 end loop;
 if p_body->>'classification'='suggestion_available' and (jsonb_array_length(sources)=0 or (p_body->>'human_required')::boolean) then raise exception 'Supported answer requires sources.';end if;
return sources;end;$$;
CREATE OR REPLACE FUNCTION public.marketing_inbox_ai_finish(p_request uuid, p_lease uuid, p_body jsonb, p_model text, p_input integer, p_output integer, p_error boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
 sources:=marketing_private.inbox_ai_sources(p_body,r.evidence,r.kind);
 -- Handoff is advisory: no automatic assignment, status, closure, takeover or send.
 p_body:=p_body||jsonb_build_object('assistant_version','2.2','source_hash',r.evidence_hash,'sources',sources,'matches',(select coalesce(jsonb_agg(jsonb_build_object('id',q->>'id','question',q->>'question','use_issue',q->>'use_issue')),'[]') from jsonb_array_elements(r.evidence->'faqs') q where q->>'id' in (select jsonb_array_elements_text(p_body->'matched_faq_ids'))),'suggest_only',true);
 if octet_length(p_body::text)>32768 then raise exception 'AI source evidence is too large.';end if;
 insert into public.marketing_inbox_ai_artifacts(conversation_id,source_version,knowledge_revision,kind,body,model,input_tokens,output_tokens,created_by) values(c.id,c.version,r.knowledge_revision,r.kind,p_body,p_model,p_input,p_output,r.actor_employee_id) returning * into a;
 update marketing_private.inbox_ai_runs set state='completed',artifact_id=a.id where request_id=p_request;
 insert into public.marketing_events(organization_id,brand_id,action,actor_employee_id,details) values(c.organization_id,c.brand_id,'inbox_ai_proposed',r.actor_employee_id,jsonb_build_object('artifact_id',a.id,'kind',a.kind,'model',p_model,'match_source',p_body->>'match_source','latency_ms',p_body->'latency_ms','input_tokens',p_input,'output_tokens',p_output,'estimated_cost_usd',a.cost,'failure_reason',p_body->>'failure_reason'));
 return jsonb_build_object('state','completed','artifact_id',a.id,'classification',p_body->>'classification');
end;$function$
;


create table marketing_private.inbox_ai_tests (
 request_id uuid primary key,organization_id uuid not null references organizations(id),brand_id uuid not null references brands(id),actor_employee_id uuid not null references employees(id),
 mode text not null check(mode in('suggest_only','safe_auto','ai_first')),question text not null check(length(question) between 1 and 1000),history jsonb not null,
 outlet_id uuid references outlets(id),outlet_evidence jsonb not null, fingerprint text not null,evidence jsonb not null,evidence_hash text not null,
 state text not null default 'prepared' check(state in('prepared','claimed','completed','failed','superseded')),lease uuid,result jsonb,
 provider_model text,input_tokens integer,output_tokens integer,latency_ms integer,cost numeric,created_at timestamptz not null default now()
);
alter table marketing_private.inbox_ai_tests enable row level security;
revoke all on marketing_private.inbox_ai_tests from public,anon,authenticated,service_role;
create index inbox_ai_tests_actor_time on marketing_private.inbox_ai_tests(actor_employee_id,created_at desc);
create index inbox_ai_tests_active on marketing_private.inbox_ai_tests(actor_employee_id,brand_id) where state in('prepared','claimed');
create trigger inbox_ai_tests_cost before insert or update on marketing_private.inbox_ai_tests for each row execute function marketing_private.inbox_estimate_ai_cost();

create function marketing_private.inbox_test_material(p_brand uuid,p_outlet uuid,p_evidence jsonb,p_question text,p_history jsonb) returns jsonb language sql stable set search_path=public as $$
 select marketing_private.inbox_ai_material_for(p_brand,nullif(context->>'outlet_id','')::uuid,p_question,context,p_history)||jsonb_build_object('kind','reply','escalated',false,'staff_owned',false,'simulation',true) from (select marketing_private.inbox_outlet_context_for(p_brand,p_outlet,p_evidence) context)x;
$$;
create function public.marketing_inbox_test_context(p_org uuid,p_brand uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=marketing_private.require_access(p_org,p_brand,'marketing_inbox.configure');begin
 perform marketing_private.require_access(p_org,p_brand,'marketing_inbox.ai');
 if p_brand is null then raise exception 'Choose a Brand.';end if;
 return jsonb_build_object('consent',coalesce((select ai_allowed and automation_mode<>'off' from marketing_inbox_policies where brand_id=p_brand),false),'outlets',(select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'name',o.name) order by o.name),'[]') from brand_outlets b join outlets o on o.id=b.outlet_id and o.is_active where b.brand_id=p_brand),'daily_remaining',greatest(0,20-(select count(*) from marketing_private.inbox_ai_runs where actor_employee_id=actor and created_at>now()-interval '24 hours')-(select count(*) from marketing_private.inbox_ai_tests where actor_employee_id=actor and created_at>now()-interval '24 hours')));
end;$$;
revoke all on function public.marketing_inbox_test_context(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.marketing_inbox_test_context(uuid,uuid) to authenticated;
create function public.marketing_inbox_test_prepare(p_request uuid,p_org uuid,p_brand uuid,p_mode text,p_history jsonb,p_outlet uuid default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare actor uuid:=marketing_private.require_access(p_org,p_brand,'marketing_inbox.configure');r marketing_private.inbox_ai_tests;m jsonb;context jsonb;ref jsonb;q text;fp text;evidence jsonb:='{}';target uuid:=p_outlet;
begin
 perform marketing_private.require_access(p_org,p_brand,'marketing_inbox.ai');
 if p_brand is null or p_request is null or p_mode is null or p_mode not in('suggest_only','safe_auto','ai_first') or jsonb_typeof(p_history) is distinct from 'array' or jsonb_array_length(p_history) not between 1 and 12 or octet_length(p_history::text)>18000 then raise exception 'Provide a bounded Brand test conversation.';end if;
 if exists(select 1 from jsonb_array_elements(p_history) x where jsonb_typeof(x) is distinct from 'object' or coalesce(x->>'kind','') not in('incoming','echo') or length(trim(coalesce(x->>'text',''))) not between 1 and 1000 or exists(select 1 from jsonb_object_keys(x) key where key not in('kind','text'))) or p_history->-1->>'kind'<>'incoming' then raise exception 'Provide a customer question and up to twelve short test messages.';end if;
 if not exists(select 1 from marketing_inbox_policies where brand_id=p_brand and ai_allowed and automation_mode<>'off') then raise exception 'Save Brand AI consent before testing.';end if;
 if target is not null and not exists(select 1 from brand_outlets b join outlets o on o.id=b.outlet_id and o.is_active where b.brand_id=p_brand and b.outlet_id=target) then raise exception 'Choose an active Outlet linked to this Brand.';end if;
 q:=p_history->-1->>'text';ref:=marketing_private.inbox_outlet_reference(p_brand,q);
 if ref->>'state'='matched' then target:=(ref->>'outlet_id')::uuid;evidence:=jsonb_build_object('source','customer_reference','state','matched');
 elsif ref->>'state'='clarification_required' then target:=null;evidence:=jsonb_build_object('source','customer_reference','state','clarification_required');
 elsif target is not null then evidence:=jsonb_build_object('source','staff_confirmed','state','matched');end if;
 context:=marketing_private.inbox_outlet_context_for(p_brand,target,evidence);target:=nullif(context->>'outlet_id','')::uuid;evidence:=evidence||jsonb_build_object('source',context->>'source');
 m:=marketing_private.inbox_test_material(p_brand,target,evidence,q,p_history);
 fp:=encode(extensions.digest(jsonb_build_array(p_org,p_brand,p_mode,p_history,target,evidence,m->>'source_hash')::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(actor::text,2));
 update marketing_private.inbox_ai_tests set state='failed' where actor_employee_id=actor and state in('prepared','claimed') and created_at<now()-interval '2 minutes';
 select * into r from marketing_private.inbox_ai_tests where request_id=p_request;
 if r.request_id is not null then if r.actor_employee_id<>actor or r.fingerprint<>fp then raise exception 'Test request identity changed.';end if;return jsonb_build_object('state',r.state,'result',r.result,'cached',true);end if;
 select * into r from marketing_private.inbox_ai_tests where actor_employee_id=actor and fingerprint=fp and state='completed' and coalesce(result->'body'->>'failure_reason','') not like 'ai\_%' escape '\' and created_at>now()-interval '15 minutes' order by created_at desc limit 1;
 if r.request_id is not null then return jsonb_build_object('state','completed','result',r.result,'cached',true);end if;
 if exists(select 1 from marketing_private.inbox_ai_tests where actor_employee_id=actor and brand_id=p_brand and state in('prepared','claimed')) then return jsonb_build_object('state','generating');end if;
 if exists(select 1 from marketing_private.inbox_ai_tests where actor_employee_id=actor and brand_id=p_brand and (state='failed' or state='completed' and result->'body'->>'failure_reason' like 'ai\_%' escape '\') and created_at>now()-interval '1 minute') then return jsonb_build_object('state','cooldown');end if;
 if (select count(*) from marketing_private.inbox_ai_runs where actor_employee_id=actor and created_at>now()-interval '24 hours')+(select count(*) from marketing_private.inbox_ai_tests where actor_employee_id=actor and created_at>now()-interval '24 hours')>=20 then raise exception 'Daily AI request limit reached.';end if;
 insert into marketing_private.inbox_ai_tests(request_id,organization_id,brand_id,actor_employee_id,mode,question,history,outlet_id,outlet_evidence,fingerprint,evidence,evidence_hash) values(p_request,p_org,p_brand,actor,p_mode,q,p_history,target,evidence,fp,m,m->>'source_hash');
 return jsonb_build_object('state','prepared');
end;$$;

create function public.marketing_inbox_test_claim(p_request uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r marketing_private.inbox_ai_tests;m jsonb;begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service only.';end if;
 select * into r from marketing_private.inbox_ai_tests where request_id=p_request and actor_employee_id=p_actor for update;
 if r.request_id is null or r.state<>'prepared' then return null;end if;
 m:=marketing_private.inbox_test_material(r.brand_id,r.outlet_id,r.outlet_evidence,r.question,r.history);
 if not marketing_private.actor_allowed(r.actor_employee_id,r.organization_id,r.brand_id,'marketing_inbox.configure') or not marketing_private.actor_allowed(r.actor_employee_id,r.organization_id,r.brand_id,'marketing_inbox.ai') or not exists(select 1 from marketing_inbox_policies where brand_id=r.brand_id and ai_allowed and automation_mode<>'off') or m->>'source_hash' is distinct from r.evidence_hash or r.created_at<now()-interval '2 minutes' then update marketing_private.inbox_ai_tests set state='superseded' where request_id=r.request_id;return null;end if;
 update marketing_private.inbox_ai_tests set state='claimed',lease=gen_random_uuid() where request_id=r.request_id returning * into r;
 return m||jsonb_build_object('lease',r.lease);
end;$$;

create function public.marketing_inbox_test_finish(p_request uuid,p_lease uuid,p_body jsonb,p_model text,p_input integer,p_output integer,p_error boolean default false) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r marketing_private.inbox_ai_tests;m jsonb;sources jsonb;body jsonb;a marketing_inbox_ai_artifacts;decision jsonb;outcome jsonb;begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service only.';end if;
 select * into r from marketing_private.inbox_ai_tests where request_id=p_request and lease=p_lease for update;
 if r.request_id is null then raise exception 'Test lease unavailable.';end if;
 if p_input<0 or p_output<0 or length(p_model)>100 or coalesce(p_body->>'latency_ms','0') !~ '^[0-9]{1,6}$' then raise exception 'Invalid AI usage.';end if;
 update marketing_private.inbox_ai_tests set provider_model=nullif(p_model,''),input_tokens=p_input,output_tokens=p_output,latency_ms=(coalesce(p_body->>'latency_ms','0'))::integer where request_id=r.request_id returning * into r;
 if r.state<>'claimed' then return jsonb_build_object('state',r.state,'result',r.result);end if;
 if p_error then update marketing_private.inbox_ai_tests set state='failed' where request_id=r.request_id;return jsonb_build_object('state','failed');end if;
 m:=marketing_private.inbox_test_material(r.brand_id,r.outlet_id,r.outlet_evidence,r.question,r.history);
 if not marketing_private.actor_allowed(r.actor_employee_id,r.organization_id,r.brand_id,'marketing_inbox.configure') or not marketing_private.actor_allowed(r.actor_employee_id,r.organization_id,r.brand_id,'marketing_inbox.ai') or not exists(select 1 from marketing_inbox_policies where brand_id=r.brand_id and ai_allowed and automation_mode<>'off') or m->>'source_hash' is distinct from r.evidence_hash then update marketing_private.inbox_ai_tests set state='superseded' where request_id=r.request_id;return jsonb_build_object('state','superseded');end if;
 sources:=marketing_private.inbox_ai_sources(p_body,r.evidence,'reply');body:=p_body||jsonb_build_object('sources',sources);
 a.body:=body;
 decision:=case when r.mode='suggest_only' then jsonb_build_object('kind','suggestion','text',body->>'text','reason','staff_review_required') else marketing_private.inbox_auto_answer(a,m,r.mode) end;
 outcome:=jsonb_build_object('simulation',true,'mode',r.mode,'body',body,'decision',decision,'outlet_context',m->'outlet_context','model',r.provider_model,'input_tokens',r.input_tokens,'output_tokens',r.output_tokens,'latency_ms',r.latency_ms,'estimated_cost_usd',r.cost,'delivery_checked',false);
 update marketing_private.inbox_ai_tests set state='completed',result=outcome where request_id=r.request_id;
 return jsonb_build_object('state','completed','result',outcome);
end;$$;
revoke all on function public.marketing_inbox_test_prepare(uuid,uuid,uuid,text,jsonb,uuid),public.marketing_inbox_test_claim(uuid,uuid),public.marketing_inbox_test_finish(uuid,uuid,jsonb,text,integer,integer,boolean) from public,anon,authenticated,service_role;
grant execute on function public.marketing_inbox_test_prepare(uuid,uuid,uuid,text,jsonb,uuid) to authenticated;
grant execute on function public.marketing_inbox_test_claim(uuid,uuid),public.marketing_inbox_test_finish(uuid,uuid,jsonb,text,integer,integer,boolean) to service_role;
revoke all on function marketing_private.inbox_ai_knowledge(uuid,text),marketing_private.inbox_outlet_context_for(uuid,uuid,jsonb),marketing_private.inbox_current_question(uuid),marketing_private.inbox_ai_material_for(uuid,uuid,text,jsonb,jsonb),marketing_private.inbox_ai_sources(jsonb,jsonb,text),marketing_private.inbox_test_material(uuid,uuid,jsonb,text,jsonb) from public,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION marketing_private.inbox_ai_prepare_as(p_actor uuid, p_request uuid, p_conversation uuid, p_version integer, p_kind text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c public.marketing_conversations; actor uuid; k integer; fp text; r marketing_private.inbox_ai_runs; material jsonb;
begin
 select * into c from public.marketing_conversations where id=p_conversation for share;
 actor:=p_actor;if not marketing_private.actor_allowed(actor,c.organization_id,c.brand_id,'marketing_inbox.ai') then raise exception 'Inbox AI scope denied.';end if;
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
 if (select count(*) from marketing_private.inbox_ai_runs where actor_employee_id=actor and created_at>now()-interval '24 hours')+(select count(*) from marketing_private.inbox_ai_tests where actor_employee_id=actor and created_at>now()-interval '24 hours')>=20 then raise exception 'Daily AI request limit reached.';end if;
 insert into marketing_private.inbox_ai_runs(request_id,conversation_id,actor_employee_id,fingerprint,source_version,knowledge_revision,kind,evidence,evidence_hash) values(p_request,c.id,actor,fp,c.version,k,p_kind,material-'history',material->>'source_hash');
 return jsonb_build_object('state','prepared');
end;$function$
;

-- Debounce only canonical signed incoming automatic turns. No scheduler or execution gate changes.
alter table marketing_private.inbox_automatic_turns add column not_before timestamptz,add column batch_started_at timestamptz,add column batch_first_sequence bigint;
update marketing_private.inbox_automatic_turns t set not_before=t.created_at,batch_started_at=t.created_at,batch_first_sequence=m.sequence from marketing_conversation_messages m where m.id=t.message_id;
alter table marketing_private.inbox_automatic_turns alter column not_before set default now(),alter column not_before set not null,alter column batch_started_at set default now(),alter column batch_started_at set not null;
create index inbox_automatic_turns_ready on marketing_private.inbox_automatic_turns(not_before,created_at) where state='queued';

create or replace function marketing_private.inbox_current_question(p_conversation uuid) returns text language plpgsql stable set search_path=public as $$
declare c marketing_conversations;m marketing_conversation_messages;t marketing_private.inbox_automatic_turns;question text;begin
 select * into c from marketing_conversations where id=p_conversation;
 select * into m from marketing_conversation_messages where conversation_id=c.id and (kind='incoming' or c.channel='internal' and kind='note') order by occurred_at desc,sequence desc limit 1;
 select * into t from marketing_private.inbox_automatic_turns where message_id=m.id;
 if t.batch_first_sequence is null then return m.body;end if;
 -- Keep a bounded current burst, never private team notes. Overlong combined questions fail the existing safe bounds.
 select string_agg(body,chr(10) order by occurred_at,sequence) into question from (select body,occurred_at,sequence from marketing_conversation_messages where conversation_id=c.id and kind='incoming' and evidence_source='signed_webhook' and sequence between t.batch_first_sequence and m.sequence order by occurred_at desc,sequence desc limit 12)x;
 return left(coalesce(question,m.body),1001);
end;$$;
CREATE OR REPLACE FUNCTION marketing_private.inbox_auto_enqueue()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare p public.marketing_inbox_policies;prior marketing_private.inbox_automatic_turns;started timestamptz;first_sequence bigint;begin
 if new.kind<>'incoming' or new.evidence_source<>'signed_webhook' or new.provider_message_id is null then return new;end if;
 if exists(select 1 from marketing_conversations c where c.id=new.conversation_id and marketing_private.inbox_automation_issue(c.connection_id,new.occurred_at) is not null) then return new;end if;
 select p0.* into p from marketing_inbox_policies p0 join marketing_conversations c on c.brand_id=p0.brand_id where c.id=new.conversation_id;
 if (p.ai_conversation_ids is null or new.conversation_id=any(p.ai_conversation_ids)) and p.ai_allowed and p.ai_reply_mode<>'suggest_only' and new.occurred_at>=p.ai_enabled_at and new.occurred_at>now()-interval '5 minutes' then
  perform 1 from marketing_conversations where id=new.conversation_id for update;
  if exists(select 1 from marketing_private.inbox_automatic_turns where message_id=new.id) then return new;end if;
  select * into prior from marketing_private.inbox_automatic_turns where conversation_id=new.conversation_id and state in('queued','generating','prepared') and policy_revision=p.revision order by created_at desc limit 1 for update;
  started:=coalesce(prior.batch_started_at,clock_timestamp());first_sequence:=coalesce(prior.batch_first_sequence,new.sequence);
  update marketing_reply_outbox o set state='blocked',reason='newer_message' from marketing_private.inbox_automatic_turns t where o.automatic_turn_id=t.id and t.conversation_id=new.conversation_id and o.state='prepared';
  update marketing_private.inbox_automatic_turns set state='superseded',reason='newer_message',updated_at=now() where conversation_id=new.conversation_id and state in('queued','generating','prepared');
  insert into marketing_private.inbox_automatic_turns(message_id,conversation_id,policy_revision,batch_started_at,batch_first_sequence,not_before) values(new.id,new.conversation_id,p.revision,started,first_sequence,least(clock_timestamp()+interval '8 seconds',started+interval '30 seconds')) on conflict(message_id) do nothing;
 end if;return new;
end;$function$
;

CREATE OR REPLACE FUNCTION public.marketing_inbox_auto_claim()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare t marketing_private.inbox_automatic_turns;c public.marketing_conversations;p public.marketing_inbox_policies;m public.marketing_conversation_messages;r jsonb;material jsonb;issue text;begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service only';end if;
 -- Never automatically repeat an uncertain provider generation.
 for t in select q.* from marketing_private.inbox_automatic_turns q join marketing_conversations c0 on c0.id=q.conversation_id where q.state='generating' and q.updated_at<now()-interval '2 minutes' order by q.updated_at limit 10 for update of c0 skip locked loop perform public.marketing_inbox_auto_fail(t.id,t.lease,'generation_expired');end loop;
 -- A committed prepared outbox may survive a lost worker response. Resume its delivery, not generation.
 for t in select q.* from marketing_private.inbox_automatic_turns q join marketing_conversations c0 on c0.id=q.conversation_id join marketing_reply_outbox o on o.automatic_turn_id=q.id where q.state='prepared' and o.state='prepared' and (q.delivery_claimed_at is null or q.delivery_claimed_at<now()-interval '2 minutes') order by q.created_at limit 10 for update of c0 skip locked loop
  select * into c from marketing_conversations where id=t.conversation_id;select * into p from marketing_inbox_policies where brand_id=c.brand_id;
  if p.revision<>t.policy_revision or c.version<>t.source_version or t.created_at<=now()-interval '5 minutes' or marketing_private.inbox_auto_issue(c,p) is not null then perform public.marketing_inbox_auto_fail(t.id,t.lease,'automatic_processing_failed');continue;end if;
  update marketing_private.inbox_automatic_turns set delivery_claimed_at=now() where id=t.id and state='prepared' and (delivery_claimed_at is null or delivery_claimed_at<now()-interval '2 minutes') returning * into t;
  if not found then continue;end if;
  return jsonb_build_object('delivery_only',true,'state','prepared','turn_id',t.id,'lease',t.lease,'draft_id',(select draft_id from marketing_reply_outbox where automatic_turn_id=t.id),'auth_user',(select auth_user_id from employees where id=t.actor_employee_id));
 end loop;
 for t in select q.* from marketing_private.inbox_automatic_turns q join marketing_conversations c0 on c0.id=q.conversation_id where q.state='queued' and q.not_before<=now() order by q.created_at limit 10 for update of c0 skip locked loop
  select * into c from marketing_conversations where id=t.conversation_id for update;
  select * into p from marketing_inbox_policies where brand_id=c.brand_id;
  select * into m from marketing_conversation_messages where id=t.message_id;
  issue:=marketing_private.inbox_auto_issue(c,p);
  if p.revision<>t.policy_revision then issue:='policy_changed';end if;
  if exists(select 1 from marketing_conversation_messages x where x.conversation_id=c.id and x.kind in ('incoming','attachment') and (x.occurred_at,x.sequence)>(m.occurred_at,m.sequence)) then update marketing_private.inbox_automatic_turns set state='superseded',reason='newer_message',updated_at=now() where id=t.id;continue;end if;
  if m.occurred_at<=now()-interval '5 minutes' then issue:='response_deadline';end if;
  if exists(select 1 from marketing_reply_outbox o join marketing_private.inbox_automatic_turns x on x.id=o.automatic_turn_id where x.conversation_id=c.id and o.state in ('pending','reconciling')) then issue:='previous_delivery_uncertain';end if;
  if (select count(*) from marketing_private.inbox_automatic_turns where conversation_id=c.id and state in ('prepared','pending','sent','delivered','read','reconciling') and created_at>now()-interval '24 hours')>=8 then issue:='conversation_response_limit';end if;
  if marketing_private.inbox_auto_sensitive(marketing_private.inbox_current_question(c.id)) and issue in ('human_handling') or issue is null and marketing_private.inbox_auto_sensitive(marketing_private.inbox_current_question(c.id)) then perform marketing_private.inbox_auto_handoff(t.id,'safety_or_human_request');continue;end if;
  if issue in ('conversation_response_limit','previous_delivery_uncertain','response_deadline','external_outbound_observed') then perform marketing_private.inbox_auto_handoff(t.id,issue);continue;end if;
  if issue is not null then update marketing_private.inbox_automatic_turns set state='blocked',reason=issue,updated_at=now() where id=t.id;continue;end if;
  begin r:=marketing_private.inbox_ai_prepare_as(p.ai_authorized_by,t.id,c.id,c.version,'reply');exception when others then
   update marketing_private.inbox_automatic_turns set state='failed',reason='generation_quota_or_authority',updated_at=now() where id=t.id;perform marketing_private.inbox_auto_handoff(t.id,'generation_quota_or_authority');return null;
  end;
  if r->>'state'='generating' then return null;end if;
  if r->>'state'='prepared' then material:=public.marketing_inbox_ai_claim(t.id,p.ai_authorized_by);
  elsif r->>'state'='completed' and r->>'artifact_id' is not null then material:=marketing_private.inbox_assistant_material(c.id)||jsonb_build_object('cached_artifact',r->>'artifact_id');
  else update marketing_private.inbox_automatic_turns set state='blocked',reason='generation_unavailable',updated_at=now() where id=t.id;return null;end if;
  if material is null then return null;end if;
  update marketing_private.inbox_automatic_turns set state='generating',actor_employee_id=p.ai_authorized_by,source_version=c.version,source_hash=material->>'source_hash',lease=coalesce(nullif(material->>'lease','')::uuid,gen_random_uuid()),updated_at=now() where id=t.id returning * into t;
  return material||jsonb_build_object('turn_id',t.id,'request_id',t.id,'lease',t.lease,'mode',p.ai_reply_mode,'auth_user',(select auth_user_id from employees where id=p.ai_authorized_by),'kind','reply','provider_timeout_ms',12000);
 end loop;return null;
end;$function$
;

CREATE OR REPLACE FUNCTION marketing_private.inbox_auto_answer(a marketing_inbox_ai_artifacts, material jsonb, p_mode text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare ref text;f jsonb;h jsonb;item jsonb;part text;parts text[]:='{}';q text;lang text;intent text;keys jsonb:='[]';begin
 q:=coalesce(material->>'current_question',(select x->>'text' from jsonb_array_elements(material->'history') with ordinality h(x,n) where x->>'kind'='incoming' order by n desc limit 1),'');lang:=case when q ~ '[一-鿿]' then 'ZH' when q ~* '\m(boleh|nak|saya|masih|buka|tutup|mana|pukul|tempah|bayaran|cawangan|berapa|promosi)\M' then 'BM' else a.body->>'language' end;intent:=a.body->>'intent';
 if marketing_private.inbox_auto_sensitive(q) or a.body->'handoff_reasons'<>'[]'::jsonb then return jsonb_build_object('kind','handoff','reason','safety_or_human_request');end if;
 if p_mode='ai_first' and material->'outlet_context'->>'known'='false' and (material->'outlet_context'->>'eligible_count')::int>1 and q ~* '(hours|open|clos|price|address|buka|tutup|harga|alamat|营业|几点|地址|价格)' then
  return jsonb_build_object('kind','clarify','reason','outlet_clarification','keys','[]'::jsonb,'text',case lang when 'ZH' then '请问你指的是哪一家分店？' when 'BM' then 'Cawangan mana yang anda maksudkan?' else 'Which outlet do you mean?' end);
 end if;
 if a.body->>'classification'<>'suggestion_available' or coalesce((a.body->>'human_required')::boolean,true) or a.body->'unresolved_questions'<>'[]'::jsonb then return jsonb_build_object('kind','handoff','reason','insufficient_knowledge');end if;
 if intent is null or intent not in ('brand_identity','menu','pricing','operating_hours','locations','promotions','unknown') then return jsonb_build_object('kind','handoff','reason','business_decision');end if;
 for ref in select jsonb_array_elements_text(a.body->'reference_keys') loop
  part:=null;
  if ref in ('voice','tone','guidelines','communication_guidelines') then continue;end if;
  if ref like 'faq:%' then
   select x into f from jsonb_array_elements(material->'faqs') x where 'faq:'||(x->>'id')||':'||(x->>'revision')=ref and x->>'use_issue' is null;
   if f is not null and f->>'category' not in ('reservations','feedback_complaints') and cardinality(marketing_private.inbox_risk((f->>'question')||' '||(f->>'answer')))=0 then part:=f->>'answer';end if;
  else
   f:=material->'facts'->ref;
   if ref in ('identity','positioning','audience') and intent='brand_identity' and coalesce(f->>'text','') !~* '(open|hours|price|refund|reserv|优惠|营业|价格|harga|buka|tutup)' then part:=f->>'text';
   elsif ref like 'promotion:%' and f->>'source'='manager_confirmed_promotion' then part:=concat_ws(' — ',f->>'label',f->>'text','('||(f->>'starts_on')||' – '||(f->>'ends_on')||')',nullif(f->>'terms',''));
   elsif ref like 'outlet:%' and f->>'outlet_context_confirmed'='true' then
    if intent='locations' then part:=case when nullif(f->>'address','') is not null then f->>'text' end;
    elsif intent='operating_hours' then
     h:=f->'service_profile'->'requested_hours';
     if f->'service_profile'->>'requested_date' is not null then
      if h->>'status'='closed' then part:=(f->>'label')||' · '||(f->'service_profile'->>'requested_date')||case lang when 'ZH' then '：休息。' when 'BM' then ': Tutup.' else ': Closed.' end;
      elsif h->>'status'='open' and jsonb_array_length(h->'periods')>0 then
       select string_agg((x->>'opens')||'–'||(x->>'closes')||case when x->>'overnight'='true' then case lang when 'ZH' then '（次日）' when 'BM' then ' (hari berikutnya)' else ' (next day)' end else '' end,', ' order by n) into part from jsonb_array_elements(h->'periods') with ordinality p(x,n);
       part:=(f->>'label')||' · '||(f->'service_profile'->>'requested_date')||': '||part||' ('||(f->'service_profile'->>'timezone')||').';
      end if;
     end if;
    end if;
   elsif ref='menu:restaurant' and f->>'source'='restaurant_product_sales_with_explicit_recipe_mapping' and intent in ('menu','pricing') then
    -- Only return supplied current, manager-included items; never infer stock from sales.
    select string_agg((x->>'name')||case when x->>'price' is not null and x->>'price_issue' is null then ' · MYR '||(x->>'price') else '' end||case when nullif(x->>'description','') is not null then ' — '||(x->>'description') else '' end,chr(10) order by n) into part from jsonb_array_elements(f->'items') with ordinality i(x,n);
    if intent='pricing' and exists(select 1 from jsonb_array_elements(f->'items') x where x->>'price' is null or x->>'price_issue' is not null) then part:=null;end if;
   end if;
  end if;
  if part is not null and not(ref like 'outlet:%' and intent in('locations','operating_hours')) then
   part:=marketing_private.inbox_auto_translation(part,lang);
   if part is null then return jsonb_build_object('kind','handoff','reason','safe_translation_unavailable');end if;
  end if;
  if part is null or cardinality(marketing_private.inbox_risk(part))>0 or part ~* '(we (will|can|have) (book|reserve|refund|confirm)|已(预订|訂位|退款)|sudah (ditempah|dibayar))' then return jsonb_build_object('kind','handoff','reason','unrenderable_or_sensitive_source');end if;
  if not(part=any(parts)) then parts:=array_append(parts,part);end if;keys:=keys||jsonb_build_array(ref);
 end loop;
 part:=array_to_string(parts,chr(10));
 if length(part) not between 1 and 1800 then return jsonb_build_object('kind','handoff','reason','answer_bounds');end if;
 return jsonb_build_object('kind','answer','reason','source_grounded','keys',keys,'text',part);
end;$function$
;

