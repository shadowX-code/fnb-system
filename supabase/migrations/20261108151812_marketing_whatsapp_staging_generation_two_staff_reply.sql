-- Credential renewal creates a new conversation for the same controlled test recipient.
do $migration$
declare
 definition text:=pg_get_functiondef('marketing_private.whatsapp_test_staff_ready(public.marketing_conversations,public.marketing_connections)'::regprocedure);
 previous_pin constant text:=$pin$c.id='a64a715f-32df-4eca-8e88-c4c275413950'$pin$;
 current_pin constant text:=$pin$c.id='4ea6db5b-1d11-4c51-a7c1-8e7cd9d369fa'$pin$;
begin
 if strpos(definition,previous_pin)=0 then raise exception 'Unexpected WhatsApp QA reply authority';end if;
 execute replace(definition,previous_pin,current_pin);
end;
$migration$;
