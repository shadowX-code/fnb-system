-- Resolve identity only within an already authorized Inbox conversation.
create function marketing_private.whatsapp_inbox_identity(c public.marketing_conversations,p_actor uuid)
returns jsonb language plpgsql stable set search_path=public as $$
declare phone text; crm_name text; provider_name text;
begin
 if c.channel is distinct from 'whatsapp' or c.medium is distinct from 'dm'
  or not exists(select 1 from public.marketing_conversation_messages m
   where m.conversation_id=c.id and m.kind in ('incoming','attachment')
    and m.evidence_source='signed_webhook' and m.provider_message_id is not null)
 then return null;end if;

 if c.participant_key ~ '^[1-9][0-9]{6,14}$' then phone:='+'||c.participant_key;end if;
 if phone is not null and marketing_private.actor_allowed(p_actor,c.organization_id,c.brand_id,'marketing_audience.view') then
  select nullif(btrim(customer.display_name),'') into crm_name
  from public.platform_customers customer
  join public.platform_customer_brands brand on brand.customer_id=customer.id and brand.organization_id=customer.organization_id
  where customer.organization_id=c.organization_id and customer.phone_e164=phone and customer.active
   and brand.brand_id=c.brand_id;
 end if;

 if crm_name is null then
  select btrim(e.payload->>'profile_name') into provider_name
  from public.marketing_conversation_messages m
  join marketing_private.inbox_events e on e.event_key=c.connection_id::text||':'||c.connection_generation::text||':whatsapp:message:'||m.provider_message_id
  where m.conversation_id=c.id and m.kind in ('incoming','attachment') and m.evidence_source='signed_webhook'
   and e.connection_id=c.connection_id and e.generation=c.connection_generation
   and e.state='processed' and e.evidence_source='signed_webhook'
   and e.payload->>'channel'='whatsapp' and e.payload->>'kind'=m.kind and e.payload->>'peer_id'=c.participant_key
   and jsonb_typeof(e.payload->'profile_name')='string'
   and length(btrim(e.payload->>'profile_name')) between 1 and 160
   and (e.payload->>'profile_name') !~ '[[:cntrl:]]'
  order by m.occurred_at desc,m.sequence desc,m.id limit 1;
 end if;

 return jsonb_strip_nulls(jsonb_build_object(
  'display_name',coalesce(crm_name,provider_name),'phone_e164',phone,
  'source',case when crm_name is not null then 'crm' when provider_name is not null then 'whatsapp_profile'
   when phone is not null then 'whatsapp_phone' end
 ));
end;$$;

create function marketing_private.whatsapp_inbox_identity_matches(c public.marketing_conversations,p_actor uuid,p_search text)
returns boolean language plpgsql stable set search_path=public as $$
declare identity jsonb; term text:=btrim(p_search); digits text; phone text;
begin
 if term is null or term='' then return false;end if;
 identity:=marketing_private.whatsapp_inbox_identity(c,p_actor);
 if position(lower(term) in lower(coalesce(identity->>'display_name',identity->>'phone_e164','WhatsApp customer')))>0
 then return true;end if;
 phone:=substring(identity->>'phone_e164' from 2);
 if phone is null or term !~ '^\+?[0-9 ().-]+$' then return false;end if;
 digits:=regexp_replace(term,'[^0-9]','','g');
 if digits='' then return false;end if;
 if left(digits,2)='00' then digits:=substring(digits from 3);end if;
 if digits='' then return false;end if;
 return position(digits in phone)>0 or
  (left(digits,1)='0' and left(phone,2)='60' and position(digits in ('0'||substring(phone from 3)))=1);
end;$$;

revoke all on function marketing_private.whatsapp_inbox_identity(public.marketing_conversations,uuid),
 marketing_private.whatsapp_inbox_identity_matches(public.marketing_conversations,uuid,text)
 from public,anon,authenticated,service_role;

-- Keep the canonical list filters, counts, and detail authorization.
do $migration$
declare
 list_def text:=pg_get_functiondef('public.marketing_inbox_read(uuid,uuid,text,text,text,integer,integer,text,boolean,text)'::regprocedure);
 detail_def text:=pg_get_functiondef('public.marketing_inbox_detail(uuid,integer,integer)'::regprocedure);
 search_marker constant text:=$old$p_search='' or position(lower(p_search) in lower(c.title))>0$old$;
 profile_marker constant text:='marketing_private.inbox_profile(c.id)';
 profile_expr constant text:=$new$case when c.channel='whatsapp' then marketing_private.whatsapp_inbox_identity(c,actor) else marketing_private.inbox_profile(c.id) end$new$;
begin
 if (length(list_def)-length(replace(list_def,search_marker,'')))/length(search_marker)<>4
  or strpos(list_def,profile_marker)=0 or strpos(detail_def,profile_marker)=0
 then raise exception 'Unexpected Inbox identity projection baseline';end if;
 list_def:=replace(list_def,search_marker,search_marker||$new$
  or case when c.channel='whatsapp' then marketing_private.whatsapp_inbox_identity_matches(c,actor,p_search) else false end$new$);
 execute replace(list_def,profile_marker,profile_expr);
 execute replace(detail_def,profile_marker,profile_expr);
end;
$migration$;
