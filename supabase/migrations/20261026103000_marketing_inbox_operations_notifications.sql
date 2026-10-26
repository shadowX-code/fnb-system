-- Scoped release: queue/handling read projections and opt-in sound evidence only.
-- No command, assignment, consent, AI send, provider, scheduler or history rewrite.
do $baseline$ begin
 if to_regprocedure('public.marketing_inbox_read(uuid,uuid,text,text,text,integer,integer,text,boolean,text)') is not null
  or to_regprocedure('marketing_private.inbox_handoff_context(uuid)') is not null
  or to_regprocedure('marketing_private.inbox_handoff_needed(uuid)') is not null
  or to_regprocedure('marketing_private.inbox_handoff_observed()') is not null
  or to_regclass('public.marketing_events_inbox_handoff_identity') is not null
  or to_regclass('public.marketing_messages_sound_candidates') is not null then
  raise exception 'Inbox release objects already exist; reconcile instead of overwriting';
 end if;
 if md5(pg_get_functiondef('public.marketing_inbox_read(uuid,uuid,text,text,text,integer,integer,text,boolean)'::regprocedure))<>'6c5e9b6e8f20a63ad126eff5be734e47' then raise exception 'Inbox release baseline differs: marketing_inbox_read';end if;
 if md5(pg_get_functiondef('public.marketing_inbox_detail(uuid,integer,integer)'::regprocedure))<>'be285541d7a9cde4fdf105095c8d5558' then raise exception 'Inbox release baseline differs: marketing_inbox_detail';end if;
 if md5(pg_get_functiondef('public.marketing_inbox_reply_count(uuid,uuid)'::regprocedure))<>'5c786435281c58a4bb1a2ed34f7d97e2' then raise exception 'Inbox release baseline differs: marketing_inbox_reply_count';end if;
 if md5(pg_get_functiondef('marketing_private.inbox_needs_reply(uuid)'::regprocedure))<>'0ea7e942f6cbc2886ef60020434dc90f' then raise exception 'Inbox release baseline differs: inbox_needs_reply';end if;
 if md5(pg_get_functiondef('marketing_private.inbox_auto_issue(marketing_conversations,marketing_inbox_policies)'::regprocedure))<>'615a9b328b37cdc898cec86d78c8a26a' then raise exception 'Inbox release baseline differs: inbox_auto_issue';end if;
 if md5(pg_get_functiondef('marketing_private.inbox_auto_handoff(uuid,text)'::regprocedure))<>'3a4f35b2f159e38304a0c65d9d6edb68' then raise exception 'Inbox release baseline differs: inbox_auto_handoff';end if;
 if md5(pg_get_functiondef('marketing_private.inbox_outlet_context(uuid)'::regprocedure))<>'4b1a97c59619d352451e95191c1fd7cf' then raise exception 'Inbox release baseline differs: inbox_outlet_context';end if;
end;$baseline$;

create or replace function marketing_private.inbox_handoff_context(p_conversation uuid) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('reason',t.reason,'summary',t.summary,'updated_at',t.updated_at) from marketing_conversations c join marketing_private.inbox_automatic_turns t on t.conversation_id=c.id
 where c.id=p_conversation and c.status<>'resolved' and c.takeover and t.summary is not null
 and t.updated_at>coalesce((select max(e.created_at) from marketing_events e where e.organization_id=c.organization_id and e.brand_id=c.brand_id and e.action='inbox_resume_ai' and e.details->>'conversation_id'=c.id::text),'-infinity'::timestamptz)
 order by t.updated_at desc,t.id desc limit 1;
$$;
revoke all on function marketing_private.inbox_handoff_context(uuid) from public,anon,authenticated,service_role;

create or replace function marketing_private.inbox_handoff_needed(p_conversation uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from marketing_conversations c where c.id=p_conversation and c.status<>'resolved' and (
  cardinality(c.escalation_reasons)>0 or marketing_private.inbox_handoff_context(c.id) is not null or exists(select 1 from marketing_inbox_ai_artifacts a where a.conversation_id=c.id and a.source_version=c.version and a.state='proposed' and a.body->>'classification'='needs_human_attention')));
$$;
revoke all on function marketing_private.inbox_handoff_needed(uuid) from public,anon,authenticated,service_role;

