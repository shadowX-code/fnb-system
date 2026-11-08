-- The approved QA conversation is the sole WhatsApp staff-send scope.
create function marketing_private.whatsapp_test_staff_ready(c public.marketing_conversations, conn public.marketing_connections)
returns boolean language sql stable security definer set search_path=public as $$
 select coalesce(
  c.id='a64a715f-32df-4eca-8e88-c4c275413950' and c.brand_id='3a60f950-9510-4538-b7de-93789573bc0b'
  and c.channel='whatsapp' and c.medium='dm' and not c.opted_out and c.status<>'resolved' and c.takeover
  and conn.id=c.connection_id and conn.brand_id=c.brand_id and conn.organization_id=c.organization_id
  and conn.provider_account_id='1221509657713215' and conn.whatsapp_waba_id='1675083730240518'
  and conn.whatsapp_onboarding_mode='cloud_api' and conn.credential_generation=c.connection_generation
  and marketing_private.whatsapp_receiving(conn.id)
  and exists (
   select 1 from marketing_private.inbox_events e
   join public.marketing_conversation_messages m on m.conversation_id=c.id and m.provider_message_id=e.payload->>'event_id'
   where e.connection_id=conn.id and e.generation=conn.credential_generation
    and e.evidence_source='signed_webhook' and e.state='processed'
    and e.payload->>'account_id'=conn.provider_account_id and e.payload->>'waba_id'=conn.whatsapp_waba_id
    and e.payload->>'peer_id'=c.participant_key and e.payload->>'kind' in ('incoming','attachment')
    and m.evidence_source='signed_webhook' and m.kind in ('incoming','attachment')
    and m.occurred_at>now()-interval '24 hours' and m.occurred_at<=now()
  ),false)
$$;
revoke all on function marketing_private.whatsapp_test_staff_ready(public.marketing_conversations,public.marketing_connections) from public,anon,authenticated,service_role;

do $migration$
declare
 prepare_def text:=pg_get_functiondef('public.marketing_inbox_prepare_send(uuid,uuid)'::regprocedure);
 material_def text:=pg_get_functiondef('public.marketing_inbox_staff_send_material(uuid,uuid)'::regprocedure);
 dispatch_def text:=pg_get_functiondef('public.marketing_inbox_send_material(uuid,uuid)'::regprocedure);
 receipt_def text:=pg_get_functiondef('marketing_private.whatsapp_reconcile(uuid,integer)'::regprocedure);
 receipt_generation constant text:='c.connection_generation=p_generation';
 scope_def text:=pg_get_functiondef('public.marketing_inbox_staff_send_scope(uuid,uuid)'::regprocedure);
 authority constant text:=$old$not coalesce(a.send_verified and a.webhook_verified,false) or a.verified_at<=now()-interval '1 hour'$old$;
 test_authority constant text:=$new$(case when c.channel='whatsapp' then
    (d.staff_confirmed and d.provenance='human' and not d.automatic and marketing_private.whatsapp_test_staff_ready(c,conn)) is not true
   else not coalesce(a.send_verified and a.webhook_verified,false) or a.verified_at<=now()-interval '1 hour' end)$new$;
 dispatch_block constant text:=$old$ if exists(select 1 from marketing_conversations wa_conversation join marketing_reply_drafts wa_draft on wa_draft.conversation_id=wa_conversation.id where wa_draft.id=p_draft and wa_conversation.channel='whatsapp') then raise exception using errcode='42501',message='WhatsApp sending is disabled.';end if;$old$;
 scope_field constant text:=$old$'peer',c.participant_key,'account',$old$;
begin
 if strpos(prepare_def,authority)=0 or strpos(material_def,authority)=0
  or strpos(dispatch_def,dispatch_block)=0 or strpos(scope_def,scope_field)=0 or strpos(receipt_def,receipt_generation)=0
 then raise exception 'Unexpected Inbox staff reply baseline'; end if;
 execute replace(prepare_def,authority,test_authority);
 execute replace(material_def,authority,test_authority);
 execute replace(dispatch_def,dispatch_block,'');
 execute replace(receipt_def,receipt_generation,receipt_generation||' and x.connection_generation=p_generation');
 execute replace(scope_def,scope_field,$new$'channel',c.channel,'whatsapp_test_ready',case when c.channel='whatsapp' then
  marketing_private.actor_allowed(actor,c.organization_id,c.brand_id,'marketing_inbox.send')
  and marketing_private.actor_allowed(actor,c.organization_id,c.brand_id,'marketing_inbox.reply')
  and coalesce((select marketing_private.whatsapp_test_staff_ready(c,conn) from public.marketing_connections conn where conn.id=c.connection_id),false)
  else false end,'peer',c.participant_key,'account',$new$);
end;
$migration$;
