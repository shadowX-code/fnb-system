-- Minimal account choices contain no account spend or other-brand campaigns.
do $$ declare body text;begin
 select pg_get_functiondef('public.marketing_ads_changes_read(uuid,uuid)'::regprocedure) into body;
 body:=replace(body,'''external_execution_enabled'',false)', $patch$'external_execution_enabled',false,'accounts',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'account_id',c.provider_account_id,'name',c.account_name,'health',jsonb_build_object('currency',a.currency,'timezone',a.timezone,'manage_verified',a.manage_verified))) from marketing_connections c join marketing_private.ads_accounts a on a.connection_id=c.id and a.generation=c.credential_generation where c.organization_id=p_org and c.channel='ad_account' and c.status in ('test_authorized','production_authorized') and a.read_verified and (marketing_private.ads_org_allowed(actor,p_org,'marketing_ads.manage') or (p_brand is not null and marketing_private.actor_allowed(actor,p_org,p_brand,'marketing_ads.manage')))),'[]'::jsonb))$patch$);
 execute body;
end $$;
