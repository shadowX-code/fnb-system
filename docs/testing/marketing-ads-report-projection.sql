-- Canonical Staging only; synthetic fixtures and claims always roll back.
-- Frozen previous read is a test oracle, never an alternative runtime pipeline.
begin;
set local statement_timeout='8s';
-- Rollback-only representative evidence, derived exclusively from existing Staging data.
create temporary table qa_ads_perf(k text primary key,v jsonb);
do $$declare o uuid:=gen_random_uuid();a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();c uuid:=gen_random_uuid();actor uuid;uid uuid;p jsonb;large jsonb;short jsonb;campaigns jsonb;rows jsonb;days jsonb;sets jsonb;creatives jsonb;set_rows jsonb;ad_rows jsonb;level text;entries jsonb;n integer;begin
 select e.id,e.auth_user_id into actor,uid from employees e where e.auth_user_id is not null and marketing_private.ads_org_allowed(e.id,'ec42a08a-0f59-4b7b-a48e-b2faacf9eaf1','marketing_ads.view') limit 1;
 perform set_config('request.jwt.claim.sub',uid::text,true);
 insert into organizations(id,name) values(o,'Rollback Ads performance fixture');
 insert into organization_memberships values(o,actor);
 update platform_member_brand_scopes set all_brands=true where organization_id=o and employee_id=actor;
 insert into brands(id,organization_id,name) values(a,o,'Synthetic A'),(b,o,'Synthetic B');
 insert into marketing_connections(id,organization_id,channel,account_slot,provider_account_id,account_name,status,credential_generation,expires_at,connected_by)
 values(c,o,'ad_account','99999333444','99999333444','Rollback performance account','test_authorized',1,now()+interval '1 day',actor);
 insert into marketing_private.credentials(connection_id,credential_reference,sealed_token,meta_user_id,expires_at) values(c,'rollback-only','{"synthetic":true}','999001',now()+interval '1 day');
 insert into marketing_private.meta_subjects values(c,1,'999001');
 insert into marketing_private.ads_accounts(connection_id,generation,currency,timezone,account_status,tasks,read_verified,manage_verified,granted_scopes)
 values(c,1,'MYR','Asia/Singapore',1,'["ADVERTISE"]',true,false,'["ads_read"]');
 select payload into p from marketing_private.ads_snapshots where connection_id='050dc072-ddda-4e88-8270-8cce47fa7dfa' and generation=2 and date_from='2025-10-17' and date_to='2026-10-16';
 assert p is not null,'Existing Staging report template required';
 select jsonb_agg(((p#>'{configs,campaigns}')->((i-1)%jsonb_array_length(p#>'{configs,campaigns}')))||jsonb_build_object('id',(9900000000+i)::text,'name','Synthetic Campaign '||i,'status','PAUSED')) into campaigns from generate_series(1,52)i;
 select jsonb_agg(jsonb_set((p#>'{insights,campaign}')->((i-1)%6),'{metrics,spend,value}',to_jsonb(case when i=1 then 0 when i=36 then 320 else 20 end))||
  jsonb_build_object('account_id','99999333444','campaign_id',(9900000000+i)::text,'currency','MYR','date_start','2023-09-16','date_stop','2026-10-16')) into rows from generate_series(1,36)i;
 select jsonb_agg(jsonb_set((p#>'{insights,daily}')->((i-1)%347),'{metrics,spend,value}',to_jsonb((93+case when i<=490 then 1 else 0 end)::numeric/100))||
  jsonb_build_object('account_id','99999333444','currency','MYR','date_start',('2023-09-16'::date+i-1)::text,'date_stop',('2023-09-16'::date+i-1)::text)) into days from generate_series(1,1070)i;
 select jsonb_agg(((p#>'{configs,adsets}')->((i-1)%jsonb_array_length(p#>'{configs,adsets}')))||jsonb_build_object('id',(9910000000+i)::text,'campaign_id',(9900000001+(i-1)%52)::text)) into sets from generate_series(1,84)i;
 select jsonb_agg(((p#>'{configs,ads}')->((i-1)%jsonb_array_length(p#>'{configs,ads}')))||jsonb_build_object('id',(9920000000+i)::text,'campaign_id',(9900000001+(i-1)%52)::text,'adset_id',(9910000001+(i-1)%84)::text)) into creatives from generate_series(1,97)i;
 select jsonb_agg(((p#>'{insights,adset}')->((i-1)%6))||jsonb_build_object('account_id','99999333444','adset_id',(9910000000+i)::text,'campaign_id',(9900000001+(i-1)%36)::text,'currency','MYR','date_start','2023-09-16','date_stop','2026-10-16')) into set_rows from generate_series(1,64)i;
 select jsonb_agg(((p#>'{insights,ad}')->((i-1)%7))||jsonb_build_object('account_id','99999333444','ad_id',(9920000000+i)::text,'campaign_id',(9900000001+(i-1)%36)::text,'currency','MYR','date_start','2023-09-16','date_stop','2026-10-16')) into ad_rows from generate_series(1,77)i;
 p:=jsonb_set(p,'{account,id}','"99999333444"');
 p:=p||jsonb_build_object('date_from','2023-09-16','date_to','2026-10-16','configs',jsonb_build_object('campaigns',campaigns,'adsets',sets,'ads',creatives),
  'insights',jsonb_build_object('campaign',rows,'daily',days,'adset',set_rows,'ad',ad_rows,'account',jsonb_build_array(jsonb_set((p#>'{insights,account,0}')||'{"account_id":"99999333444","currency":"MYR","date_start":"2023-09-16","date_stop":"2026-10-16"}','{metrics,spend,value}','1000'))),
  'warnings','{"fixture":"Synthetic performance evidence; not Meta observations"}'::jsonb);
 p:=p||jsonb_build_object('insight_attribution','FeedX rollback-only synthetic Meta Insights provenance; no provider observations. Account-timezone dates; original field semantics retained.');
 for level,entries in select * from jsonb_each(p->'insights') loop
  p:=jsonb_set(p,array['insights',level],(select jsonb_agg(x-'attribution' order by ord) from jsonb_array_elements(entries) with ordinality e(x,ord)));
 end loop;
 p:=jsonb_set(p,'{insights,campaign,1,metrics,clicks,value}','null');
 p:=jsonb_set(p,'{insights,daily,0,attribution}','"Explicit synthetic provenance override"');
 assert octet_length(p::text)>=2500000,'Large-report fixture must exercise real payload volume';
 assert octet_length(p::text)<=3000000,'Representative packed evidence exceeds existing size guard';
 insert into marketing_private.ads_snapshots values(c,1,'2023-09-16','2026-10-16',now()-interval '1 hour',p);
 for n in 0..22 loop
  short:=jsonb_set(p,'{insights,daily}',(select jsonb_agg(x) from jsonb_array_elements(days) with ordinality d(x,i) where i<=30));
  short:=short||jsonb_build_object('date_from',('2024-01-01'::date+make_interval(months=>n))::date,'date_to',('2024-01-01'::date+make_interval(months=>n)+interval '1 month -1 day')::date);
  insert into marketing_private.ads_snapshots values(c,1,('2024-01-01'::date+make_interval(months=>n))::date,('2024-01-01'::date+make_interval(months=>n)+interval '1 month -1 day')::date,now()-make_interval(hours=>25-n),short);
 end loop;
 insert into marketing_private.ads_campaign_brands(organization_id,account_id,campaign_id,brand_id,revision,assigned_by,assigned_at)
 select o,'99999333444',(9900000000+i)::text,case when i<=20 then a else b end,1,actor,now() from generate_series(1,35)i;
 assert (select count(*) from marketing_private.ads_visible_snapshots(c))=24,'Fixture history unavailable';
 assert marketing_private.ads_org_allowed(actor,o,'marketing_ads.view'),'Fixture Owner scope unavailable';
 insert into qa_ads_perf values('org',to_jsonb(o)),('connection',to_jsonb(c)),('a',to_jsonb(a)),('b',to_jsonb(b)),('actor',to_jsonb(actor)),('uid',to_jsonb(uid));
end;$$;

CREATE OR REPLACE FUNCTION pg_temp.ads_read_previous(p_org uuid, p_brand uuid DEFAULT NULL::uuid, p_from date DEFAULT (CURRENT_DATE - 29), p_to date DEFAULT CURRENT_DATE)
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
 select coalesce(jsonb_agg(jsonb_build_object('connection_id',s.connection_id,'date_from',s.date_from,'date_to',s.date_to,'observed_at',s.observed_at,'payload',marketing_private.ads_project(p_org,c.provider_account_id,s.payload,p_brand,org_access))),'[]') into reports
 from marketing_private.ads_snapshots s join marketing_connections c on c.id=s.connection_id and c.credential_generation=s.generation
 where c.organization_id=p_org and s.date_from=p_from and s.date_to=p_to and c.status in ('test_authorized','production_authorized') and c.expires_at>now() and exists(select 1 from jsonb_array_elements(accounts) a where a->>'id'=c.id::text);
 -- Configuration is a catalog, never evidence of metric availability in another period.
 with scoped_catalog as materialized (
  select c.id,s.observed_at,marketing_private.ads_project(p_org,c.provider_account_id,
   jsonb_build_object('configs',s.payload->'configs','account',s.payload->'account','insights','{}'::jsonb),p_brand,org_access) as projected
  from marketing_connections c join lateral(select x.payload,x.observed_at from marketing_private.ads_snapshots x
   where x.connection_id=c.id and x.generation=c.credential_generation order by x.observed_at desc limit 1)s on true
  where c.organization_id=p_org and c.status in ('test_authorized','production_authorized') and c.expires_at>now()
   and exists(select 1 from jsonb_array_elements(accounts) a where a->>'id'=c.id::text)
   and not exists(select 1 from jsonb_array_elements(reports) r where r->>'connection_id'=c.id::text)
 )
 select coalesce(jsonb_agg(jsonb_build_object('connection_id',id,'observed_at',observed_at,'payload',
  jsonb_build_object('configs',projected->'configs','account',projected->'account','scope',projected->'scope','insights','{}'::jsonb,'not_synced',true))),'[]')
 into catalogs from scoped_catalog;
 select coalesce(jsonb_agg(jsonb_build_object('connection_id',c.id,'request_floor',((now() at time zone h.timezone)-interval '37 months')::date,
 'ranges',(select coalesce(jsonb_agg(jsonb_build_object('from',s.date_from,'to',s.date_to,'observed_at',s.observed_at,'warnings',s.payload->'warnings') order by s.date_from,s.date_to),'[]') from marketing_private.ads_snapshots s where s.connection_id=c.id and s.generation=c.credential_generation))), '[]') into coverage
 from marketing_connections c join marketing_private.ads_accounts h on h.connection_id=c.id and h.generation=c.credential_generation where c.organization_id=p_org and c.status in ('test_authorized','production_authorized') and c.expires_at>now() and exists(select 1 from jsonb_array_elements(accounts) a where a->>'id'=c.id::text);
 select case when org_access then coalesce(jsonb_agg((to_jsonb(j)-array['lease','lease_until','actor_employee_id','progress'])||jsonb_build_object('progress',jsonb_build_object('step',j.progress->'step','requests',j.progress->'requests'))),'[]') else '[]' end into jobs
 from marketing_private.ads_sync_jobs j join marketing_connections c on c.id=j.connection_id and c.credential_generation=j.generation where c.organization_id=p_org and (j.state in ('queued','leased','retry') or j.created_at>now()-interval '1 day');
 return jsonb_build_object('accounts',accounts,'reports',reports,'catalogs',catalogs,'coverage',coverage,'jobs',jobs,'organization_access',org_access,'external_execution_enabled',false);
end;$function$;

create temporary table qa_ads_results(k text primary key,r jsonb,ms numeric);
do $$declare o uuid:=(select (v#>>'{}')::uuid from qa_ads_perf where k='org');r jsonb;t timestamptz:=clock_timestamp();begin
 r:=public.marketing_ads_read(o,null,'2023-09-16','2026-10-16');
 assert jsonb_array_length(r->'reports')=1 and jsonb_array_length(r#>'{reports,0,payload,insights,campaign}')=36 and jsonb_array_length(r#>'{reports,0,payload,insights,daily}')=1070,'Complete large report was not read';
 assert jsonb_array_length(r#>'{reports,0,payload,configs,campaigns}')=52;
 assert jsonb_array_length(r#>'{coverage,0,ranges}')=24;
 assert r#>'{reports,0,payload,insights,campaign,0,metrics,spend,value}'='0';
 assert r#>'{reports,0,payload,insights,campaign,1,metrics,clicks,value}'='null';
 assert r#>>'{reports,0,payload,insights,daily,0,attribution}'='Explicit synthetic provenance override';
 assert (select sum((x#>>'{metrics,spend,value}')::numeric) from jsonb_array_elements(r#>'{reports,0,payload,insights,campaign}')x)=1000;
 insert into qa_ads_results values('initial',r,extract(epoch from clock_timestamp()-t)*1000);
end;$$;
do $$declare o uuid:=(select (v#>>'{}')::uuid from qa_ads_perf where k='org');r jsonb;t timestamptz:=clock_timestamp();begin
 r:=pg_temp.ads_read_previous(o,null,'2023-09-16','2026-10-16');
 insert into qa_ads_results values('previous_contract',r,extract(epoch from clock_timestamp()-t)*1000);
end;$$;
do $$declare fixed jsonb:=(select q.r from qa_ads_results q where k='initial');previous jsonb:=(select q.r from qa_ads_results q where k='previous_contract');begin
 fixed:=jsonb_set(fixed,'{reports}',(select jsonb_agg(x-'observation_generation'-'authorization_generation') from jsonb_array_elements(fixed->'reports')x));
 assert fixed=previous,'Historical report contract or complete evidence changed';
end;$$;
do $$declare o uuid:=(select (v#>>'{}')::uuid from qa_ads_perf where k='org');r jsonb;t timestamptz:=clock_timestamp();begin
 r:=public.marketing_ads_read(o,null,'2023-09-16','2026-10-16');
 assert r=(select q.r from qa_ads_results q where k='initial'),'Background refresh changed evidence';
 insert into qa_ads_results values('background',r,extract(epoch from clock_timestamp()-t)*1000);
end;$$;
do $$declare o uuid:=(select (v#>>'{}')::uuid from qa_ads_perf where k='org');r jsonb;old jsonb;t timestamptz:=clock_timestamp();begin
 r:=public.marketing_ads_read(o,null,'2026-01-01','2026-01-31');old:=pg_temp.ads_read_previous(o,null,'2026-01-01','2026-01-31');
 assert r=old,'Unobserved period/catalog/coverage semantics changed';
 assert r->'reports'='[]' and r#>'{catalogs,0,payload,not_synced}'='true';
 insert into qa_ads_results values('missing_period',r,extract(epoch from clock_timestamp()-t)*1000);
end;$$;
do $$declare o uuid:=(select (v#>>'{}')::uuid from qa_ads_perf where k='org');b uuid:=(select (v#>>'{}')::uuid from qa_ads_perf where k='a');r jsonb;old jsonb;normalized jsonb;begin
 r:=public.marketing_ads_read(o,b,'2023-09-16','2026-10-16');old:=pg_temp.ads_read_previous(o,b,'2023-09-16','2026-10-16');
 normalized:=jsonb_set(r,'{reports}',(select jsonb_agg(x-'observation_generation'-'authorization_generation') from jsonb_array_elements(r->'reports')x));
 assert normalized=old,'Brand projection changed';
 assert jsonb_array_length(r#>'{reports,0,payload,configs,campaigns}')=20;
 assert r#>'{reports,0,payload,insights,daily}'='[]','Shared daily spend leaked into Brand totals';
 insert into qa_ads_results values('brand',r,null);
end;$$;
do $$declare c uuid:=(select (v#>>'{}')::uuid from qa_ads_perf where k='connection');o uuid:=(select (v#>>'{}')::uuid from qa_ads_perf where k='org');r jsonb;begin
 update marketing_connections set credential_generation=2 where id=c;
 update marketing_private.ads_accounts set generation=2 where connection_id=c;
 insert into marketing_private.meta_subjects values(c,2,'999001');
 insert into marketing_private.ads_grant_continuity(connection_id,generation,source_generation,organization_id,account_id,meta_user_id) values(c,2,1,o,'99999333444','999001');
 r:=public.marketing_ads_read(o,null,'2023-09-16','2026-10-16');
 assert r#>>'{reports,0,observation_generation}'='1' and r#>>'{reports,0,authorization_generation}'='2';
 assert r#>'{reports,0,payload}'=(select q.r#>'{reports,0,payload}' from qa_ads_results q where k='initial'),'Rotation rewrote report evidence';
 assert jsonb_array_length(r#>'{coverage,0,ranges}')=24;
 update marketing_private.ads_accounts set read_verified=false where connection_id=c;
 r:=public.marketing_ads_read(o,null,'2023-09-16','2026-10-16');
 assert r->'reports'='[]' and r->'catalogs'='[]','Revoked read authority exposed payload';
 assert (select count(*) from marketing_private.ads_visible_snapshots(c))=0;
 assert not has_function_privilege('authenticated','marketing_private.ads_visible_snapshot_keys(uuid)','execute');
 assert not has_function_privilege('anon','marketing_private.ads_visible_snapshot_keys(uuid)','execute');
end;$$;
select jsonb_agg(jsonb_build_object('case',k,'ms',ms,'response_chars',octet_length(r::text),'reports',jsonb_array_length(r->'reports')) order by k) verification from qa_ads_results;

rollback;
