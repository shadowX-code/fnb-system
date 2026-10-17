-- Validate once per read, not once per artifact; historical records remain immutable.
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
 select to_jsonb(m)||jsonb_build_object('actor_name',coalesce(nullif(btrim(e.nickname),''),e.full_name),'send_state',coalesce(o.state,case when m.kind='echo' then marketing_private.provider_outbound_state(c.id,m.provider_message_id,m.occurred_at) end),'message_origin',case when m.kind='echo' and o.state is null then 'meta' when m.kind='echo' then 'feedx' end) val,m.occurred_at,m.id
 from public.marketing_conversation_messages m left join public.employees e on e.id=m.actor_employee_id
 left join lateral (select o.state from public.marketing_reply_outbox o join public.marketing_reply_drafts d on d.id=o.draft_id where d.conversation_id=c.id and m.kind='echo' and o.provider_message_id=m.provider_message_id order by o.sent_at desc limit 1) o on true
 where m.conversation_id=c.id and m.kind in ('incoming','echo','attachment','note')
 union all
 select jsonb_build_object('id',d.id,'kind','echo','body',d.body,'provider_message_id',o.provider_message_id,'occurred_at',o.sent_at,'send_state',o.state),o.sent_at,d.id
 from public.marketing_reply_outbox o join public.marketing_reply_drafts d on d.id=o.draft_id where d.conversation_id=c.id and o.state in ('sent','delivered','read') and o.provider_message_id is not null and o.sent_at is not null
 and not exists(select 1 from public.marketing_conversation_messages m where m.conversation_id=c.id and m.kind='echo' and m.provider_message_id=o.provider_message_id)
 ) select count(*) into total from timeline;
 with timeline as (
 select to_jsonb(m)||jsonb_build_object('actor_name',coalesce(nullif(btrim(e.nickname),''),e.full_name),'send_state',coalesce(o.state,case when m.kind='echo' then marketing_private.provider_outbound_state(c.id,m.provider_message_id,m.occurred_at) end),'message_origin',case when m.kind='echo' and o.state is null then 'meta' when m.kind='echo' then 'feedx' end) val,m.occurred_at,m.id
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
 return jsonb_build_object('knowledge',(select jsonb_build_object('revision',k.revision,'approved_for_replies',s.brand_id is not null) from public.marketing_knowledge k left join public.marketing_inbox_knowledge s on s.brand_id=k.brand_id and s.knowledge_revision=k.revision where k.brand_id=c.brand_id),'policy',coalesce((select to_jsonb(p) from public.marketing_inbox_policies p where p.brand_id=c.brand_id),'{"automation_mode":"suggest","ai_allowed":false}'::jsonb),'reply_requires_approval',marketing_private.inbox_reply_review_required(c.id),'reply_authority',(select jsonb_build_object('verified',coalesce(a.send_verified and a.webhook_verified and a.generation=conn.credential_generation and c.connection_generation=conn.credential_generation and conn.status='test_authorized' and conn.expires_at>now(),false),'recent',coalesce(a.verified_at>now()-interval '1 hour',false)) from public.marketing_connections conn left join marketing_private.inbox_authority a on a.connection_id=conn.id where conn.id=c.connection_id),'timeline_projected',true,'audit_messages',audit_messages,'conversation',(to_jsonb(c)-'participant_key')||jsonb_build_object('customer_profile',marketing_private.inbox_profile(c.id)),'messages',messages,'total',total,'drafts',drafts,'artifacts',artifacts,'members',members,
 'window_expires_at',c.last_inbound_at+interval '24 hours','window_open',c.medium='dm' and not c.opted_out and c.last_inbound_at+interval '24 hours'>now(),'channel_capability',marketing_private.inbox_channel(c.connection_id),'sending_enabled',false,'read_through_sequence',(select coalesce(max(sequence),0) from public.marketing_conversation_messages where conversation_id=c.id),'unread_count',marketing_private.inbox_unread(c.id,actor),'outbox',(select coalesce(jsonb_agg(to_jsonb(o)-'lease'),'[]') from public.marketing_reply_outbox o join public.marketing_reply_drafts d on d.id=o.draft_id where d.conversation_id=c.id));
end;$function$
;

