-- Instagram messaging_seen is an exact message receipt; Messenger reads remain watermark based.
-- No execution, publishing, identity or connection authority changes.
create or replace function public.marketing_inbox_send_checkpoint(p_draft uuid,p_auth_user uuid,p_lease uuid,p_state jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare o public.marketing_reply_outbox; material jsonb;
begin
 if auth.role()<>'service_role' then raise exception 'Service only.';end if;
 select * into o from public.marketing_reply_outbox where draft_id=p_draft for update;
 if coalesce((p_state->>'pending')::boolean,false) then
  material:=public.marketing_inbox_send_material(p_draft,p_auth_user);
  if o.state<>'prepared' then raise exception 'Already attempted.';end if;
  update public.marketing_reply_outbox set state='pending',lease=gen_random_uuid(),sent_at=now(),reason='delivery_in_progress' where draft_id=p_draft returning * into o;
 else
  if p_lease is null or o.lease is distinct from p_lease or o.state not in ('pending','reconciling') then raise exception 'Delivery lease changed.';end if;
  if p_state->>'receipt' is not null and length(p_state->>'receipt') between 1 and 300 then
   update public.marketing_reply_outbox set state='sent',provider_message_id=p_state->>'receipt',reason='provider_accepted' where draft_id=p_draft returning * into o;
   -- A signed receipt may arrive before the Send API response is checkpointed.
   if exists(select 1 from public.marketing_conversation_messages m join public.marketing_reply_drafts d on d.conversation_id=m.conversation_id join public.marketing_conversations c on c.id=m.conversation_id where d.id=p_draft and m.kind='read' and ((c.channel='instagram' and m.provider_message_id=o.provider_message_id) or (c.channel='facebook' and m.occurred_at>=o.sent_at))) then
    update public.marketing_reply_outbox set state='read',reason='provider_read_observed' where draft_id=p_draft returning * into o;
   elsif exists(select 1 from public.marketing_conversation_messages m join public.marketing_reply_drafts d on d.conversation_id=m.conversation_id where d.id=p_draft and m.kind='delivery' and m.provider_message_id=o.provider_message_id) then
    update public.marketing_reply_outbox set state='delivered',reason='provider_delivery_observed' where draft_id=p_draft returning * into o;
   end if;
  elsif p_state->>'failed'='provider_rejected' then
   update public.marketing_reply_outbox set state='failed',reason='provider_rejected' where draft_id=p_draft returning * into o;
  else update public.marketing_reply_outbox set state='reconciling',reason='delivery_receipt_unknown' where draft_id=p_draft returning * into o;end if;
 end if;
 return jsonb_build_object('state',o.state,'lease',o.lease,'receipt',o.provider_message_id);
end;$$;

create or replace function marketing_private.inbox_reconcile_receipt() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.kind='delivery' then update public.marketing_reply_outbox o set state=case when state='read' then 'read' else 'delivered' end,reason='provider_delivery_observed'
 from public.marketing_reply_drafts d where o.draft_id=d.id and d.conversation_id=new.conversation_id and o.provider_message_id=new.provider_message_id and o.state in ('sent','delivered','read');
 elsif new.kind='read' then update public.marketing_reply_outbox o set state='read',reason='provider_read_observed' from public.marketing_reply_drafts d join public.marketing_conversations c on c.id=d.conversation_id
 where o.draft_id=d.id and d.conversation_id=new.conversation_id and ((c.channel='instagram' and o.provider_message_id=new.provider_message_id) or (c.channel='facebook' and o.sent_at<=new.occurred_at)) and o.state in ('sent','delivered','read');end if;
 return new;
end;$$;
revoke all on function marketing_private.inbox_reconcile_receipt() from public,anon,authenticated;
revoke all on function public.marketing_inbox_send_checkpoint(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.marketing_inbox_send_checkpoint(uuid,uuid,uuid,jsonb) to service_role;
