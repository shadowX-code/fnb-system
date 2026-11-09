-- Customer Cloud API signup is separate from Coexistence and the isolated Test WABA.
-- No platform evidence or pilot approval is seeded.
alter table marketing_private.whatsapp_platform_readiness
 add column new_number_enabled boolean not null default false;
alter table marketing_private.whatsapp_pilot_authority
 add column mode text not null default 'coexistence' check (mode in ('coexistence','new_number')),
 add constraint whatsapp_new_number_requires_exact_hash check (mode <> 'new_number' or approved_phone_hash is not null);
alter table marketing_private.whatsapp_signup_sessions
 add column mode text not null default 'coexistence' check (mode in ('coexistence','new_number'));
alter table marketing_private.whatsapp_onboarding
 add column registration_verified boolean not null default false;
alter table public.marketing_connections drop constraint marketing_whatsapp_identity;
alter table public.marketing_connections add constraint marketing_whatsapp_identity check (
 (channel='whatsapp' and whatsapp_waba_id is not null and whatsapp_waba_id ~ '^[0-9]{1,32}$'
 and provider_account_id is not null and provider_account_id ~ '^[0-9]{1,32}$'
 and whatsapp_onboarding_mode is not null and whatsapp_onboarding_mode in ('cloud_api','coexistence','new_number')
 and credential_generation>0)
 or (channel<>'whatsapp' and whatsapp_waba_id is null and whatsapp_onboarding_mode is null)
);

-- Keep the existing function identities, grants, encrypted bind, and recovery rules.
do $migration$
declare
 patch record;
 definition text;
