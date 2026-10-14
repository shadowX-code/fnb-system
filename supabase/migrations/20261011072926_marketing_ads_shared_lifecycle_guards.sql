-- Reconnect the same organization-owned slot after credential revocation; preserve generation checks.
do $$ declare f text;begin
select pg_get_functiondef('public.marketing_ads_bind(uuid,uuid,text,uuid,jsonb,timestamptz,jsonb,integer)'::regprocedure) into f;
if position('where channel=''ad_account'' and (provider_account_id=p_account) for update' in f)=0 then raise exception 'Shared account bind contract changed';end if;
f:=replace(f,'where channel=''ad_account'' and (provider_account_id=p_account) for update','where channel=''ad_account'' and (provider_account_id=p_account or organization_id=s.organization_id and account_slot=p_account) for update');execute f;
end $$;
