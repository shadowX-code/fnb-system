-- Display the WhatsApp customer window from signed inbound evidence on the bound generation.
-- The existing send authority remains independent of this projection.
do $migration$
declare
 definition text := pg_get_functiondef('public.marketing_inbox_detail(uuid,integer,integer)'::regprocedure);
 access_check text := $check$actor:=marketing_private.require_access(c.organization_id,c.brand_id,'marketing_inbox.view');$check$;
 previous_window text := $window$'window_expires_at',c.last_inbound_at+interval '24 hours','window_open',c.medium='dm' and not c.opted_out and c.last_inbound_at+interval '24 hours'>now()$window$;
begin
 if position(access_check in definition)=0 or position(previous_window in definition)=0 then
  raise exception 'Unexpected Inbox detail baseline';
 end if;
 definition := replace(definition,'declare c public.marketing_conversations;', 'declare wa_last_inbound timestamptz; c public.marketing_conversations;');
 definition := replace(definition,access_check,access_check||$evidence$
 if c.channel='whatsapp' and c.medium='dm' and not c.opted_out and exists(
  select 1 from public.marketing_connections conn where conn.id=c.connection_id
   and conn.organization_id=c.organization_id and conn.brand_id=c.brand_id and conn.channel=c.channel
   and conn.credential_generation=c.connection_generation
   and marketing_private.whatsapp_receiving(conn.id)
 ) then
  select max(m.occurred_at) into wa_last_inbound
  from public.marketing_conversation_messages m
  where m.conversation_id=c.id and m.kind in ('incoming','attachment')
   and m.evidence_source='signed_webhook' and m.provider_message_id is not null and m.occurred_at<=now();
 end if;
$evidence$);
 execute replace(definition,previous_window,$projection$
 'window_expires_at',case when c.channel='whatsapp' then wa_last_inbound else c.last_inbound_at end+interval '24 hours',
 'window_open',case when c.channel='whatsapp' then coalesce(wa_last_inbound+interval '24 hours'>now(),false)
  else c.medium='dm' and not c.opted_out and c.last_inbound_at+interval '24 hours'>now() end
$projection$);
end;
$migration$;
