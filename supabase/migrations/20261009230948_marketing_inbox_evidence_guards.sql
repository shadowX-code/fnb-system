-- Forward-only concurrency and bounded evidence correction. No Meta connection grants or execution flags are changed.
create index marketing_conversations_creator on public.marketing_conversations(created_by);
alter table marketing_private.inbox_ai_runs add column provider_model text, add column input_tokens integer, add column output_tokens integer, add column cost numeric;

create or replace function public.marketing_inbox_read(p_org uuid,p_brand uuid default null,p_status text default '',p_channel text default '',p_search text default '',p_page integer default 1,p_size integer default 20) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=marketing_private.require_access(p_org,p_brand,'marketing_inbox.view'); rows jsonb; total integer; channels jsonb; members jsonb; policy jsonb; faqs jsonb; knowledge jsonb; usage jsonb;
begin
 if p_page is null or p_size is null or p_page<1 or p_size not between 1 and 100 or p_status is null or p_channel is null or p_search is null or length(p_search)>100 or p_status not in ('','open','pending','resolved') or p_channel not in ('','internal','facebook','instagram') then raise exception 'Invalid Inbox filters.';end if;
 select count(*) into total from public.marketing_conversations c where c.organization_id=p_org and (p_brand is null or c.brand_id=p_brand) and marketing_private.brand_allowed(p_org,c.brand_id)
 and (p_status='' or c.status=p_status) and (p_channel='' or c.channel=p_channel) and (p_search='' or c.title ilike '%'||p_search||'%');
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into rows from (
 select c.id,c.organization_id,c.brand_id,b.name brand_name,c.channel,c.title,c.status,c.priority,c.assigned_to,c.tags,c.takeover,c.escalation_reasons,c.version,c.last_inbound_at,c.updated_at
 from public.marketing_conversations c join public.brands b on b.id=c.brand_id where c.organization_id=p_org and (p_brand is null or c.brand_id=p_brand) and marketing_private.brand_allowed(p_org,c.brand_id)
 and (p_status='' or c.status=p_status) and (p_channel='' or c.channel=p_channel) and (p_search='' or c.title ilike '%'||p_search||'%') order by c.updated_at desc,c.id limit p_size offset (p_page-1)*p_size)x;
 select coalesce(jsonb_agg(marketing_private.inbox_channel(c.id)),'[]') into channels from public.marketing_connections c where c.organization_id=p_org and (p_brand is null or c.brand_id=p_brand) and marketing_private.brand_allowed(p_org,c.brand_id);
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',e.full_name) order by e.full_name),'[]') into members from public.organization_memberships m join public.employees e on e.id=m.employee_id
 where m.organization_id=p_org and e.is_active and (p_brand is not null and marketing_private.actor_allowed(e.id,p_org,p_brand,'marketing_inbox.view'));
 if p_brand is not null then
  select to_jsonb(p) into policy from public.marketing_inbox_policies p where p.brand_id=p_brand;
  select coalesce(jsonb_agg(to_jsonb(f) order by f.updated_at desc),'[]') into faqs from (select * from public.marketing_inbox_faqs where brand_id=p_brand order by updated_at desc limit 100) f;
  select jsonb_build_object('revision',k.revision,'profile',k.profile,'approved_for_replies',exists(select 1 from public.marketing_inbox_knowledge s where s.brand_id=k.brand_id and s.knowledge_revision=k.revision)) into knowledge from public.marketing_knowledge k where k.brand_id=p_brand;
 end if;
 select jsonb_build_object('requests',count(*),'input_tokens',sum(r.input_tokens),'output_tokens',sum(r.output_tokens),'usage_unavailable_requests',count(*) filter(where r.input_tokens is null or r.output_tokens is null),'cost',null,'cost_available',false)
 into usage from marketing_private.inbox_ai_runs r join public.marketing_conversations c on c.id=r.conversation_id where c.organization_id=p_org and (p_brand is null or c.brand_id=p_brand) and marketing_private.brand_allowed(p_org,c.brand_id);
 return jsonb_build_object('ai_usage',usage,'rows',rows,'total',total,'channels',channels,'members',members,'policy',coalesce(policy,'{"revision":0,"automation_mode":"off","ai_allowed":false}'),'faqs',coalesce(faqs,'[]'),'knowledge',knowledge,'external_execution_enabled',false);
