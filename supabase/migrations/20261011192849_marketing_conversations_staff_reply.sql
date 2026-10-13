-- Conversations projection and staff-confirmed replies. External execution gates remain unchanged.
alter table public.marketing_reply_drafts add column staff_confirmed boolean not null default false;
alter table public.marketing_inbox_policies add column staff_reply_requires_approval boolean not null default false;

create function marketing_private.inbox_needs_reply(p_conversation uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.marketing_conversations c where c.id=p_conversation and c.channel<>'internal' and c.status<>'resolved' and not c.opted_out
 and exists(select 1 from public.marketing_conversation_messages m where m.conversation_id=c.id and m.kind in ('incoming','attachment'))
 and (select max(m.occurred_at) from public.marketing_conversation_messages m where m.conversation_id=c.id and m.kind in ('incoming','attachment')) > greatest(
 coalesce((select max(m.occurred_at) from public.marketing_conversation_messages m where m.conversation_id=c.id and m.kind='echo'),'-infinity'::timestamptz),
 coalesce((select max(o.sent_at) from public.marketing_reply_outbox o join public.marketing_reply_drafts d on d.id=o.draft_id where d.conversation_id=c.id and o.state in ('sent','delivered','read') and o.provider_message_id is not null),'-infinity'::timestamptz)));