drop function if exists public.marketing_inbox_read(uuid,uuid,text,text,text,integer,integer,text,boolean);
CREATE OR REPLACE FUNCTION public.marketing_inbox_read(p_org uuid, p_brand uuid DEFAULT NULL::uuid, p_status text DEFAULT ''::text, p_channel text DEFAULT ''::text, p_search text DEFAULT ''::text, p_page integer DEFAULT 1, p_size integer DEFAULT 20, p_assignee text DEFAULT ''::text, p_unread boolean DEFAULT false, p_view text DEFAULT 'all'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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
 select c.id,marketing_private.inbox_handoff_needed(c.id) ai_handoff,marketing_private.inbox_profile(c.id) customer_profile,c.organization_id,c.brand_id,b.name brand_name,c.channel,c.title,c.status,c.priority,c.assigned_to,c.tags,c.takeover,c.escalation_reasons,c.version,c.last_inbound_at,c.updated_at,c.pending_since,c.status_changed_at,coalesce(c.last_activity_at,latest.occurred_at,c.created_at) last_activity_at,c.resolution_hold,c.medium,c.intent,c.language,c.opted_out,marketing_private.inbox_needs_reply(c.id) needs_reply,latest.body latest_message,latest.kind latest_message_kind,latest.occurred_at latest_message_at,coalesce(nullif(btrim(e.nickname),''),e.full_name) assignee_name,marketing_private.inbox_unread(c.id,actor) unread_count
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


-- Preserve Production provider_context redaction and exact timeline ordering.
CREATE OR REPLACE FUNCTION public.marketing_inbox_detail(p_conversation uuid, p_page integer DEFAULT 1, p_size integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare c public.marketing_conversations; actor uuid; messages jsonb; total integer; drafts jsonb; artifacts jsonb; members jsonb; audit_messages jsonb; assistant_hash text;
begin
 select * into c from public.marketing_conversations where id=p_conversation;if c.id is null then raise exception 'Conversation unavailable.';end if;
 actor:=marketing_private.require_access(c.organization_id,c.brand_id,'marketing_inbox.view');
 if p_page is null or p_size is null or p_page<1 or p_size not between 1 and 50 then raise exception 'Invalid history page.';end if;
 with timeline as (
 select (to_jsonb(m)-'provider_context')||jsonb_build_object('actor_name',coalesce(nullif(btrim(e.nickname),''),e.full_name),'send_state',coalesce(o.state,case when m.kind='echo' then marketing_private.provider_outbound_state(c.id,m.provider_message_id,m.occurred_at) end),'message_origin',case when m.kind='echo' and o.state is null then 'meta' when m.kind='echo' then 'feedx' end,'sender_type',case when m.kind='echo' and o.state is null then 'external_unknown' when m.kind='echo' and exists(select 1 from marketing_reply_outbox ob join marketing_reply_drafts dr on dr.id=ob.draft_id where dr.conversation_id=c.id and ob.provider_message_id=m.provider_message_id and ob.automatic_turn_id is not null) then 'feedx_ai' when m.kind='echo' then 'feedx_staff' end)||(case when c.channel='whatsapp' then marketing_private.whatsapp_message_state(m) else '{}'::jsonb end) val,m.occurred_at,m.id
 from public.marketing_conversation_messages m left join public.employees e on e.id=m.actor_employee_id
 left join lateral (select o.state from public.marketing_reply_outbox o join public.marketing_reply_drafts d on d.id=o.draft_id where d.conversation_id=c.id and m.kind='echo' and o.provider_message_id=m.provider_message_id order by o.sent_at desc limit 1) o on true
 where m.conversation_id=c.id and m.kind in ('incoming','echo','attachment','note')
 union all
 select jsonb_build_object('id',d.id,'kind','echo','body',d.body,'provider_message_id',o.provider_message_id,'occurred_at',o.sent_at,'send_state',o.state),o.sent_at,d.id
 from public.marketing_reply_outbox o join public.marketing_reply_drafts d on d.id=o.draft_id where d.conversation_id=c.id and o.state in ('sent','delivered','read') and o.provider_message_id is not null and o.sent_at is not null
 and not exists(select 1 from public.marketing_conversation_messages m where m.conversation_id=c.id and m.kind='echo' and m.provider_message_id=o.provider_message_id)
 ) select count(*) into total from timeline;
 with timeline as (
 select (to_jsonb(m)-'provider_context')||jsonb_build_object('actor_name',coalesce(nullif(btrim(e.nickname),''),e.full_name),'send_state',coalesce(o.state,case when m.kind='echo' then marketing_private.provider_outbound_state(c.id,m.provider_message_id,m.occurred_at) end),'message_origin',case when m.kind='echo' and o.state is null then 'meta' when m.kind='echo' then 'feedx' end,'sender_type',case when m.kind='echo' and o.state is null then 'external_unknown' when m.kind='echo' and exists(select 1 from marketing_reply_outbox ob join marketing_reply_drafts dr on dr.id=ob.draft_id where dr.conversation_id=c.id and ob.provider_message_id=m.provider_message_id and ob.automatic_turn_id is not null) then 'feedx_ai' when m.kind='echo' then 'feedx_staff' end)||(case when c.channel='whatsapp' then marketing_private.whatsapp_message_state(m) else '{}'::jsonb end) val,m.occurred_at,m.id
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
 select coalesce(jsonb_agg(to_jsonb(x)-'provider_context' order by x.occurred_at,x.id),'[]') into audit_messages from (select * from public.marketing_conversation_messages where conversation_id=c.id and kind in ('delivery','read') order by occurred_at desc,id desc limit 50) x;
 return jsonb_build_object('needs_human_attention',marketing_private.inbox_handoff_needed(c.id),'ai_handling',jsonb_build_object('handoff',marketing_private.inbox_handoff_context(c.id),'mode',coalesce((select ai_reply_mode from marketing_inbox_policies where brand_id=c.brand_id),'suggest_only'),'last_turn',(select jsonb_build_object('state',state,'reason',reason,'summary',summary,'updated_at',updated_at) from marketing_private.inbox_automatic_turns where conversation_id=c.id order by created_at desc limit 1)),'outlet_context',marketing_private.inbox_outlet_context(c.id),'ai_feedback',coalesce((select jsonb_agg(to_jsonb(f)-'actor_employee_id') from marketing_inbox_ai_feedback f join marketing_inbox_ai_artifacts a on a.id=f.artifact_id where a.conversation_id=c.id and f.actor_employee_id=actor),'[]'::jsonb),'outlet_options',(select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'name',o.name) order by o.name),'[]') from brand_outlets bo join outlets o on o.id=bo.outlet_id and o.is_active where bo.brand_id=c.brand_id),'knowledge',(select jsonb_build_object('revision',k.revision,'approved_for_replies',s.brand_id is not null) from public.marketing_knowledge k left join public.marketing_inbox_knowledge s on s.brand_id=k.brand_id and s.knowledge_revision=k.revision where k.brand_id=c.brand_id),'policy',coalesce((select to_jsonb(p) from public.marketing_inbox_policies p where p.brand_id=c.brand_id),'{"automation_mode":"suggest","ai_allowed":false}'::jsonb),'reply_requires_approval',marketing_private.inbox_reply_review_required(c.id),'reply_authority',(select jsonb_build_object('verified',coalesce(a.send_verified and a.webhook_verified and a.generation=conn.credential_generation and c.connection_generation=conn.credential_generation and conn.status='test_authorized' and conn.expires_at>now(),false),'recent',coalesce(a.verified_at>now()-interval '1 hour',false)) from public.marketing_connections conn left join marketing_private.inbox_authority a on a.connection_id=conn.id where conn.id=c.connection_id),'timeline_projected',true,'audit_messages',audit_messages,'conversation',(to_jsonb(c)-'participant_key')||jsonb_build_object('customer_profile',marketing_private.inbox_profile(c.id)),'messages',messages,'total',total,'drafts',drafts,'artifacts',artifacts,'members',members,
 'window_expires_at',c.last_inbound_at+interval '24 hours','window_open',c.medium='dm' and not c.opted_out and c.last_inbound_at+interval '24 hours'>now(),'channel_capability',marketing_private.inbox_channel(c.connection_id),'sending_enabled',false,'read_through_sequence',(select coalesce(max(sequence),0) from public.marketing_conversation_messages where conversation_id=c.id),'unread_count',marketing_private.inbox_unread(c.id,actor),'outbox',(select coalesce(jsonb_agg(to_jsonb(o)-'lease'),'[]') from public.marketing_reply_outbox o join public.marketing_reply_drafts d on d.id=o.draft_id where d.conversation_id=c.id));