end;$$;

create or replace function public.marketing_inbox_detail(p_conversation uuid,p_page integer default 1,p_size integer default 30) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare c public.marketing_conversations; actor uuid; messages jsonb; total integer; drafts jsonb; artifacts jsonb; members jsonb;
begin
 select * into c from public.marketing_conversations where id=p_conversation;if c.id is null then raise exception 'Conversation unavailable.';end if;
 actor:=marketing_private.require_access(c.organization_id,c.brand_id,'marketing_inbox.view');
 if p_page is null or p_size is null or p_page<1 or p_size not between 1 and 50 then raise exception 'Invalid history page.';end if;
 select count(*) into total from public.marketing_conversation_messages where conversation_id=c.id;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.occurred_at,x.id),'[]') into messages from (select m.*,e.full_name actor_name from public.marketing_conversation_messages m left join public.employees e on e.id=m.actor_employee_id where conversation_id=c.id order by occurred_at desc,m.id desc limit p_size offset (p_page-1)*p_size)x;
 select coalesce(jsonb_agg(to_jsonb(d) order by created_at desc),'[]') into drafts from (select * from public.marketing_reply_drafts where conversation_id=c.id order by created_at desc limit 50) d;
 select coalesce(jsonb_agg(to_jsonb(a) order by created_at desc),'[]') into artifacts from (select * from public.marketing_inbox_ai_artifacts where conversation_id=c.id order by created_at desc limit 50) a;
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',e.full_name) order by e.full_name),'[]') into members from public.organization_memberships m join public.employees e on e.id=m.employee_id
 where m.organization_id=c.organization_id and marketing_private.actor_allowed(e.id,c.organization_id,c.brand_id,'marketing_inbox.view');
 return jsonb_build_object('conversation',to_jsonb(c)-'participant_key','messages',messages,'total',total,'drafts',drafts,'artifacts',artifacts,'members',members,
 'window_expires_at',c.last_inbound_at+interval '24 hours','window_open',c.last_inbound_at+interval '24 hours'>now(),'channel_capability',marketing_private.inbox_channel(c.connection_id),'sending_enabled',false);
end;$$;

