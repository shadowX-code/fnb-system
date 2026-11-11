-- Store the provider-verified display number in the existing scoped account projection.
do $$
declare
 definition text := pg_get_functiondef('public.marketing_whatsapp_bind(uuid,uuid,jsonb,jsonb)'::regprocedure);
 insert_name constant text := $old$case when s.mode='new_number' then 'WhatsApp Cloud API' else 'WhatsApp Business App' end$old$;
 update_name constant text := $old$update marketing_connections set $old$;
 verified_name constant text := $value$case when p_evidence->>'display_phone_number' ~ '^\+[1-9][0-9]{6,14}$' then p_evidence->>'display_phone_number' end$value$;
begin
 if strpos(definition,insert_name)=0 or strpos(definition,update_name)=0 then
  raise exception 'Unexpected WhatsApp binding definition.';
 end if;
 definition := replace(definition,insert_name,'coalesce('||verified_name||','||insert_name||')');
 definition := replace(definition,update_name,'update marketing_connections set account_name=coalesce('||verified_name||',account_name),');
 execute definition;
end;
$$;
