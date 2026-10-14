-- Concurrent retry cannot weaken lifecycle revalidation; leases remain server-only.
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
 if o.state in ('prepared','pending','reconciling') and (d.status<>'approved' or d.source_version<>c.version or o.source_version<>c.version or c.opted_out or c.status='resolved' or c.medium<>'dm' or
  c.last_inbound_at is null or c.last_inbound_at<=now()-interval '24 hours' or c.last_inbound_at>now() or conn.credential_generation<>o.connection_generation or
  a.generation is distinct from conn.credential_generation or not coalesce(a.send_verified and a.webhook_verified,false) or a.verified_at<=now()-interval '1 hour' or conn.expires_at<=now() or conn.status<>'test_authorized' or
  (d.knowledge_revision is not null and not exists(select 1 from public.marketing_knowledge where brand_id=c.brand_id and revision=d.knowledge_revision))) then raise exception 'Messaging authority changed.';end if;
 select to_jsonb(conn)||jsonb_build_object('sealed_token',s.sealed_token,'meta_user_id',s.meta_user_id) into v from marketing_private.credentials s where s.connection_id=conn.id;
 return jsonb_build_object('connection',v,'recipient',c.participant_key,'text',d.body,'state',o.state,'receipt',o.provider_message_id,'lease',o.lease,'authority',jsonb_build_object('execution_enabled',true,'send_verified',a.send_verified,'webhook_verified',a.webhook_verified,'exact_authorizer_verified',a.send_verified,'page_tasks',array['MESSAGE'],'granted_scopes',a.granted_scopes,'last_inbound_at',c.last_inbound_at,'page_id',a.page_id,'opted_out',c.opted_out,'medium',c.medium));
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
 'window_expires_at',c.last_inbound_at+interval '24 hours','window_open',c.medium='dm' and not c.opted_out and c.last_inbound_at+interval '24 hours'>now(),'channel_capability',marketing_private.inbox_channel(c.connection_id),'sending_enabled',false,'read_through_sequence',(select coalesce(max(sequence),0) from public.marketing_conversation_messages where conversation_id=c.id),'unread_count',marketing_private.inbox_unread(c.id,actor),'outbox',(select coalesce(jsonb_agg(to_jsonb(o)-'lease'),'[]') from public.marketing_reply_outbox o join public.marketing_reply_drafts d on d.id=o.draft_id where d.conversation_id=c.id));
end;$$;

