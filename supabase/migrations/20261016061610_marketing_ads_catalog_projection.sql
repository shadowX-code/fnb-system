-- A catalog projects configuration once, never discarded historical metrics.
-- Keep the owning RPC's existing access, generation and reporting contracts.
do $migration$ declare f text;old_sql text:=$old$ select coalesce(jsonb_agg(jsonb_build_object('connection_id',c.id,'observed_at',s.observed_at,'payload',jsonb_build_object('configs',projected->'configs','account',projected->'account','scope',projected->'scope','insights','{}'::jsonb,'not_synced',true))),'[]') into catalogs
 from marketing_connections c join lateral(select x.* from marketing_private.ads_snapshots x where x.connection_id=c.id and x.generation=c.credential_generation order by x.observed_at desc limit 1)s on true
 cross join lateral(select marketing_private.ads_project(p_org,c.provider_account_id,s.payload,p_brand,org_access) projected)pr
 where c.organization_id=p_org and c.status in ('test_authorized','production_authorized') and c.expires_at>now() and exists(select 1 from jsonb_array_elements(accounts) a where a->>'id'=c.id::text);
$old$;new_sql text:=$new$ with scoped_catalog as materialized (
  select c.id,s.observed_at,marketing_private.ads_project(p_org,c.provider_account_id,
   jsonb_build_object('configs',s.payload->'configs','account',s.payload->'account','insights','{}'::jsonb),p_brand,org_access) as projected
  from marketing_connections c join lateral(select x.payload,x.observed_at from marketing_private.ads_snapshots x
   where x.connection_id=c.id and x.generation=c.credential_generation order by x.observed_at desc limit 1)s on true
  where c.organization_id=p_org and c.status in ('test_authorized','production_authorized') and c.expires_at>now()
   and exists(select 1 from jsonb_array_elements(accounts) a where a->>'id'=c.id::text)
 )
 select coalesce(jsonb_agg(jsonb_build_object('connection_id',id,'observed_at',observed_at,'payload',
  jsonb_build_object('configs',projected->'configs','account',projected->'account','scope',projected->'scope','insights','{}'::jsonb,'not_synced',true))),'[]')
 into catalogs from scoped_catalog;
$new$;begin
 select pg_get_functiondef('public.marketing_ads_read(uuid,uuid,date,date)'::regprocedure) into f;
 if position(old_sql in f)=0 then raise exception 'Ads catalog contract changed';end if;
 execute replace(f,old_sql,new_sql);
end;$migration$;
