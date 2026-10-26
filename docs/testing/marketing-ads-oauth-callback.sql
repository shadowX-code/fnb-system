-- Canonical Staging only, inside BEGIN/ROLLBACK. Synthetic state; no OAuth URL/code or provider request.
do $$
declare org uuid;brand uuid;actor uuid;uid uuid;state_hash text;session_id uuid;row_before marketing_private.oauth_sessions;
 result jsonb;denied boolean;before_count bigint;session_expiry timestamptz;
begin
 select c.organization_id,c.brand_id into org,brand from marketing_connections c
 where c.channel='facebook' and c.status in ('test_authorized','production_authorized') and c.expires_at>now() limit 1;
 select e.id,e.auth_user_id into actor,uid from employees e where e.auth_user_id is not null
 and marketing_private.ads_org_allowed(e.id,org,'marketing_ads.connect') and marketing_private.actor_allowed(e.id,org,brand,'marketing_settings.configure') limit 1;
 assert actor is not null and org is not null,'Authorized canonical Staging fixture required';
 perform set_config('request.jwt.claim.sub',uid::text,true);
 -- Creation must pin a valid dedicated config; a rejected request cannot leave state behind.
 select count(*) into before_count from marketing_private.oauth_sessions;
 denied:=false;begin perform public.marketing_ads_management_begin(org,repeat('0',64),null);exception when others then denied:=true;end;
 assert denied and (select count(*) from marketing_private.oauth_sessions)=before_count,'Missing config created management state';
 state_hash:=encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex');
 session_id:=public.marketing_ads_management_begin(org,state_hash,'999001');
 select * into row_before from marketing_private.oauth_sessions where id=session_id;
 assert row_before.ads_management_config_id='999001' and row_before.purpose='ads','Management config not persisted';
 result:=public.marketing_meta_consume(state_hash);
 assert result->>'id'=session_id::text and result->>'purpose'='ads' and result->>'ads_management_config_id'='999001','Consume lost pinned configuration';
 assert (select expires_at from marketing_private.oauth_sessions where id=session_id)=row_before.expires_at,'Consume extended expiry';
 assert (select sealed_discovery from marketing_private.oauth_sessions where id=session_id) is null,'Consume staged or exchanged a credential';
 denied:=false;begin perform public.marketing_meta_consume(state_hash);exception when insufficient_privilege then denied:=true;end;assert denied,'Replayed state accepted';
 update marketing_private.oauth_sessions set expires_at=now()-interval '1 second' where id=session_id;
 -- Expired state stays unconsumed; only a newly created session can proceed.
 state_hash:=encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex');
 session_id:=public.marketing_ads_management_begin(org,state_hash,'999001');
 update marketing_private.oauth_sessions set expires_at=now() where id=session_id;
 denied:=false;begin perform public.marketing_meta_consume(state_hash);exception when insufficient_privilege then denied:=true;end;assert denied,'Expired state accepted';
 assert (select consumed_at is null and sealed_discovery is null from marketing_private.oauth_sessions where id=session_id),'Expired attempt changed state/credential';
 denied:=false;begin perform public.marketing_meta_consume(repeat('f',64));exception when insufficient_privilege then denied:=true;end;assert denied,'Unknown state accepted';
 -- Reporting is explicit null, not an omitted/malformed management field.
 state_hash:=encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex');
 session_id:=(public.marketing_ads_begin(org,null,state_hash)->>'id')::uuid;
 result:=public.marketing_meta_consume(state_hash);
 assert result?'ads_management_config_id' and result->'ads_management_config_id'='null'::jsonb,'Reporting compatibility lost';
 update marketing_private.oauth_sessions set expires_at=now()-interval '1 second' where id=session_id;
 -- Existing social authority and scope remain unchanged.
 state_hash:=encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex');
 session_id:=(public.marketing_meta_begin(org,brand,state_hash,'https://ujkzdaaadnvcfayuldmh.supabase.co/functions/v1/marketing-meta/callback')->>'id')::uuid;
 result:=public.marketing_meta_consume(state_hash);
 assert result->>'purpose'='social' and result->>'brand_id'=brand::text and result->'ads_management_config_id'='null'::jsonb,'Social callback isolation lost';
 assert not has_function_privilege('anon','public.marketing_meta_consume(text)','EXECUTE');
 assert not has_function_privilege('authenticated','public.marketing_meta_consume(text)','EXECUTE');
 assert has_function_privilege('service_role','public.marketing_meta_consume(text)','EXECUTE');
end;$$;
select 'Callback config projection, explicit Reporting null, social compatibility, expiry, replay and grants passed; rollback required' result;
