-- Distinguish unavailable receiving from a closed window or unavailable sending.
do $migration$
declare
 definition text:=pg_get_functiondef('public.marketing_inbox_staff_send_scope(uuid,uuid)'::regprocedure);
 field constant text:=$old$'channel',c.channel,'whatsapp_test_ready',$old$;
begin
 if strpos(definition,field)=0 then raise exception 'Unexpected Inbox staff reply scope'; end if;
 execute replace(definition,field,$new$'channel',c.channel,'whatsapp_connection_ready',case when c.channel='whatsapp' then
  exists(select 1 from public.marketing_connections conn
   where conn.id=c.connection_id and conn.brand_id=c.brand_id and conn.organization_id=c.organization_id
    and conn.channel=c.channel and marketing_private.whatsapp_receiving(conn.id))
  else null end,'whatsapp_qa_diagnostics_allowed',case when c.channel='whatsapp' then
   marketing_private.actor_allowed(actor,c.organization_id,c.brand_id,'marketing_settings.view')
   and marketing_private.actor_allowed(actor,c.organization_id,c.brand_id,'marketing_settings.configure')
  else false end,'whatsapp_test_ready',$new$);
end;
$migration$;
