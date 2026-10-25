-- Snapshot payloads are loaded only after current authorization and period selection.
do $$begin
 if md5(pg_get_functiondef('public.marketing_ads_read(uuid,uuid,date,date)'::regprocedure))<>'69edc736949099741c3a55f534790bcd'
 or md5(pg_get_functiondef('marketing_private.ads_visible_snapshots(uuid)'::regprocedure))<>'20c715a881db49385dc8454ebe40f2e6' then raise exception 'Ads reporting source contract changed';end if;
end;$$;
CREATE OR REPLACE FUNCTION marketing_private.ads_visible_snapshot_keys(p_connection uuid)
 RETURNS TABLE(connection_id uuid,generation integer,date_from date,date_to date,observed_at timestamptz,warnings jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 select distinct on(s.date_from,s.date_to) s.connection_id,s.generation,s.date_from,s.date_to,s.observed_at,s.payload->'warnings' warnings
 from marketing_private.ads_snapshots s
 join marketing_connections c on c.id=s.connection_id
 join marketing_private.ads_accounts a on a.connection_id=c.id and a.generation=c.credential_generation and a.read_verified
 join marketing_private.credentials k on k.connection_id=c.id and k.sealed_token is not null
 join marketing_private.meta_subjects subject on subject.connection_id=c.id and subject.generation=c.credential_generation and subject.meta_user_id=k.meta_user_id
 where c.id=p_connection and c.channel='ad_account' and c.status in ('test_authorized','production_authorized') and c.expires_at>now()
 and s.payload#>>'{account,id}'=c.provider_account_id
 and (s.generation=c.credential_generation or exists(
  select 1 from marketing_private.ads_grant_continuity g where g.connection_id=c.id and g.generation=c.credential_generation and g.source_generation=s.generation
   and g.organization_id=c.organization_id and g.account_id=c.provider_account_id and g.meta_user_id=k.meta_user_id))
 order by s.date_from,s.date_to,s.observed_at desc,s.generation desc;
$function$;

create or replace function marketing_private.ads_visible_snapshots(p_connection uuid)
returns setof marketing_private.ads_snapshots language sql stable security definer set search_path=public as $$
 select s.* from marketing_private.ads_visible_snapshot_keys(p_connection) k
 join marketing_private.ads_snapshots s on s.connection_id=k.connection_id and s.generation=k.generation and s.date_from=k.date_from and s.date_to=k.date_to;
$$;
revoke all on function marketing_private.ads_visible_snapshot_keys(uuid),marketing_private.ads_visible_snapshots(uuid) from public,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.marketing_ads_read(p_org uuid, p_brand uuid DEFAULT NULL::uuid, p_from date DEFAULT (CURRENT_DATE - 29), p_to date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare actor uuid:=marketing_private.require_access(p_org,p_brand,'marketing_ads.view');org_access boolean:=marketing_private.ads_org_allowed(actor,p_org,'marketing_ads.view');accounts jsonb;reports jsonb;jobs jsonb;catalogs jsonb;coverage jsonb;
begin
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>1133 then raise exception 'Select a valid reporting period of up to 37 months';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'brand_id',null,'account_id',c.provider_account_id,'account_slot',c.account_slot,'name',c.account_name,'status',c.status,'expires_at',c.expires_at,'generation',c.credential_generation,'last_synced_at',c.last_synced_at,'error_code',c.error_code,'sync',marketing_private.ads_sync_status(c.id,c.credential_generation),'health',case when a.generation=c.credential_generation then (to_jsonb(a)-'connection_id')||jsonb_build_object('automatic_history_enabled',(select automatic_history_enabled from marketing_private.ads_reporting_policy where singleton)) else null end)),'[]') into accounts
 from marketing_connections c left join marketing_private.ads_accounts a on a.connection_id=c.id
 where c.organization_id=p_org and c.channel='ad_account' and (org_access or exists(select 1 from marketing_private.ads_campaign_brands m where m.organization_id=p_org and m.account_id=c.provider_account_id and m.brand_id is not null and (p_brand is null or m.brand_id=p_brand) and marketing_private.brand_allowed(p_org,m.brand_id)));
 -- Authorize metadata once; only selected reports/catalogs load full evidence.
 with scoped as materialized (
  select c.* from marketing_connections c where c.organization_id=p_org and c.channel='ad_account'
   and exists(select 1 from jsonb_array_elements(accounts) a where a->>'id'=c.id::text)
 ), visible as materialized (
  select c.provider_account_id,c.credential_generation,k.* from scoped c
  cross join lateral marketing_private.ads_visible_snapshot_keys(c.id) k
 ), selected as materialized (
  select v.* from visible v where v.date_from=p_from and v.date_to=p_to
 ), latest as materialized (
  select distinct on(v.connection_id) v.* from visible v
  where not exists(select 1 from selected x where x.connection_id=v.connection_id)
  order by v.connection_id,v.observed_at desc,v.generation desc,v.date_from desc,v.date_to desc
 ), scoped_catalog as materialized (
  select v.connection_id,v.observed_at,marketing_private.ads_project(p_org,v.provider_account_id,
   jsonb_build_object('configs',s.payload->'configs','account',s.payload->'account','insights','{}'::jsonb),p_brand,org_access) projected
  from latest v join marketing_private.ads_snapshots s
   on s.connection_id=v.connection_id and s.generation=v.generation and s.date_from=v.date_from and s.date_to=v.date_to
 )
 select
  (select coalesce(jsonb_agg(jsonb_build_object('connection_id',s.connection_id,'date_from',s.date_from,'date_to',s.date_to,'observed_at',s.observed_at,
   'observation_generation',s.generation,'authorization_generation',s.credential_generation,
   'payload',marketing_private.ads_project(p_org,s.provider_account_id,p.payload,p_brand,org_access))),'[]') from selected s
   join marketing_private.ads_snapshots p on p.connection_id=s.connection_id and p.generation=s.generation and p.date_from=s.date_from and p.date_to=s.date_to),
  (select coalesce(jsonb_agg(jsonb_build_object('connection_id',connection_id,'observed_at',observed_at,'payload',
   jsonb_build_object('configs',projected->'configs','account',projected->'account','scope',projected->'scope','insights','{}'::jsonb,'not_synced',true))),'[]') from scoped_catalog),
  (select coalesce(jsonb_agg(jsonb_build_object('connection_id',c.id,'request_floor',((now() at time zone h.timezone)-interval '37 months')::date,
   'ranges',(select coalesce(jsonb_agg(jsonb_build_object('from',v.date_from,'to',v.date_to,'observed_at',v.observed_at,'warnings',v.warnings) order by v.date_from,v.date_to),'[]')
    from visible v where v.connection_id=c.id))),'[]')
   from scoped c join marketing_private.ads_accounts h on h.connection_id=c.id and h.generation=c.credential_generation
   where c.status in ('test_authorized','production_authorized') and c.expires_at>now())
 into reports,catalogs,coverage;
 select case when org_access then coalesce(jsonb_agg((to_jsonb(j)-array['lease','lease_until','actor_employee_id','progress'])||jsonb_build_object('progress',jsonb_build_object('step',j.progress->'step','requests',j.progress->'requests'))),'[]') else '[]' end into jobs
 from marketing_private.ads_sync_jobs j join marketing_connections c on c.id=j.connection_id and c.credential_generation=j.generation where c.organization_id=p_org and (j.state in ('queued','leased','retry') or j.created_at>now()-interval '1 day');
 return jsonb_build_object('accounts',accounts,'reports',reports,'catalogs',catalogs,'coverage',coverage,'jobs',jobs,'organization_access',org_access,'external_execution_enabled',false);
end;$function$;
