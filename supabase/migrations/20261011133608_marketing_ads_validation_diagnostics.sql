-- Non-mutating validation of one known partial creation; original lifecycle/evidence remain immutable.
create function public.marketing_ads_validation_material(p_request uuid,p_auth_user uuid,p_fingerprint text) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare r marketing_private.ads_changes; actor uuid; result jsonb;
begin
 select id into actor from employees where auth_user_id=p_auth_user;
 select * into r from marketing_private.ads_changes where id=p_request;
 if r.id is null or not marketing_private.actor_allowed(actor,r.organization_id,r.brand_id,'marketing_ads.manage')
   or not marketing_private.actor_allowed(actor,r.organization_id,r.brand_id,'marketing_ads.view') then
  raise exception using errcode='42501',message='Advertising diagnostic access required';
 end if;
 if r.fingerprint is distinct from p_fingerprint or r.state<>'reconciling' or r.operation<>'create'
   or r.provider_state->>'pending' is distinct from 'adset'
   or coalesce(r.provider_state->>'campaign_id','') !~ '^[0-9]{1,30}$'
   or r.provider_state ?| array['adset_id','creative_id','ad_id'] or not marketing_private.ads_change_current(r) then
  raise exception 'Ad Set validation unavailable for this revision';
 end if;
 if exists(select 1 from marketing_private.ads_campaign_brands m where m.organization_id=r.organization_id and m.account_id=r.account_id
   and m.campaign_id=r.provider_state->>'campaign_id' and m.brand_id<>r.brand_id) then raise exception 'Campaign ownership changed';end if;
 if (select count(*) from marketing_private.ads_change_events e where e.change_id=r.id and e.event='validate_adset' and e.created_at>now()-interval '1 hour')>=10 then
  raise exception 'Please wait before validating again';end if;
 select jsonb_build_object('change',to_jsonb(r),'connection',to_jsonb(c)||jsonb_build_object('sealed_token',s.sealed_token,'meta_user_id',s.meta_user_id))
 into result from marketing_connections c join marketing_private.credentials s on s.connection_id=c.id
 where c.id=r.connection_id and c.channel='ad_account' and c.organization_id=r.organization_id
   and c.credential_generation=r.generation and c.provider_account_id=r.account_id and c.expires_at>now()
   and c.status in ('test_authorized','production_authorized');
 if result is null then raise exception 'Ad authorization unavailable';end if;
 return result;
end;$$;
create function public.marketing_ads_validation_record(p_request uuid,p_auth_user uuid,p_fingerprint text,p_evidence jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare r marketing_private.ads_changes; actor uuid;
begin
 select * into r from marketing_private.ads_changes where id=p_request for update;
 perform public.marketing_ads_validation_material(p_request,p_auth_user,p_fingerprint);
 if p_evidence is null or jsonb_typeof(p_evidence)<>'object' or length(p_evidence::text)>12000
   or p_evidence->>'mode' is distinct from 'validate_only' or p_evidence->>'campaign_id' is distinct from r.provider_state->>'campaign_id' then
  raise exception 'Invalid validation evidence';end if;
 select id into actor from employees where auth_user_id=p_auth_user;
 insert into marketing_private.ads_change_events(change_id,revision,event,actor,evidence)
 values(r.id,r.revision,'validate_adset',actor,p_evidence);
 -- Deliberately no changes to state, provider_state, approval, configuration, receipt or attribution.
end;$$;
revoke all on function public.marketing_ads_validation_material(uuid,uuid,text),public.marketing_ads_validation_record(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.marketing_ads_validation_material(uuid,uuid,text),public.marketing_ads_validation_record(uuid,uuid,text,jsonb) to service_role;