create or replace function public.marketing_inbox_command(p_request uuid,p_org uuid,p_brand uuid,p_conversation uuid,p_version integer,p_command text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public as $$
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
   select f.* into faq from public.marketing_inbox_faqs f join public.marketing_knowledge k on k.brand_id=f.brand_id and k.revision=f.knowledge_revision where f.id=(p_payload->>'faq_id')::uuid and f.brand_id=c.brand_id and f.status='approved';
   if faq.id is null then raise exception 'Approved FAQ unavailable.';end if;
   insert into public.marketing_reply_drafts(conversation_id,body,source_version,knowledge_revision,provenance,source_references,created_by) values(c.id,faq.answer,c.version,faq.knowledge_revision,'approved_faq',to_jsonb(faq.reference_keys),actor) returning * into d;
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
end;$$;

create or replace function public.marketing_inbox_configure(p_request uuid,p_brand uuid,p_revision integer,p_command text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public as $$
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
  insert into public.marketing_inbox_policies(brand_id,automation_mode,ai_allowed,updated_by) values(p_brand,p_payload->>'automation_mode',(p_payload->>'ai_allowed')::boolean,actor)
   on conflict(brand_id) do update set revision=marketing_inbox_policies.revision+1,automation_mode=excluded.automation_mode,ai_allowed=excluded.ai_allowed,updated_by=actor,updated_at=now() returning to_jsonb(marketing_inbox_policies) into result;
 elsif p_command='save_faq' then
  if not exists(select 1 from public.marketing_inbox_knowledge where brand_id=p_brand and knowledge_revision=k.revision) then raise exception 'Approve current Brand Knowledge first.';end if;
  if jsonb_typeof(p_payload->'reference_keys') is distinct from 'array' or jsonb_array_length(p_payload->'reference_keys') not between 1 and 9 or exists(select 1 from jsonb_array_elements_text(p_payload->'reference_keys') r where not exists(select 1 from public.marketing_inbox_knowledge s where s.brand_id=p_brand and s.knowledge_revision=k.revision and s.profile ? r)) then raise exception 'Cite approved facts.';end if;
  if p_payload->>'id' is not null then
   select * into f from public.marketing_inbox_faqs where id=(p_payload->>'id')::uuid and brand_id=p_brand for update;
   if f.id is null or f.revision is distinct from p_revision then raise exception 'FAQ changed. Reload before saving.';end if;
   update public.marketing_inbox_faqs set revision=revision+1,question=p_payload->>'question',answer=p_payload->>'answer',language=p_payload->>'language',reference_keys=array(select jsonb_array_elements_text(p_payload->'reference_keys')),knowledge_revision=k.revision,status='draft',approved_by=null,updated_at=now() where id=f.id returning * into f;
  else
   if (select count(*) from public.marketing_inbox_faqs where brand_id=p_brand)>=100 then raise exception 'Review existing FAQs before adding more.';end if;
   insert into public.marketing_inbox_faqs(brand_id,question,answer,language,reference_keys,knowledge_revision,created_by) values(p_brand,p_payload->>'question',p_payload->>'answer',p_payload->>'language',array(select jsonb_array_elements_text(p_payload->'reference_keys')),k.revision,actor) returning * into f;
  end if;result:=to_jsonb(f);
 elsif p_command in ('approve_faq','reject_faq') then
  select * into f from public.marketing_inbox_faqs where id=(p_payload->>'id')::uuid and brand_id=p_brand for update;
  if f.id is null or f.revision is distinct from p_revision or f.status<>'draft' or f.knowledge_revision is distinct from k.revision then raise exception 'FAQ or knowledge changed.';end if;
  if p_command='approve_faq' and cardinality(marketing_private.inbox_risk(f.question||' '||f.answer))>0 then raise exception 'Sensitive FAQs require human handling.';end if;
  update public.marketing_inbox_faqs set status=case p_command when 'approve_faq' then 'approved' else 'rejected' end,approved_by=actor,updated_at=now() where id=f.id returning to_jsonb(marketing_inbox_faqs) into result;
 else raise exception 'Configuration command unavailable.';end if;
 insert into public.marketing_requests values(p_request,actor,fp,result);
 insert into public.marketing_events(organization_id,brand_id,action,actor_employee_id,details) values(org,p_brand,'inbox_'||p_command,actor,jsonb_build_object('request_id',p_request,'revision',p_revision));
 return result;
end;$$;

create or replace function public.marketing_inbox_ai_prepare(p_request uuid,p_conversation uuid,p_version integer,p_kind text) returns jsonb language plpgsql security definer set search_path=public as $$
declare c public.marketing_conversations; actor uuid; k integer; fp text; r marketing_private.inbox_ai_runs;
begin
 select * into c from public.marketing_conversations where id=p_conversation for share;
 perform 1 from public.brands where id=c.brand_id for share;
 actor:=marketing_private.require_access(c.organization_id,c.brand_id,'marketing_inbox.ai');
 if p_request is null or coalesce(p_kind,'') not in ('reply','summary','faq') or c.version is distinct from p_version then raise exception 'Reload current conversation before requesting AI.';end if;
 if not exists(select 1 from public.marketing_inbox_policies where brand_id=c.brand_id and ai_allowed) then raise exception 'Brand AI consent is disabled.';end if;
 select revision into k from public.marketing_knowledge where brand_id=c.brand_id;
 if not exists(select 1 from public.marketing_inbox_knowledge where brand_id=c.brand_id and knowledge_revision=k) then raise exception 'Approve current Brand Knowledge first.';end if;
 fp:=encode(extensions.digest(jsonb_build_array(c.id,c.version,k,p_kind)::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));select * into r from marketing_private.inbox_ai_runs where request_id=p_request;
 if r.request_id is not null then if r.actor_employee_id<>actor or r.fingerprint<>fp then raise exception 'AI request identity changed.';end if;return jsonb_build_object('state',r.state,'artifact_id',r.artifact_id);end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text,2));
 if (select count(*) from marketing_private.inbox_ai_runs where actor_employee_id=actor and created_at>now()-interval '24 hours')>=20 then raise exception 'Daily AI request limit reached.';end if;
 insert into marketing_private.inbox_ai_runs(request_id,conversation_id,actor_employee_id,fingerprint,source_version,knowledge_revision,kind) values(p_request,c.id,actor,fp,c.version,k,p_kind);
 return jsonb_build_object('state','prepared');
