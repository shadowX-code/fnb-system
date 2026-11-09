-- The QA template can reuse its existing conversation. Credential lineage is pinned on the outbox.
create or replace function marketing_private.whatsapp_test_template_ready(
 c public.marketing_conversations, conn public.marketing_connections
) returns boolean language sql stable security definer set search_path=public as $$
 select coalesce(
  c.id='4ea6db5b-1d11-4c51-a7c1-8e7cd9d369fa'
  and c.brand_id='3a60f950-9510-4538-b7de-93789573bc0b'
  and c.channel='whatsapp' and c.medium='dm' and c.takeover and not c.opted_out and c.status<>'resolved'
  and conn.id=c.connection_id and conn.brand_id=c.brand_id and conn.organization_id=c.organization_id
  and conn.whatsapp_onboarding_mode='cloud_api' and conn.provider_account_id='1221509657713215'
  and conn.whatsapp_waba_id='1675083730240518'
  and c.connection_generation<=conn.credential_generation
  and marketing_private.whatsapp_receiving(conn.id)
  and not exists (
   select 1 from public.marketing_conversations newer
   where newer.connection_id=c.connection_id and newer.participant_key=c.participant_key
    and newer.connection_generation>c.connection_generation and newer.opted_out
  )
  and exists (
   select 1 from public.platform_customers customer
   where customer.organization_id=c.organization_id and customer.phone_e164='+'||c.participant_key
    and marketing_private.whatsapp_consent(c.brand_id,customer.id) is not null
  ),false)
$$;
revoke all on function marketing_private.whatsapp_test_template_ready(public.marketing_conversations,public.marketing_connections) from public,anon,authenticated,service_role;

do $migration$
declare
 prepare_def text:=pg_get_functiondef('public.marketing_inbox_prepare_send(uuid,uuid)'::regprocedure);
 material_def text:=pg_get_functiondef('public.marketing_inbox_staff_send_material(uuid,uuid)'::regprocedure);
 receipt_def text:=pg_get_functiondef('marketing_private.whatsapp_reconcile(uuid,integer)'::regprocedure);
 trigger_def text:=pg_get_functiondef('marketing_private.whatsapp_outbox_receipt()'::regprocedure);
 conversation_generation constant text:='c.connection_generation is distinct from conn.credential_generation';
 receipt_generation constant text:='c.connection_generation=p_generation and x.connection_generation=p_generation';
 trigger_generation constant text:='whatsapp_reconcile(c.connection_id,c.connection_generation)';
begin
 if strpos(prepare_def,conversation_generation)=0 or strpos(material_def,conversation_generation)=0
  or strpos(receipt_def,receipt_generation)=0 or strpos(trigger_def,trigger_generation)=0
 then raise exception 'Unexpected WhatsApp template generation baseline';end if;

 execute replace(prepare_def,conversation_generation,
  '(d.whatsapp_template is null and '||conversation_generation||')');
 execute replace(material_def,conversation_generation,
  '(d.whatsapp_template is null and '||conversation_generation||')');
 execute replace(receipt_def,receipt_generation,
  'x.connection_generation=p_generation and (d.whatsapp_template is not null or c.connection_generation=p_generation)');
 execute replace(trigger_def,trigger_generation,
  'whatsapp_reconcile(c.connection_id,coalesce(new.connection_generation,c.connection_generation))');
end;
$migration$;