end;$function$
;

-- Legacy single-message turns and newer batched turns share the same bounded sound projection.
-- Immutable, content-free handoff identity; no backfill and no change to AI execution/ownership.
create unique index if not exists marketing_events_inbox_handoff_identity
 on public.marketing_events ((details->>'turn_id')) where action='inbox_ai_handoff';
create or replace function marketing_private.inbox_handoff_observed() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 insert into public.marketing_events(organization_id,brand_id,action,actor_employee_id,details)
 select c.organization_id,c.brand_id,'inbox_ai_handoff',new.actor_employee_id,
  jsonb_build_object('conversation_id',c.id,'turn_id',new.id,'reason',left(new.reason,100))
 from public.marketing_conversations c where c.id=new.conversation_id
 on conflict ((details->>'turn_id')) where action='inbox_ai_handoff' do nothing;
 return new;
end;$$;
revoke all on function marketing_private.inbox_handoff_observed() from public,anon,authenticated,service_role;
create or replace trigger inbox_handoff_observed after update of summary on marketing_private.inbox_automatic_turns
 for each row when (old.summary is null and new.summary is not null)
 execute function marketing_private.inbox_handoff_observed();

-- Bound the recent-message projection without scanning retained conversation history.
create index if not exists marketing_messages_sound_candidates on public.marketing_conversation_messages(conversation_id,created_at desc)
 where kind in ('incoming','attachment') and evidence_source='signed_webhook';