end;$$;

create or replace function public.marketing_inbox_ai_finish(p_request uuid,p_lease uuid,p_body jsonb,p_model text,p_input integer,p_output integer,p_error boolean default false) returns jsonb language plpgsql security definer set search_path=public as $$
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
 select profile into facts from public.marketing_inbox_knowledge where brand_id=c.brand_id and knowledge_revision=r.knowledge_revision;
 if jsonb_typeof(p_body) is distinct from 'object' or octet_length(p_body::text)>12000 or length(trim(coalesce(p_body->>'text',''))) not between 1 and 4000 or jsonb_typeof(p_body->'reference_keys') is distinct from 'array' or exists(select 1 from jsonb_array_elements_text(p_body->'reference_keys') x where not facts ? x) or jsonb_array_length(p_body->'reference_keys')>9 or jsonb_typeof(p_body->'human_required') is distinct from 'boolean' or length(coalesce(p_body->>'question',''))>500 or coalesce(p_body->>'language','') not in ('EN','ZH','BM') or p_input<0 or p_output<0 or length(p_model)>100 then raise exception 'AI evidence invalid.';end if;
 if r.kind in ('reply','faq') and jsonb_array_length(p_body->'reference_keys')=0 and not coalesce((p_body->>'human_required')::boolean,false) then raise exception 'Reply facts require citations.';end if;
 if cardinality(marketing_private.inbox_risk(p_body->>'text'))>0 or coalesce((p_body->>'human_required')::boolean,false) then
  update public.marketing_conversations set takeover=true,priority='urgent',escalation_reasons=array(select distinct unnest(escalation_reasons||array['uncertain'])),version=version+1,updated_at=now() where id=c.id returning * into c;
 end if;
 insert into public.marketing_inbox_ai_artifacts(conversation_id,source_version,knowledge_revision,kind,body,model,input_tokens,output_tokens,created_by) values(c.id,c.version,r.knowledge_revision,r.kind,p_body,p_model,p_input,p_output,r.actor_employee_id) returning * into a;
 update marketing_private.inbox_ai_runs set state='completed',artifact_id=a.id where request_id=p_request;
 insert into public.marketing_events(organization_id,brand_id,action,actor_employee_id,details) values(c.organization_id,c.brand_id,'inbox_ai_proposed',r.actor_employee_id,jsonb_build_object('artifact_id',a.id,'kind',a.kind,'model',p_model,'input_tokens',p_input,'output_tokens',p_output,'cost_available',false));
 return jsonb_build_object('state','completed','artifact_id',a.id);
end;$$;

