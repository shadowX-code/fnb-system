-- The authenticated suggestion path is separate from the automatic worker.
do $migration$
declare
 definition text:=pg_get_functiondef('public.marketing_inbox_ai_prepare(uuid,uuid,integer,text)'::regprocedure);
 previous_guard constant text:=$old$ if c.channel='whatsapp' then raise exception using errcode='42501',message='WhatsApp AI is disabled.';end if;$old$;
 current_guard constant text:=$new$ if c.channel='whatsapp' and (p_kind is distinct from 'reply' or c.opted_out or not exists(
  select 1 from public.marketing_connections conn
  join marketing_private.inbox_authority a on a.connection_id=conn.id and a.generation=conn.credential_generation
  where conn.id=c.connection_id and conn.brand_id=c.brand_id and conn.organization_id=c.organization_id
   and conn.channel=c.channel and conn.credential_generation=c.connection_generation
   and a.signed_inbound_at is not null and marketing_private.whatsapp_receiving(conn.id)
 )) then raise exception using errcode='42501',message='WhatsApp suggestions require a verified conversation.';end if;$new$;
begin
 if strpos(definition,previous_guard)=0 then raise exception 'Unexpected WhatsApp suggestion authority';end if;
 execute replace(definition,previous_guard,current_guard);
end;
$migration$;
