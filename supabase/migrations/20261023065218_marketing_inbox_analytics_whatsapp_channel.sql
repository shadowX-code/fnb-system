-- Add the existing canonical WhatsApp channel to analytics validation only.
-- Pin the reviewed deployed function so reporting or authorization drift fails closed.
do $migration$
declare
 definition text := pg_get_functiondef('public.marketing_inbox_analytics(uuid,uuid,text,timestamptz,timestamptz)'::regprocedure);
 before_clause text := $clause$p_channel not in ('','social','internal','facebook','instagram')$clause$;
 after_clause text := $clause$p_channel not in ('','social','internal','facebook','instagram','whatsapp')$clause$;
begin
 if md5(definition) <> 'b1d806baff3b570470ede0a0d0bbefee'
    or position(before_clause in definition) = 0 then
   raise exception 'Inbox analytics definition differs from reviewed baseline.';
 end if;
 execute replace(definition,before_clause,after_clause);
end;
$migration$;