begin
 for patch in select * from (values
  ('marketing_private.whatsapp_gate(uuid,text,text,text,text)',
   'and r.coexistence_enabled', 'and case a.mode when ''new_number'' then r.new_number_enabled else r.coexistence_enabled end'),
  ('public.marketing_whatsapp_readiness(uuid,uuid,text,text,text,text)',
   '''eligible'',eligible,''can_configure''',
   '''eligible'',eligible,''mode'',case when eligible then (select a.mode from marketing_private.whatsapp_pilot_authority a where a.brand_id=p_brand) end,''can_configure'''),
  ('public.marketing_whatsapp_begin(uuid,uuid,text,text,text,text,text,uuid,integer)',
   'a.phone_id,a.waba_id,''coexistence''::text', 'a.phone_id,a.waba_id,a.mode'),
  ('public.marketing_whatsapp_begin(uuid,uuid,text,text,text,text,text,uuid,integer)',
   'customer_business_id,approved_phone_hash)', 'customer_business_id,approved_phone_hash,mode)'),
  ('public.marketing_whatsapp_begin(uuid,uuid,text,text,text,text,text,uuid,integer)',
   'a.customer_business_id,a.approved_phone_hash)', 'a.customer_business_id,a.approved_phone_hash,a.mode)'),
  ('public.marketing_whatsapp_begin(uuid,uuid,text,text,text,text,text,uuid,integer)',
   '''expires_at'',s.expires_at)', '''expires_at'',s.expires_at,''mode'',s.mode)'),
  ('public.marketing_whatsapp_consume(uuid,uuid,text)',
   'or not marketing_private.whatsapp_gate(s.brand_id',
   'or not exists(select 1 from marketing_private.whatsapp_pilot_authority a where a.brand_id=s.brand_id and a.mode=s.mode) or not marketing_private.whatsapp_gate(s.brand_id'),
  ('public.marketing_whatsapp_bind(uuid,uuid,jsonb,jsonb)',
   $old$p_evidence->>'platform_type' is distinct from 'CLOUD_API'$old$,
   $new$not coalesce(p_evidence->>'platform_type'='CLOUD_API' or (s.mode='new_number' and p_evidence->>'platform_type'='NOT_APPLICABLE' and p_evidence->'registration_verified'='false'::jsonb),false)$new$),
  ('public.marketing_whatsapp_bind(uuid,uuid,jsonb,jsonb)',
   'and approved_phone_hash=s.approved_phone_hash and expires_at>now()', 'and approved_phone_hash=s.approved_phone_hash and mode=s.mode and expires_at>now()'),
  ('public.marketing_whatsapp_bind(uuid,uuid,jsonb,jsonb)',
   'where a.brand_id=s.brand_id and (a.waba_id', 'where a.brand_id=s.brand_id and a.mode=s.mode and a.approved_phone_hash is not distinct from s.approved_phone_hash and (a.waba_id'),
  ('public.marketing_whatsapp_bind(uuid,uuid,jsonb,jsonb)',
   $old$p_evidence->>'is_on_biz_app' is distinct from 'true'$old$,
   $new$p_evidence->>'is_on_biz_app' is distinct from (s.mode='coexistence')::text$new$),
  ('public.marketing_whatsapp_bind(uuid,uuid,jsonb,jsonb)',
   $old$s.phone_id,'WhatsApp Business App','test_authorized'$old$,
   $new$s.phone_id,case when s.mode='new_number' then 'WhatsApp Cloud API' else 'WhatsApp Business App' end,'test_authorized'$new$),
  ('public.marketing_whatsapp_bind(uuid,uuid,jsonb,jsonb)',
   $old$s.waba_id,'coexistence',1)$old$, $new$s.waba_id,s.mode,1)$new$),
  ('public.marketing_whatsapp_bind(uuid,uuid,jsonb,jsonb)',
   $old$s.waba_id,'coexistence'::text)$old$, $new$s.waba_id,s.mode)$new$),
  ('public.marketing_whatsapp_bind(uuid,uuid,jsonb,jsonb)',
   ' perform marketing_private.whatsapp_restore_sync(c.id);',
   $new$ update marketing_private.whatsapp_onboarding set registration_verified=s.mode='new_number' and coalesce(p_evidence->'registration_verified'='true'::jsonb,false) where connection_id=c.id;
 if s.mode='coexistence' then perform marketing_private.whatsapp_restore_sync(c.id); end if;$new$),
  ('public.marketing_whatsapp_bind(uuid,uuid,jsonb,jsonb)',
   $old$'whatsapp_coexistence_authorized',s.actor_employee_id$old$,
   $new$case when s.mode='new_number' then 'whatsapp_cloud_authorized' else 'whatsapp_coexistence_authorized' end,s.actor_employee_id$new$),
  ('public.marketing_whatsapp_verification_material(uuid,uuid,integer)',
   'a.brand_id=c.brand_id and a.app_id=o.app_id', 'a.brand_id=c.brand_id and a.mode=c.whatsapp_onboarding_mode and a.app_id=o.app_id'),
  ('public.marketing_whatsapp_record_verification(uuid,uuid,integer,jsonb)',
   $old$p_evidence->>'platform_type' is distinct from 'CLOUD_API'$old$,
   $new$not coalesce(p_evidence->>'platform_type'='CLOUD_API' or (c.whatsapp_onboarding_mode='new_number' and p_evidence->>'platform_type'='NOT_APPLICABLE' and p_evidence->'registration_verified'='false'::jsonb),false)$new$),
  ('public.marketing_whatsapp_record_verification(uuid,uuid,integer,jsonb)',
   $old$p_evidence->>'is_on_biz_app' is distinct from 'true'$old$,
   $new$p_evidence->>'is_on_biz_app' is distinct from (c.whatsapp_onboarding_mode='coexistence')::text$new$),
  ('public.marketing_whatsapp_record_verification(uuid,uuid,integer,jsonb)',
   'set token_verified_at=now(),verified_until=expiry,issue=null',
   $new$set registration_verified=c.whatsapp_onboarding_mode='new_number' and coalesce(p_evidence->'registration_verified'='true'::jsonb,false),token_verified_at=now(),verified_until=expiry,issue=null$new$),
  ('public.marketing_whatsapp_record_verification(uuid,uuid,integer,jsonb)',
   $old$issue=null,updated_at=now() where connection_id=c.id;$old$,
   $new$issue=null,updated_at=now() where connection_id=c.id;
 if c.whatsapp_onboarding_mode='new_number' then
  update marketing_private.inbox_authority set receive_verified=false,configuration_verified=false where connection_id=c.id and generation=p_generation;
 end if;$new$),
  ('public.marketing_whatsapp_step(uuid,uuid,integer,text,text,text)',
   $old$ if p_step in ('contacts','history') then$old$,
   $new$ if c.whatsapp_onboarding_mode='new_number' then
  perform public.marketing_whatsapp_verification_material(c.id,p_auth_user,p_generation);
  if p_step is distinct from 'subscription' or not exists(
    select 1 from marketing_private.whatsapp_onboarding o where o.connection_id=c.id and o.generation=p_generation and o.registration_verified
   ) then raise exception 'Cloud API registration verification required.'; end if;
 end if;
 if p_step in ('contacts','history') then$new$),
  ('public.marketing_whatsapp_step(uuid,uuid,integer,text,text,text)',
   $old$ if p_step in ('contacts','history') then$old$,
   $new$ if c.whatsapp_onboarding_mode='new_number' and p_outcome='verified' and exists(
  select 1 from marketing_private.whatsapp_onboarding o where o.connection_id=c.id and o.generation=p_generation and o.subscription_state='verified'
 ) then
  update marketing_private.inbox_authority set receive_verified=true,configuration_verified=true,verified_at=now()
  where connection_id=c.id and generation=p_generation;
  return jsonb_build_object('state','verified');
 end if;
 if p_step in ('contacts','history') then$new$),
  ('marketing_private.whatsapp_receiving(uuid)',
   $old$and a.generation=c.credential_generation$old$,
   $new$and (c.whatsapp_onboarding_mode<>'new_number' or exists(select 1 from marketing_private.whatsapp_onboarding o where o.connection_id=c.id and o.generation=c.credential_generation and o.registration_verified))
 and a.generation=c.credential_generation$new$),
  ('public.marketing_whatsapp_connections(uuid,uuid)',
   $old$when o.subscribed and o.contacts_state='accepted'$old$,
   $new$when c.whatsapp_onboarding_mode='new_number' then case when o.subscribed and marketing_private.whatsapp_receiving(c.id)
 and exists(select 1 from marketing_private.inbox_authority a where a.connection_id=c.id and a.generation=c.credential_generation and a.signed_inbound_at is not null)
 then 'connected' else 'action_required' end
 when o.subscribed and o.contacts_state='accepted'$new$),
  ('public.marketing_whatsapp_connections(uuid,uuid)',
   $old$when not coalesce(o.subscribed,false) then 'subscription_verification_required'$old$,
   $new$when c.whatsapp_onboarding_mode='new_number' and not coalesce(o.registration_verified,false) then 'cloud_registration_required'
 when not coalesce(o.subscribed,false) or (c.whatsapp_onboarding_mode='new_number' and not marketing_private.whatsapp_receiving(c.id)) then 'subscription_verification_required'
 when c.whatsapp_onboarding_mode='new_number' then case when exists(select 1 from marketing_private.inbox_authority a where a.connection_id=c.id and a.generation=c.credential_generation and a.signed_inbound_at is not null) then 'receive_only' else 'awaiting_customer_inbound' end$new$)
 ) as p(signature, before_text, after_text)
 loop
  definition := pg_get_functiondef(patch.signature::regprocedure);
  if strpos(definition,patch.before_text)=0 then
   raise exception 'Unexpected WhatsApp authority baseline: % (%)',patch.signature,patch.before_text;
  end if;
  execute replace(definition,patch.before_text,patch.after_text);
 end loop;
end;
$migration$;
