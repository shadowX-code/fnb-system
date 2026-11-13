-- Canonical Staging only. Existing identity reads plus a rollback-only inbound fixture.
begin;
set local statement_timeout='15s';

do $qa$
declare
 chat public.marketing_conversations;
 fixture public.marketing_conversations;
 conn public.marketing_connections;
 actor uuid;
 auth_user uuid;
 expected_name text;
 other_brand uuid;
 phone text;
 spaced_phone text;
 identity jsonb;
 result jsonb;
 fixture_peer constant text:='60110000029';
 fixture_id uuid:=gen_random_uuid();
 event_id text:='wamid.identity_fixture_'||gen_random_uuid()::text;
begin
 select * into chat from public.marketing_conversations
 where brand_id='3a60f950-9510-4538-b7de-93789573bc0b' and channel='whatsapp'
 order by connection_generation desc limit 1;
 if chat.id is null then raise exception 'Missing signed inbound QA conversation';end if;
 select * into conn from public.marketing_connections where id=chat.connection_id;
 select e.id,e.auth_user_id into actor,auth_user from public.employees e
 where e.auth_user_id is not null
  and marketing_private.actor_allowed(e.id,chat.organization_id,chat.brand_id,'marketing_inbox.view')
  and marketing_private.actor_allowed(e.id,chat.organization_id,chat.brand_id,'marketing_audience.view') limit 1;
 if actor is null then raise exception 'Missing scoped Inbox and CRM actor';end if;

 phone:='+'||chat.participant_key;
 spaced_phone:=left(phone,3)||' '||substring(phone from 4 for 2)||'-'||substring(phone from 6);
 select customer.display_name into expected_name from public.platform_customers customer
 join public.platform_customer_brands brand on brand.customer_id=customer.id and brand.organization_id=customer.organization_id
 where customer.phone_e164=phone and customer.active and brand.brand_id=chat.brand_id and brand.organization_id=chat.organization_id;
 if expected_name is null then raise exception 'Missing existing Brand-linked CRM record';end if;
 perform set_config('request.jwt.claim.sub',auth_user::text,true);
 perform set_config('request.jwt.claim.role','authenticated',true);
 result:=public.marketing_inbox_detail(chat.id,1,20)->'conversation';
 identity:=result->'customer_profile';
 if identity->>'display_name' is distinct from expected_name or identity->>'phone_e164' is distinct from phone
  or identity->>'source' is distinct from 'crm' or result ? 'participant_key'
 then raise exception 'Existing detail did not return the scoped display identity';end if;
 for result in select public.marketing_inbox_read(chat.organization_id,chat.brand_id,'','whatsapp',term)
  from unnest(array[expected_name,spaced_phone,right(phone,4)]) term
 loop
  if not exists(select 1 from jsonb_array_elements(result->'rows') row
   where row->>'id'=chat.id::text and row->'customer_profile'=identity and not row ? 'participant_key')
  then raise exception 'List and search did not match the detail identity';end if;
 end loop;
 identity:=marketing_private.whatsapp_inbox_identity(chat,null);
 if identity->>'phone_e164' is distinct from phone
  or identity->>'source' not in ('whatsapp_phone','whatsapp_profile')
  or (identity->>'source'='whatsapp_phone' and identity ? 'display_name')
 then raise exception 'Historical fallback leaked CRM identity or lost the phone';end if;
 if identity->>'source'='whatsapp_profile' and not exists(
  select 1 from public.marketing_conversation_messages m
  join marketing_private.inbox_events e on e.event_key=chat.connection_id::text||':'||m.whatsapp_generation||':whatsapp:message:'||m.provider_message_id
  where m.conversation_id=chat.id and m.kind in ('incoming','attachment')
   and m.evidence_source='signed_webhook' and e.evidence_source='signed_webhook' and e.state='processed'
   and btrim(e.payload->>'profile_name')=identity->>'display_name')
 then raise exception 'Historical profile lacked signed inbound evidence';end if;

 if exists(select 1 from public.platform_customers where organization_id=chat.organization_id and phone_e164='+'||fixture_peer)
  or exists(select 1 from public.marketing_conversations where connection_id=conn.id and participant_key=fixture_peer)
 then raise exception 'Rollback fixture sender is already in use';end if;
 select id into other_brand from public.brands where organization_id=chat.organization_id and id<>chat.brand_id and is_active limit 1;
 if other_brand is null then raise exception 'Missing second Brand fixture scope';end if;
 insert into public.platform_customers(id,organization_id,display_name,phone_e164,created_by)
 values(fixture_id,chat.organization_id,'Scoped CRM Fixture','+'||fixture_peer,actor);
 insert into public.platform_customer_brands(organization_id,brand_id,customer_id)
 values(chat.organization_id,other_brand,fixture_id);

 perform set_config('request.jwt.claim.role','service_role',true);
 perform public.marketing_inbox_receive(jsonb_build_array(jsonb_build_object(
  'channel','whatsapp','account_id',conn.provider_account_id,'waba_id',conn.whatsapp_waba_id,
  'peer_id',fixture_peer,'event_id',event_id,'kind','incoming','occurred_at',now(),
  'body','Rollback-only inbound identity fixture','medium','dm','profile_name','Signed Profile Fixture'
 )));
 perform public.marketing_inbox_process_events(20);
 select * into fixture from public.marketing_conversations where connection_id=conn.id and participant_key=fixture_peer;
 if fixture.id is null then raise exception 'Canonical Inbox did not process the rollback fixture';end if;

 perform set_config('request.jwt.claim.role','authenticated',true);
 identity:=public.marketing_inbox_detail(fixture.id,1,20)#>'{conversation,customer_profile}';
 if identity->>'display_name' is distinct from 'Signed Profile Fixture' or identity->>'source' is distinct from 'whatsapp_profile'
  or identity->>'phone_e164' is distinct from '+'||fixture_peer
 then raise exception 'Signed profile fallback failed or another Brand CRM name leaked';end if;
 result:=public.marketing_inbox_read(chat.organization_id,chat.brand_id,'','whatsapp','Signed Profile Fixture');
 if not exists(select 1 from jsonb_array_elements(result->'rows') row where row->>'id'=fixture.id::text)
 then raise exception 'Signed profile name was not searchable';end if;
 result:=public.marketing_inbox_read(chat.organization_id,chat.brand_id,'','whatsapp','Scoped CRM Fixture');
 if exists(select 1 from jsonb_array_elements(result->'rows') row where row->>'id'=fixture.id::text)
 then raise exception 'Search exposed the other Brand CRM name';end if;

 insert into public.platform_customer_brands(organization_id,brand_id,customer_id)
 values(chat.organization_id,chat.brand_id,fixture_id);
 identity:=public.marketing_inbox_detail(fixture.id,1,20)#>'{conversation,customer_profile}';
 if identity->>'display_name' is distinct from 'Scoped CRM Fixture' or identity->>'source' is distinct from 'crm'
 then raise exception 'Same-Brand CRM name did not take priority';end if;
end;
$qa$;

select 'WhatsApp sender identity passed without a provider call' as result;
rollback;
