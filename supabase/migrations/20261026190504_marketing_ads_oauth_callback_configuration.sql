-- Project the persisted configuration without changing OAuth lifetime, scope or single-use authority.
create or replace function public.marketing_meta_consume(p_state_hash text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare s marketing_private.oauth_sessions;
begin
 select * into s from marketing_private.oauth_sessions where state_hash=p_state_hash for update;
 if not found or s.consumed_at is not null or s.expires_at<=now() then raise exception using errcode='42501',message='Meta authorization expired or was already used.';end if;
 if not (case when s.purpose='ads' then marketing_private.ads_org_allowed(s.actor_employee_id,s.organization_id,'marketing_ads.connect') else marketing_private.actor_allowed(s.actor_employee_id,s.organization_id,s.brand_id,'marketing_settings.configure') end) then raise exception using errcode='42501',message='Meta authorization scope was revoked.';end if;
 update marketing_private.oauth_sessions set consumed_at=now() where id=s.id;
 return jsonb_build_object('id',s.id,'organization_id',s.organization_id,'brand_id',s.brand_id,'actor_employee_id',s.actor_employee_id,'redirect_uri',s.redirect_uri,'purpose',s.purpose,
  'ads_management_config_id',s.ads_management_config_id);
end;$$;
