-- Provider reads and signed echoes retain the same connection/generation/privacy authority.
do $$declare body text;begin
 body:=pg_get_functiondef('public.marketing_inbox_reconcile(uuid,integer,uuid,jsonb)'::regprocedure);
 body:=replace(body,$a$item->>'kind' is distinct from 'incoming'$a$,$b$coalesce(item->>'kind','') not in ('incoming','echo')$b$);
 body:=replace(body,$a$':incoming:'||(item->>'event_id')$a$,$b$':'||(item->>'kind')||':'||(item->>'event_id')$b$);
 if position($a$not in ('incoming','echo')$a$ in body)=0 then raise exception 'Recent reconciliation contract changed.';end if;
 execute body;
 body:=pg_get_functiondef('public.marketing_inbox_process_events(integer)'::regprocedure);
 body:=replace(body,$a$(ev.evidence_source='historical_import' and item->>'kind'='echo')$a$,$b$item->>'kind'='echo'$b$);
 if position($a$or item->>'kind'='echo'$a$ in body)=0 then raise exception 'Conversation lineage contract changed.';end if;
 execute body;
end;$$;

-- Exact provider message receipts; Messenger read watermarks are conversation scoped.
-- An echo/history record proves an outgoing message, never device delivery by itself.
create function marketing_private.provider_outbound_state(p_conversation uuid,p_message text,p_time timestamptz) returns text
language sql stable set search_path=public as $$
 select case
 when exists(select 1 from public.marketing_conversation_messages r join public.marketing_conversations c on c.id=r.conversation_id
  where r.conversation_id=p_conversation and r.kind='read' and r.evidence_source='signed_webhook'
  and (r.provider_message_id=p_message or (c.channel='facebook' and r.provider_message_id=c.participant_key||':'||floor(extract(epoch from r.occurred_at)*1000)::bigint::text and r.occurred_at>=p_time))) then 'read'
 when exists(select 1 from public.marketing_conversation_messages r where r.conversation_id=p_conversation and r.kind='delivery' and r.evidence_source='signed_webhook' and r.provider_message_id=p_message) then 'delivered'
 else 'sent' end;
$$;
revoke all on function marketing_private.provider_outbound_state(uuid,text,timestamptz) from public,anon,authenticated;

do $$declare body text;begin
 body:=pg_get_functiondef('public.marketing_inbox_detail(uuid,integer,integer)'::regprocedure);
 body:=replace(body,$a$'actor_name',e.full_name,'send_state',o.state$a$,$b$'actor_name',e.full_name,'send_state',coalesce(o.state,case when m.kind='echo' then marketing_private.provider_outbound_state(c.id,m.provider_message_id,m.occurred_at) end),'message_origin',case when m.kind='echo' and o.state is null then 'meta' when m.kind='echo' then 'feedx' end$b$);
 if position('provider_outbound_state' in body)=0 then raise exception 'Conversation projection contract changed.';end if;
 execute body;
end;$$;
