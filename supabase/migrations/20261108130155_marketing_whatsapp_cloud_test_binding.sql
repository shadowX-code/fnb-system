-- The Staging-only Edge route verifies the fixed Meta test assets before calling this authority.
create function public.marketing_whatsapp_bind_cloud_test(
 p_org uuid,p_brand uuid,p_auth_user uuid,p_generation integer,p_sealed jsonb,p_subject text,p_expiry timestamptz
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
 actor uuid;
 c marketing_connections;
 result jsonb;
 phone constant text:='1221509657713215';
 waba constant text:='1675083730240518';
begin
 select e.id into strict actor from employees e where e.auth_user_id=p_auth_user
   and marketing_private.actor_allowed(e.id,p_org,p_brand,'marketing_settings.configure');
 perform 1 from brands where id=p_brand and organization_id=p_org and is_active for share;
 if not found then raise exception using errcode='42501',message='WhatsApp test Brand is unavailable.';end if;
 if p_sealed->>'version' is distinct from '1' or p_sealed->>'ciphertext' is null
   or coalesce(p_subject,'') !~ '^[0-9]{1,32}$' or p_expiry is null or p_expiry<=now() or p_expiry>now()+interval '24 hours'
 then raise exception 'Invalid WhatsApp test credential evidence.';end if;
 perform pg_advisory_xact_lock(hashtextextended('whatsapp-brand:'||p_brand,0));
 perform pg_advisory_xact_lock(hashtextextended('whatsapp:'||phone,0));
 select * into c from marketing_connections where brand_id=p_brand and channel='whatsapp' for update;
 if coalesce(c.credential_generation,0) is distinct from p_generation then raise exception 'Stale WhatsApp generation.';end if;
 if exists(select 1 from marketing_connections where channel='whatsapp' and provider_account_id=phone and id is distinct from c.id)
 then raise exception 'WhatsApp test phone already belongs to another Brand.';end if;
 if c.id is null then
  insert into marketing_connections(organization_id,brand_id,channel,provider_account_id,account_name,status,expires_at,credential_generation,connected_by,connected_at,last_checked_at,whatsapp_waba_id,whatsapp_onboarding_mode,whatsapp_revision)
  values(p_org,p_brand,'whatsapp',phone,'Meta Cloud API test number','test_authorized',p_expiry,1,actor,clock_timestamp(),now(),waba,'cloud_api',1)
  returning * into c;
 else
  if (c.organization_id,c.provider_account_id,c.whatsapp_waba_id,c.whatsapp_onboarding_mode) is distinct from (p_org,phone,waba,'cloud_api'::text)
  then raise exception 'WhatsApp test binding cannot replace an existing identity.';end if;
  update marketing_connections set whatsapp_local_state='active',status='test_authorized',expires_at=p_expiry,
   credential_generation=credential_generation+1,whatsapp_revision=whatsapp_revision+1,
   connected_by=actor,connected_at=clock_timestamp(),last_checked_at=now(),error_code=null where id=c.id returning * into c;
 end if;
 insert into marketing_private.credentials(connection_id,credential_reference,sealed_token,meta_user_id,expires_at)
 values(c.id,'encrypted-meta:'||c.id,p_sealed,p_subject,p_expiry)
 on conflict(connection_id) do update set sealed_token=excluded.sealed_token,meta_user_id=excluded.meta_user_id,expires_at=excluded.expires_at,credential_reference=excluded.credential_reference;
 insert into marketing_private.meta_subjects(connection_id,generation,meta_user_id) values(c.id,c.credential_generation,p_subject);
 insert into marketing_private.inbox_authority(connection_id,generation,receive_verified,configuration_verified,webhook_verified,verified_at,granted_scopes)
 values(c.id,c.credential_generation,true,true,true,now(),array['whatsapp_business_management','whatsapp_business_messaging'])
 on conflict(connection_id) do update set generation=excluded.generation,receive_verified=true,configuration_verified=true,webhook_verified=true,
  verified_at=excluded.verified_at,granted_scopes=excluded.granted_scopes,signed_inbound_at=null,send_verified=false,execution_enabled=false;
 result:=jsonb_build_object('connection_id',c.id,'generation',c.credential_generation,'reason','awaiting_test_inbound','sending_enabled',false);
 insert into marketing_events(organization_id,brand_id,action,actor_employee_id,details)
 values(p_org,p_brand,'whatsapp_cloud_test_authorized',actor,result);
 return result;
end;$$;

revoke all on function public.marketing_whatsapp_bind_cloud_test(uuid,uuid,uuid,integer,jsonb,text,timestamptz) from public,anon,authenticated;
grant execute on function public.marketing_whatsapp_bind_cloud_test(uuid,uuid,uuid,integer,jsonb,text,timestamptz) to service_role;

-- Preserve the deployed Coexistence and shutdown projection while inserting the test-mode branch.
do $$
declare
 f text:=pg_get_functiondef('public.marketing_whatsapp_connections(uuid,uuid)'::regprocedure);
 state_branch constant text:=$needle$when o.issue='coexistence_unsupported'$needle$;
 reason_branch constant text:=$needle$when o.issue is not null then o.issue$needle$;
begin
 if strpos(f,state_branch)=0 or strpos(f,reason_branch)=0 then raise exception 'Unexpected WhatsApp connection projection.';end if;
 f:=replace(f,state_branch,$part$when c.whatsapp_onboarding_mode='cloud_api' then
 case when marketing_private.whatsapp_receiving(c.id) and exists(select 1 from marketing_private.inbox_authority a where a.connection_id=c.id and a.generation=c.credential_generation and a.signed_inbound_at is not null) then 'connected' else 'action_required' end
 when o.issue='coexistence_unsupported'$part$);
 f:=replace(f,reason_branch,$part$when c.whatsapp_onboarding_mode='cloud_api' then
 case when not marketing_private.whatsapp_receiving(c.id) then 'reconnect_required' when exists(select 1 from marketing_private.inbox_authority a where a.connection_id=c.id and a.generation=c.credential_generation and a.signed_inbound_at is not null) then 'receive_only' else 'awaiting_test_inbound' end
 when o.issue is not null then o.issue$part$);
 execute f;
end;$$;

-- The isolated test path does not have a Coexistence approval row to check Brand activity.
do $$
declare
 f text:=pg_get_functiondef('marketing_private.whatsapp_receiving(uuid)'::regprocedure);
 needle constant text:='and a.generation=c.credential_generation';
begin
 if strpos(f,needle)=0 then raise exception 'Unexpected WhatsApp receiving authority.';end if;
 execute replace(f,needle,$part$and (c.whatsapp_onboarding_mode<>'cloud_api' or exists(select 1 from brands b where b.id=c.brand_id and b.is_active)) and a.generation=c.credential_generation$part$);
end;$$;
