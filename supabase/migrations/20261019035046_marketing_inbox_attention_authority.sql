-- Attention can only be satisfied by explicit waiting/completion or a canonical FeedX receipt.
create or replace function marketing_private.inbox_needs_reply(p_conversation uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from marketing_conversations c where c.id=p_conversation and c.channel<>'internal' and c.status='open' and not c.opted_out
  and exists(select 1 from marketing_conversation_messages m where m.conversation_id=c.id and m.kind in ('incoming','attachment'))
  and (cardinality(c.escalation_reasons)>0 or c.resolution_hold or
   (select max(m.occurred_at) from marketing_conversation_messages m where m.conversation_id=c.id and m.kind in ('incoming','attachment'))>
   coalesce((select max(o.sent_at) from marketing_reply_outbox o join marketing_reply_drafts d on d.id=o.draft_id where d.conversation_id=c.id and o.state in ('sent','delivered','read') and o.provider_message_id is not null),'-infinity'::timestamptz)));
$$;
revoke all on function marketing_private.inbox_needs_reply(uuid) from public,anon,authenticated,service_role;

-- Starting a new draft is staff handling; source-version pinning happens after reopening.
do $$declare f text;needle text;begin
 f:=pg_get_functiondef('public.marketing_inbox_command(uuid,uuid,uuid,uuid,integer,text,jsonb)'::regprocedure);
 needle:=$n$  if p_command='outlet_context' then$n$;
 if position(needle in f)=0 then raise exception 'Command baseline differs';end if;
 execute replace(f,needle,$n$  if p_command in ('draft','faq_draft') and c.status='pending' then
   update marketing_conversations set status='open',version=version+1,updated_at=now() where id=c.id returning * into c;
  end if;
$n$||needle);
end;$$;
