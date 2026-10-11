-- Presentation read models only. Existing authorization, records and execution remain canonical.
create or replace function public.marketing_inbox_read(p_org uuid,p_brand uuid default null,p_status text default '',p_channel text default '',p_search text default '',p_page integer default 1,p_size integer default 20,p_assignee text default '',p_unread boolean default false) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=marketing_private.require_access(p_org,p_brand,'marketing_inbox.view'); rows jsonb; total integer; channels jsonb; members jsonb; policy jsonb; faqs jsonb; knowledge jsonb; usage jsonb;
begin
 if p_page is null or p_size is null or p_page<1 or p_size not between 1 and 100 or p_status is null or p_channel is null or p_search is null or p_assignee is null or p_unread is null or (p_assignee not in ('','me','unassigned') and p_assignee !~ '^[0-9a-fA-F-]{36}$') or length(p_search)>100 or p_status not in ('','open','pending','resolved') or p_channel not in ('','social','internal','facebook','instagram') then raise exception 'Invalid Inbox filters.';end if;
 select count(*) into total from public.marketing_conversations c where c.organization_id=p_org and (p_brand is null or c.brand_id=p_brand) and marketing_private.brand_allowed(p_org,c.brand_id)
 and (p_status='' or c.status=p_status) and (p_channel='' or (p_channel='social' and c.channel<>'internal') or c.channel=p_channel) and (p_search='' or position(lower(p_search) in lower(c.title))>0 or exists(select 1 from public.marketing_conversation_messages m where m.conversation_id=c.id and m.kind in ('incoming','echo','attachment','note') and position(lower(p_search) in lower(m.body))>0)) and (p_assignee='' or (p_assignee='me' and c.assigned_to=actor) or (p_assignee='unassigned' and c.assigned_to is null) or c.assigned_to::text=p_assignee) and (not p_unread or marketing_private.inbox_unread(c.id,actor)>0);
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into rows from (
 select c.id,c.organization_id,c.brand_id,b.name brand_name,c.channel,c.title,c.status,c.priority,c.assigned_to,c.tags,c.takeover,c.escalation_reasons,c.version,c.last_inbound_at,c.updated_at,c.medium,c.intent,c.language,c.opted_out,latest.body latest_message,latest.kind latest_message_kind,latest.occurred_at latest_message_at,e.full_name assignee_name,marketing_private.inbox_unread(c.id,actor) unread_count
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
 return jsonb_build_object('ai_usage',usage,'rows',rows,'total',total,'channels',channels,'members',members,'policy',coalesce(policy,'{"revision":0,"automation_mode":"suggest","ai_allowed":false}'),'faqs',coalesce(faqs,'[]'),'knowledge',knowledge,'external_execution_enabled',false);
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
 return jsonb_build_object('timeline_projected',true,'audit_messages',audit_messages,'conversation',to_jsonb(c)-'participant_key','messages',messages,'total',total,'drafts',drafts,'artifacts',artifacts,'members',members,
 'window_expires_at',c.last_inbound_at+interval '24 hours','window_open',c.medium='dm' and not c.opted_out and c.last_inbound_at+interval '24 hours'>now(),'channel_capability',marketing_private.inbox_channel(c.connection_id),'sending_enabled',false,'read_through_sequence',(select coalesce(max(sequence),0) from public.marketing_conversation_messages where conversation_id=c.id),'unread_count',marketing_private.inbox_unread(c.id,actor),'outbox',(select coalesce(jsonb_agg(to_jsonb(o)-'lease'),'[]') from public.marketing_reply_outbox o join public.marketing_reply_drafts d on d.id=o.draft_id where d.conversation_id=c.id));
end;$$;


revoke all on function public.marketing_inbox_read(uuid,uuid,text,text,text,integer,integer,text,boolean),public.marketing_inbox_detail(uuid,integer,integer) from public,anon;
grant execute on function public.marketing_inbox_read(uuid,uuid,text,text,text,integer,integer,text,boolean),public.marketing_inbox_detail(uuid,integer,integer) to authenticated;

-- Server-only, read-only material for consented DM profile reads. Never a customer master.
create function public.marketing_inbox_profile_material(p_conversation uuid,p_auth_user uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare c public.marketing_conversations; conn public.marketing_connections; a marketing_private.inbox_authority; actor uuid; material jsonb;
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='Service only.';end if;
 select * into c from public.marketing_conversations where id=p_conversation;
 select id into actor from public.employees where auth_user_id=p_auth_user;
 if c.id is null or actor is null or not marketing_private.actor_allowed(actor,c.organization_id,c.brand_id,'marketing_inbox.view') then raise exception using errcode='42501',message='Inbox scope denied.';end if;
 select * into conn from public.marketing_connections where id=c.connection_id;
 select * into a from marketing_private.inbox_authority where connection_id=c.connection_id;
 if c.channel not in ('facebook','instagram') or c.medium<>'dm' or c.last_inbound_at is null or c.last_inbound_at>now() or c.participant_key !~ '^[0-9]{1,30}$' or c.connection_generation is distinct from conn.credential_generation or
 conn.status<>'test_authorized' or conn.expires_at<=now() or a.generation is distinct from conn.credential_generation or not coalesce(a.receive_verified and a.webhook_verified,false) then raise exception 'Customer profile unavailable.';end if;
 if c.channel='instagram' and not (a.page_tasks && array['MODERATE','PROFILE_PLUS_MODERATE']) then raise exception 'Profile task evidence unavailable.';end if;
 select to_jsonb(conn)||jsonb_build_object('sealed_token',s.sealed_token) into material from marketing_private.credentials s where s.connection_id=conn.id;
 if material is null then raise exception 'Customer profile unavailable.';end if;
 return jsonb_build_object('connection',material,'peer',c.participant_key,'generation',c.connection_generation);
end;$$;
revoke all on function public.marketing_inbox_profile_material(uuid,uuid) from public,anon,authenticated;
grant execute on function public.marketing_inbox_profile_material(uuid,uuid) to service_role;