create or replace function public.marketing_inbox_review_ai(p_artifact uuid,p_approve boolean) returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.marketing_inbox_ai_artifacts; c public.marketing_conversations; actor uuid; d public.marketing_reply_drafts; f public.marketing_inbox_faqs;
begin
 -- Match the worker's conversation -> artifact lock order.
 select c0.* into c from public.marketing_conversations c0 join public.marketing_inbox_ai_artifacts a0 on a0.conversation_id=c0.id where a0.id=p_artifact for update of c0;
 perform 1 from public.brands where id=c.brand_id for share;
 actor:=marketing_private.require_access(c.organization_id,c.brand_id,'marketing_inbox.approve');
 select * into a from public.marketing_inbox_ai_artifacts where id=p_artifact for update;
 if p_approve is null then raise exception 'Choose approve or reject.';end if;
 if a.state<>'proposed' then return to_jsonb(a);end if;
 if c.version<>a.source_version or not exists(select 1 from public.marketing_knowledge where brand_id=c.brand_id and revision=a.knowledge_revision) then raise exception 'AI proposal evidence changed. Request a fresh suggestion.';end if;
 if p_approve then
  if a.kind='summary' then update public.marketing_conversations set summary=a.body->>'text',summary_version=c.version where id=c.id;
  elsif a.kind='reply' then insert into public.marketing_reply_drafts(conversation_id,body,source_version,knowledge_revision,provenance,source_references,created_by) values(c.id,a.body->>'text',c.version,a.knowledge_revision,'ai_suggestion',a.body->'reference_keys',actor) returning * into d;
  elsif a.kind='faq' then
   if cardinality(marketing_private.inbox_risk(coalesce(a.body->>'question','')||' '||(a.body->>'text')))>0 or coalesce((a.body->>'human_required')::boolean,true) then raise exception 'Sensitive FAQ needs human handling.';end if;
   if (select count(*) from public.marketing_inbox_faqs where brand_id=c.brand_id)>=100 then raise exception 'FAQ limit reached.';end if;
   insert into public.marketing_inbox_faqs(brand_id,question,answer,language,reference_keys,knowledge_revision,created_by) values(c.brand_id,a.body->>'question',a.body->>'text',a.body->>'language',array(select jsonb_array_elements_text(a.body->'reference_keys')),a.knowledge_revision,actor) returning * into f;
  end if;
 end if;
 update public.marketing_inbox_ai_artifacts set state=case when p_approve then 'approved' else 'rejected' end,reviewed_by=actor where id=a.id returning * into a;
 insert into public.marketing_events(organization_id,brand_id,action,actor_employee_id,details) values(c.organization_id,c.brand_id,'inbox_ai_reviewed',actor,jsonb_build_object('artifact_id',a.id,'state',a.state,'draft_id',d.id,'faq_id',f.id));
 return to_jsonb(a);
end;$$;

create or replace function public.marketing_inbox_faq_preview(p_conversation uuid,p_text text) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare c public.marketing_conversations; actor uuid; k public.marketing_knowledge; f public.marketing_inbox_faqs; mode text;
begin
 select * into c from public.marketing_conversations where id=p_conversation;actor:=marketing_private.require_access(c.organization_id,c.brand_id,'marketing_inbox.reply');
 if length(trim(coalesce(p_text,''))) not between 1 and 500 then raise exception 'Provide a bounded FAQ question.';end if;
 if cardinality(marketing_private.inbox_risk(p_text))>0 or cardinality(c.escalation_reasons)>0 then return jsonb_build_object('state','escalate','sending_enabled',false);end if;
 select automation_mode into mode from public.marketing_inbox_policies where brand_id=c.brand_id;
 if coalesce(mode,'off')='off' then return jsonb_build_object('state','off','sending_enabled',false);end if;
 select * into k from public.marketing_knowledge where brand_id=c.brand_id;
 select * into f from public.marketing_inbox_faqs where brand_id=c.brand_id and status='approved' and knowledge_revision=k.revision and lower(regexp_replace(trim(question),'\s+',' ','g'))=lower(regexp_replace(trim(p_text),'\s+',' ','g')) order by updated_at desc limit 1;
 return jsonb_build_object('state',case when f.id is null then 'human_required' when c.takeover then 'human_takeover' when c.channel<>'internal' and (c.last_inbound_at is null or c.last_inbound_at+interval '24 hours'<=now()) then 'window_closed' else 'faq_ready' end,'faq',case when f.id is not null then to_jsonb(f) end,'sending_enabled',false);