create or replace function public.marketing_inbox_reply_count(p_org uuid default null,p_brand uuid default null) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare actor uuid:=marketing_private.actor(); at_ timestamptz:=statement_timestamp(); n integer; token text; events_ jsonb;
begin
 if not public.current_user_has_permission('marketing_workspace.access') or not public.current_user_has_permission('marketing_inbox.view') then
  raise exception using errcode='42501',message='Conversation access unavailable.';
 end if;
 if p_brand is not null and p_org is null then raise exception 'Organization is required for brand scope.';end if;
 if p_org is not null then perform marketing_private.require_access(p_org,p_brand,'marketing_inbox.view');end if;
 with scoped as not materialized (
  select c.* from public.marketing_conversations c
  where (p_org is null or c.organization_id=p_org) and (p_brand is null or c.brand_id=p_brand)
   and marketing_private.actor_allowed(actor,c.organization_id,c.brand_id,'marketing_inbox.view')
 ), recent_messages as materialized (
  select m.id,m.conversation_id,m.sequence,m.created_at,m.occurred_at
  from scoped c join public.marketing_conversation_messages m on m.conversation_id=c.id
  where m.kind in ('incoming','attachment') and m.evidence_source='signed_webhook' and m.provider_message_id is not null
   and m.created_at>at_-interval '2 minutes' and m.created_at<=at_
   and m.occurred_at>at_-interval '90 seconds' and m.occurred_at<=at_
  order by m.created_at desc,m.id desc limit 100
 ), activity as (
  select 'message:'||m.id id,'inbound' kind,c.id conversation_id,m.created_at,m.occurred_at,
   coalesce(not c.takeover and c.assigned_to is null and p.ai_reply_mode in ('safe_auto','ai_first')
    and marketing_private.inbox_auto_issue(c::public.marketing_conversations,p) is null and exists(
     select 1 from marketing_private.inbox_automatic_turns t join marketing_conversation_messages last_ on last_.id=t.message_id
     where t.conversation_id=c.id and t.state in ('queued','generating','prepared','pending')
      and m.sequence between coalesce((to_jsonb(t)->>'batch_first_sequence')::bigint,last_.sequence) and last_.sequence
      and not exists(select 1 from marketing_conversation_messages newer where newer.conversation_id=c.id and newer.kind in ('incoming','attachment') and newer.sequence>last_.sequence)),false) automatic_candidate
  from scoped c join recent_messages m on m.conversation_id=c.id
  left join public.marketing_inbox_policies p on p.brand_id=c.brand_id
  where marketing_private.inbox_needs_reply(c.id)
  union all
  select 'handoff:'||e.id,'handoff',c.id,e.created_at,e.created_at,false
  from scoped c join public.marketing_events e on e.organization_id=c.organization_id and e.brand_id=c.brand_id
   and e.details->>'conversation_id'=c.id::text
  join marketing_private.inbox_automatic_turns t on t.conversation_id=c.id and t.id::text=e.details->>'turn_id' and t.summary is not null
  where e.action='inbox_ai_handoff' and e.created_at>at_-interval '90 seconds' and e.created_at<=at_
   and marketing_private.inbox_handoff_needed(c.id)
   and not exists(select 1 from public.marketing_events r where r.organization_id=c.organization_id and r.brand_id=c.brand_id
    and r.action='inbox_resume_ai' and r.details->>'conversation_id'=c.id::text and r.created_at>=e.created_at)
 )
 select (select count(*) from scoped c where marketing_private.inbox_needs_reply(c.id)),
  (select count(*)::text||':'||coalesce(sum(c.version),0)::text||':'||coalesce(max(c.updated_at)::text,'') from scoped c),
  (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at,x.id),'[]') from
   (select * from activity order by created_at desc,id desc limit 100)x)
 into n,token,events_;
 return jsonb_build_object('needs_reply',n,'change_token',token,'observed_at',at_,'sound_events',events_);
end;$$;
revoke all on function public.marketing_inbox_reply_count(uuid,uuid) from public,anon;
grant execute on function public.marketing_inbox_reply_count(uuid,uuid) to authenticated;
notify pgrst,'reload schema';
