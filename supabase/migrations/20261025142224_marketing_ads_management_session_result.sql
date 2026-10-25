-- Reuse the canonical OAuth begin response envelope without changing its public contract.
create or replace function public.marketing_ads_management_begin(p_org uuid,p_state_hash text,p_config_id text)
returns uuid language plpgsql security definer set search_path=public as $$
declare session_id uuid;
begin
 if coalesce(p_config_id,'') !~ '^[0-9]{1,30}$' then raise exception 'Dedicated Ads Management login is not configured.';end if;
 session_id:=(public.marketing_ads_begin(p_org,null,p_state_hash)->>'id')::uuid;
 update marketing_private.oauth_sessions set ads_management_config_id=p_config_id where id=session_id;
 return session_id;
end;$$;