end;$$;

create or replace function public.marketing_inbox_process_events(p_limit integer default 20) returns jsonb language plpgsql security definer set search_path=public as $$
declare ev marketing_private.inbox_events; conn public.marketing_connections; c public.marketing_conversations; item jsonb; risks text[]; inserted uuid; processed integer:=0; blocked integer:=0; failed integer:=0; f public.marketing_inbox_faqs; mode text;
begin
 if auth.role()<>'service_role' then raise exception 'Service only.';end if;
 if p_limit is null or p_limit not between 1 and 50 then raise exception 'Invalid drain limit.';end if;
 for ev in select * from marketing_private.inbox_events where state in ('pending','retry') and due_at<=now() order by due_at,event_key limit p_limit for update skip locked loop
  begin
   select * into conn from public.marketing_connections where id=ev.connection_id for share;
   if conn.credential_generation<>ev.generation or not (marketing_private.inbox_channel(conn.id)->>'receiving_verified')::boolean then
    update marketing_private.inbox_events set state='blocked',error_code='messaging_authorization_unverified',attempts=attempts+1 where event_key=ev.event_key;blocked:=blocked+1;continue;
   end if;
   perform 1 from public.brands where id=conn.brand_id for share;
   item:=ev.payload;
   -- Echo/receipt-only events cannot manufacture a new customer conversation.
   select * into c from public.marketing_conversations where connection_id=conn.id and participant_key=item->>'peer_id' for update;
   if c.id is null and item->>'kind' in ('incoming','attachment') then
    insert into public.marketing_conversations(organization_id,brand_id,channel,connection_id,participant_key,title)
    values(conn.organization_id,conn.brand_id,conn.channel,conn.id,item->>'peer_id',conn.account_name||' conversation') on conflict(connection_id,participant_key) do nothing;
    select * into c from public.marketing_conversations where connection_id=conn.id and participant_key=item->>'peer_id' for update;
   end if;
   if c.id is not null then
    inserted:=null;
    insert into public.marketing_conversation_messages(conversation_id,kind,body,provider_message_id,occurred_at,delivery_state)
    values(c.id,item->>'kind',coalesce(item->>'body',''),item->>'event_id',(item->>'occurred_at')::timestamptz,case item->>'kind' when 'delivery' then 'delivered' when 'read' then 'read' else 'observed' end) on conflict do nothing returning id into inserted;
    if inserted is not null then
     risks:=marketing_private.inbox_risk(item->>'body');
     update public.marketing_conversations set version=version+1,updated_at=now(),
      last_inbound_at=case when item->>'kind' in ('incoming','attachment') then greatest(last_inbound_at,(item->>'occurred_at')::timestamptz) else last_inbound_at end,
      status=case when item->>'kind' in ('incoming','attachment') then 'open' else status end,
      escalation_reasons=array(select distinct unnest(escalation_reasons||risks)),priority=case when cardinality(risks)>0 then 'urgent' else priority end,takeover=takeover or cardinality(risks)>0 where id=c.id returning * into c;
     if item->>'kind' in ('incoming','attachment') and cardinality(c.escalation_reasons)=0 then
      select automation_mode into mode from public.marketing_inbox_policies where brand_id=c.brand_id;
      if coalesce(mode,'off')<>'off' and not c.takeover then
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