$$;
create function marketing_private.inbox_reply_review_required(p_conversation uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select coalesce((select cardinality(c.escalation_reasons)>0 or coalesce(p.staff_reply_requires_approval,false) or exists(select 1 from public.marketing_inbox_ai_artifacts a where a.conversation_id=c.id and a.source_version=c.version and a.kind='reply' and a.state in ('proposed','approved') and coalesce((a.body->>'human_required')::boolean,false)) from public.marketing_conversations c left join public.marketing_inbox_policies p on p.brand_id=c.brand_id where c.id=p_conversation),true);
$$;
create function public.marketing_inbox_reply_count(p_org uuid default null,p_brand uuid default null) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=marketing_private.actor(); n integer;
begin
 if not public.current_user_has_permission('marketing_workspace.access') or not public.current_user_has_permission('marketing_inbox.view') then raise exception using errcode='42501',message='Conversation access unavailable.';end if;
 if p_brand is not null and p_org is null then raise exception 'Organization is required for brand scope.';end if;
 if p_org is not null then perform marketing_private.require_access(p_org,p_brand,'marketing_inbox.view');end if;
 select count(*) into n from public.marketing_conversations c where (p_org is null or c.organization_id=p_org) and (p_brand is null or c.brand_id=p_brand)
 and marketing_private.actor_allowed(actor,c.organization_id,c.brand_id,'marketing_inbox.view') and marketing_private.inbox_needs_reply(c.id);
 return jsonb_build_object('needs_reply',n);
end;$$;

-- Reuses the canonical immutable draft/outbox and Send authority. Staff confirmation is not AI automation.
create function public.marketing_inbox_prepare_staff_reply(p_request uuid,p_conversation uuid,p_version integer,p_body text,p_artifact uuid default null) returns jsonb
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
 if exists(select 1 from public.marketing_reply_outbox o join public.marketing_reply_drafts d on d.id=o.draft_id where d.conversation_id=c.id and (o.state in ('prepared','pending','reconciling') or (d.source_version=c.version and d.body=p_body and o.execution_request is not null))) then raise exception 'A reply is already in progress or recorded. Check its result.';end if;
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
revoke all on function marketing_private.inbox_needs_reply(uuid),marketing_private.inbox_reply_review_required(uuid) from public,anon,authenticated;
revoke all on function public.marketing_inbox_reply_count(uuid,uuid),public.marketing_inbox_prepare_staff_reply(uuid,uuid,integer,text,uuid) from public,anon;
grant execute on function public.marketing_inbox_reply_count(uuid,uuid),public.marketing_inbox_prepare_staff_reply(uuid,uuid,integer,text,uuid) to authenticated;

-- Presentation read models only. Existing authorization, records and execution remain canonical.
create or replace function public.marketing_inbox_read(p_org uuid,p_brand uuid default null,p_status text default '',p_channel text default '',p_search text default '',p_page integer default 1,p_size integer default 20,p_assignee text default '',p_unread boolean default false) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=marketing_private.require_access(p_org,p_brand,'marketing_inbox.view'); rows jsonb; total integer; channels jsonb; members jsonb; policy jsonb; faqs jsonb; knowledge jsonb; usage jsonb;
begin
 if p_page is null or p_size is null or p_page<1 or p_size not between 1 and 100 or p_status is null or p_channel is null or p_search is null or p_assignee is null or p_unread is null or (p_assignee not in ('','me','unassigned') and p_assignee !~ '^[0-9a-fA-F-]{36}$') or length(p_search)>100 or p_status not in ('','open','pending','resolved') or p_channel not in ('','social','internal','facebook','instagram') then raise exception 'Invalid Inbox filters.';end if;
 select count(*) into total from public.marketing_conversations c where c.organization_id=p_org and (p_brand is null or c.brand_id=p_brand) and marketing_private.brand_allowed(p_org,c.brand_id)
 and (p_status='' or c.status=p_status) and (p_channel='' or (p_channel='social' and c.channel<>'internal') or c.channel=p_channel) and (p_search='' or position(lower(p_search) in lower(c.title))>0 or exists(select 1 from public.marketing_conversation_messages m where m.conversation_id=c.id and m.kind in ('incoming','echo','attachment','note') and position(lower(p_search) in lower(m.body))>0)) and (p_assignee='' or (p_assignee='me' and c.assigned_to=actor) or (p_assignee='unassigned' and c.assigned_to is null) or c.assigned_to::text=p_assignee) and (not p_unread or marketing_private.inbox_unread(c.id,actor)>0);
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into rows from (
 select c.id,c.organization_id,c.brand_id,b.name brand_name,c.channel,c.title,c.status,c.priority,c.assigned_to,c.tags,c.takeover,c.escalation_reasons,c.version,c.last_inbound_at,c.updated_at,c.medium,c.intent,c.language,c.opted_out,marketing_private.inbox_needs_reply(c.id) needs_reply,latest.body latest_message,latest.kind latest_message_kind,latest.occurred_at latest_message_at,e.full_name assignee_name,marketing_private.inbox_unread(c.id,actor) unread_count
 from public.marketing_conversations c join public.brands b on b.id=c.brand_id left join public.employees e on e.id=c.assigned_to left join lateral (select last_message.body,last_message.kind,last_message.occurred_at from (select m.body,m.kind,m.occurred_at,m.id from public.marketing_conversation_messages m where m.conversation_id=c.id and m.kind in ('incoming','echo','attachment','note') union all select d.body,'echo',o.sent_at,d.id from public.marketing_reply_outbox o join public.marketing_reply_drafts d on d.id=o.draft_id where d.conversation_id=c.id and o.state in ('sent','delivered','read') and o.provider_message_id is not null and o.sent_at is not null and not exists(select 1 from public.marketing_conversation_messages m where m.conversation_id=c.id and m.kind='echo' and m.provider_message_id=o.provider_message_id)) last_message order by last_message.occurred_at desc,last_message.id desc limit 1) latest on true where c.organization_id=p_org and (p_brand is null or c.brand_id=p_brand) and marketing_private.brand_allowed(p_org,c.brand_id)
 and (p_status='' or c.status=p_status) and (p_channel='' or (p_channel='social' and c.channel<>'internal') or c.channel=p_channel) and (p_search='' or position(lower(p_search) in lower(c.title))>0 or exists(select 1 from public.marketing_conversation_messages m where m.conversation_id=c.id and m.kind in ('incoming','echo','attachment','note') and position(lower(p_search) in lower(m.body))>0)) and (p_assignee='' or (p_assignee='me' and c.assigned_to=actor) or (p_assignee='unassigned' and c.assigned_to is null) or c.assigned_to::text=p_assignee) and (not p_unread or marketing_private.inbox_unread(c.id,actor)>0) order by c.updated_at desc,c.id limit p_size offset (p_page-1)*p_size)x;
 select coalesce(jsonb_agg(marketing_private.inbox_channel(c.id)||jsonb_build_object('comments',marketing_private.inbox_comment_channel(c.id))),'[]') into channels from public.marketing_connections c where c.organization_id=p_org and (p_brand is null or c.brand_id=p_brand) and marketing_private.brand_allowed(p_org,c.brand_id);
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',e.full_name) order by e.full_name),'[]') into members from public.organization_memberships m join public.employees e on e.id=m.employee_id
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
 return jsonb_build_object('needs_reply',(public.marketing_inbox_reply_count(p_org,p_brand)->'needs_reply'),'ai_usage',usage,'rows',rows,'total',total,'channels',channels,'members',members,'policy',coalesce(policy,'{"revision":0,"automation_mode":"suggest","ai_allowed":false}'),'faqs',coalesce(faqs,'[]'),'knowledge',knowledge,'external_execution_enabled',false);
end;$$;

create or replace function public.marketing_inbox_detail(p_conversation uuid,p_page integer default 1,p_size integer default 30) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare c public.marketing_conversations; actor uuid; messages jsonb; total integer; drafts jsonb; artifacts jsonb; members jsonb; audit_messages jsonb;
begin
 select * into c from public.marketing_conversations where id=p_conversation;if c.id is null then raise exception 'Conversation unavailable.';end if;
 actor:=marketing_private.require_access(c.organization_id,c.brand_id,'marketing_inbox.view');
 if p_page is null or p_size is null or p_page<1 or p_size not between 1 and 50 then raise exception 'Invalid history page.';end if;
 with timeline as (
 select to_jsonb(m)||jsonb_build_object('actor_name',e.full_name,'send_state',o.state) val,m.occurred_at,m.id
 from public.marketing_conversation_messages m left join public.employees e on e.id=m.actor_employee_id
 left join lateral (select o.state from public.marketing_reply_outbox o join public.marketing_reply_drafts d on d.id=o.draft_id where d.conversation_id=c.id and m.kind='echo' and o.provider_message_id=m.provider_message_id order by o.sent_at desc limit 1) o on true
 where m.conversation_id=c.id and m.kind in ('incoming','echo','attachment','note')
 union all
 select jsonb_build_object('id',d.id,'kind','echo','body',d.body,'provider_message_id',o.provider_message_id,'occurred_at',o.sent_at,'send_state',o.state),o.sent_at,d.id
 from public.marketing_reply_outbox o join public.marketing_reply_drafts d on d.id=o.draft_id where d.conversation_id=c.id and o.state in ('sent','delivered','read') and o.provider_message_id is not null and o.sent_at is not null
 and not exists(select 1 from public.marketing_conversation_messages m where m.conversation_id=c.id and m.kind='echo' and m.provider_message_id=o.provider_message_id)
 ) select count(*) into total from timeline;
 with timeline as (
 select to_jsonb(m)||jsonb_build_object('actor_name',e.full_name,'send_state',o.state) val,m.occurred_at,m.id
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
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',e.full_name) order by e.full_name),'[]') into members from public.organization_memberships m join public.employees e on e.id=m.employee_id
 where m.organization_id=c.organization_id and marketing_private.actor_allowed(e.id,c.organization_id,c.brand_id,'marketing_inbox.view');
 select coalesce(jsonb_agg(to_jsonb(x) order by x.occurred_at,x.id),'[]') into audit_messages from (select * from public.marketing_conversation_messages where conversation_id=c.id and kind in ('delivery','read') order by occurred_at desc,id desc limit 50) x;
 return jsonb_build_object('reply_requires_approval',marketing_private.inbox_reply_review_required(c.id),'reply_authority',(select jsonb_build_object('verified',coalesce(a.send_verified and a.webhook_verified and a.generation=conn.credential_generation and c.connection_generation=conn.credential_generation and conn.status='test_authorized' and conn.expires_at>now(),false),'recent',coalesce(a.verified_at>now()-interval '1 hour',false)) from public.marketing_connections conn left join marketing_private.inbox_authority a on a.connection_id=conn.id where conn.id=c.connection_id),'timeline_projected',true,'audit_messages',audit_messages,'conversation',to_jsonb(c)-'participant_key','messages',messages,'total',total,'drafts',drafts,'artifacts',artifacts,'members',members,
 'window_expires_at',c.last_inbound_at+interval '24 hours','window_open',c.medium='dm' and not c.opted_out and c.last_inbound_at+interval '24 hours'>now(),'channel_capability',marketing_private.inbox_channel(c.connection_id),'sending_enabled',false,'read_through_sequence',(select coalesce(max(sequence),0) from public.marketing_conversation_messages where conversation_id=c.id),'unread_count',marketing_private.inbox_unread(c.id,actor),'outbox',(select coalesce(jsonb_agg(to_jsonb(o)-'lease'),'[]') from public.marketing_reply_outbox o join public.marketing_reply_drafts d on d.id=o.draft_id where d.conversation_id=c.id));
end;$$;


revoke all on function public.marketing_inbox_read(uuid,uuid,text,text,text,integer,integer,text,boolean),public.marketing_inbox_detail(uuid,integer,integer) from public,anon;
grant execute on function public.marketing_inbox_read(uuid,uuid,text,text,text,integer,integer,text,boolean),public.marketing_inbox_detail(uuid,integer,integer) to authenticated;


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
  insert into public.marketing_inbox_policies(brand_id,automation_mode,ai_allowed,updated_by,staff_reply_requires_approval) values(p_brand,p_payload->>'automation_mode',(p_payload->>'ai_allowed')::boolean,actor,coalesce((p_payload->>'staff_reply_requires_approval')::boolean,policy.staff_reply_requires_approval,false))
   on conflict(brand_id) do update set revision=marketing_inbox_policies.revision+1,automation_mode=excluded.automation_mode,ai_allowed=excluded.ai_allowed,staff_reply_requires_approval=excluded.staff_reply_requires_approval,updated_by=actor,updated_at=now() returning to_jsonb(marketing_inbox_policies) into result;
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


-- Private recipient/account material for the edge's existing exact test allowlist. No peer identifier reaches the client.
create function public.marketing_inbox_staff_send_scope(p_conversation uuid,p_auth_user uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare c public.marketing_conversations; actor uuid;
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='Service only.';end if;
 select * into c from public.marketing_conversations where id=p_conversation;
 select id into actor from public.employees where auth_user_id=p_auth_user;
 if actor is null or c.id is null or not marketing_private.actor_allowed(actor,c.organization_id,c.brand_id,'marketing_inbox.view') then raise exception using errcode='42501',message='Conversation access unavailable.';end if;
 return jsonb_build_object('peer',c.participant_key,'account',(select provider_account_id from public.marketing_connections where id=c.connection_id));
end;$$;
revoke all on function public.marketing_inbox_staff_send_scope(uuid,uuid) from public,anon,authenticated;
grant execute on function public.marketing_inbox_staff_send_scope(uuid,uuid) to service_role;

create or replace function public.marketing_inbox_send_material(p_draft uuid,p_auth_user uuid) returns jsonb language plpgsql security definer set search_path=public as $$
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
  (d.knowledge_revision is not null and not exists(select 1 from public.marketing_knowledge where brand_id=c.brand_id and revision=d.knowledge_revision))) then raise exception 'Messaging authority changed.';end if;
 select to_jsonb(conn)||jsonb_build_object('sealed_token',s.sealed_token,'meta_user_id',s.meta_user_id) into v from marketing_private.credentials s where s.connection_id=conn.id;
 return jsonb_build_object('connection',v,'recipient',c.participant_key,'text',d.body,'state',o.state,'receipt',o.provider_message_id,'lease',o.lease,'authority',jsonb_build_object('execution_enabled',true,'send_verified',a.send_verified,'webhook_verified',a.webhook_verified,'exact_authorizer_verified',a.send_verified,'page_tasks',array['MESSAGE'],'granted_scopes',a.granted_scopes,'last_inbound_at',c.last_inbound_at,'page_id',a.page_id,'opted_out',c.opted_out,'medium',c.medium));
end;$$;


