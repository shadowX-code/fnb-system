-- Canonical Staging only. 26 rollback-only synthetic observations; no Production payloads.
-- Match Production work_mem downward, never change runtime settings or timeout limits.
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
 select jsonb_agg(jsonb_set((p#>'{insights,campaign}')->((i-1)%6),'{metrics,spend,value}',to_jsonb(case when i=1 then 0 when i=36 then 15687.39 else 1000 end))||
  jsonb_build_object('account_id','99999333444','campaign_id',(9900000000+i)::text,'currency','MYR','date_start','2023-09-16','date_stop','2026-10-16')) into rows from generate_series(1,36)i;
 select jsonb_agg(jsonb_set((p#>'{insights,daily}')->((i-1)%347),'{metrics,spend,value}',to_jsonb((4643+case when i<=729 then 1 else 0 end)::numeric/100))||
  jsonb_build_object('account_id','99999333444','currency','MYR','date_start',('2023-09-16'::date+i-1)::text,'date_stop',('2023-09-16'::date+i-1)::text)) into days from generate_series(1,1070)i;
 select jsonb_agg(((p#>'{configs,adsets}')->((i-1)%jsonb_array_length(p#>'{configs,adsets}')))||jsonb_build_object('id',(9910000000+i)::text,'campaign_id',(9900000001+(i-1)%52)::text)) into sets from generate_series(1,84)i;
 select jsonb_agg(((p#>'{configs,ads}')->((i-1)%jsonb_array_length(p#>'{configs,ads}')))||jsonb_build_object('id',(9920000000+i)::text,'campaign_id',(9900000001+(i-1)%52)::text,'adset_id',(9910000001+(i-1)%84)::text)) into creatives from generate_series(1,97)i;
 select jsonb_agg(((p#>'{insights,adset}')->((i-1)%6))||jsonb_build_object('account_id','99999333444','adset_id',(9910000000+i)::text,'campaign_id',(9900000001+(i-1)%36)::text,'currency','MYR','date_start','2023-09-16','date_stop','2026-10-16')) into set_rows from generate_series(1,64)i;
 select jsonb_agg(((p#>'{insights,ad}')->((i-1)%7))||jsonb_build_object('account_id','99999333444','ad_id',(9920000000+i)::text,'campaign_id',(9900000001+(i-1)%36)::text,'currency','MYR','date_start','2023-09-16','date_stop','2026-10-16')) into ad_rows from generate_series(1,77)i;
 p:=jsonb_set(p,'{account,id}','"99999333444"');
 p:=p||jsonb_build_object('date_from','2023-09-16','date_to','2026-10-16','configs',jsonb_build_object('campaigns',campaigns,'adsets',sets,'ads',creatives),
  'insights',jsonb_build_object('campaign',rows,'daily',days,'adset',set_rows,'ad',ad_rows,'account',jsonb_build_array(jsonb_set((p#>'{insights,account,0}')||'{"account_id":"99999333444","currency":"MYR","date_start":"2023-09-16","date_stop":"2026-10-16"}','{metrics,spend,value}','49687.39'))),
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
 for n in 0..24 loop
  short:=jsonb_set(p,'{insights,daily}',(select jsonb_agg(x) from jsonb_array_elements(days) with ordinality d(x,i) where i<=30));
  short:=short||jsonb_build_object('date_from',('2024-01-01'::date+make_interval(months=>n))::date,'date_to',('2024-01-01'::date+make_interval(months=>n)+interval '1 month -1 day')::date);
  insert into marketing_private.ads_snapshots values(c,1,('2024-01-01'::date+make_interval(months=>n))::date,('2024-01-01'::date+make_interval(months=>n)+interval '1 month -1 day')::date,now()-make_interval(hours=>25-n),short);
 end loop;
 insert into marketing_private.ads_campaign_brands(organization_id,account_id,campaign_id,brand_id,revision,assigned_by,assigned_at)
 select o,'99999333444',(9900000000+i)::text,case when i<=20 then a else b end,1,actor,now() from generate_series(1,35)i;
 assert (select count(*) from marketing_private.ads_visible_snapshots(c))=26,'Fixture history unavailable';
 assert marketing_private.ads_org_allowed(actor,o,'marketing_ads.view'),'Fixture Owner scope unavailable';
 insert into qa_ads_perf values('org',to_jsonb(o)),('connection',to_jsonb(c)),('a',to_jsonb(a)),('b',to_jsonb(b)),('actor',to_jsonb(actor)),('uid',to_jsonb(uid));
end;$$;


set local work_mem='2184kB';
create function pg_temp.ads_unpack_reference(p jsonb) returns jsonb language plpgsql as $$
declare k text;v jsonb;common jsonb:=p->'insight_attribution';begin
 if common is null then return p;end if;
 for k,v in select * from jsonb_each(p->'insights') loop
  p:=jsonb_set(p,array['insights',k],(select coalesce(jsonb_agg(case when r ? 'attribution' then r else r||jsonb_build_object('attribution',common) end order by ord),'[]') from jsonb_array_elements(v) with ordinality entries(r,ord)));
 end loop;
 return p-'insight_attribution';
end;$$;
CREATE OR REPLACE FUNCTION pg_temp.ads_project_reference(p_org uuid, p_account text, p_payload jsonb, p_brand uuid, p_org_access boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare campaigns jsonb;adsets jsonb;ads jsonb;insights jsonb:='{}';k text;v jsonb; attribution jsonb;
begin
p_payload:=pg_temp.ads_unpack_reference(p_payload);
select coalesce(jsonb_agg(a||jsonb_build_object('feedx_brand_id',m.brand_id,'feedx_attribution_revision',coalesce(m.revision,0))),'[]') into campaigns from jsonb_array_elements(p_payload#>'{configs,campaigns}') a left join marketing_private.ads_campaign_brands m on m.organization_id=p_org and m.account_id=p_account and m.campaign_id=a->>'id' where (p_org_access and p_brand is null) or (m.brand_id is not null and (p_brand is null or m.brand_id=p_brand) and marketing_private.brand_allowed(p_org,m.brand_id));
select coalesce(jsonb_agg(a),'[]') into adsets from jsonb_array_elements(p_payload#>'{configs,adsets}') a where exists(select 1 from jsonb_array_elements(campaigns) c where c->>'id'=a->>'campaign_id');
select coalesce(jsonb_agg(a),'[]') into ads from jsonb_array_elements(p_payload#>'{configs,ads}') a where exists(select 1 from jsonb_array_elements(campaigns) c where c->>'id'=a->>'campaign_id');
for k,v in select * from jsonb_each(p_payload->'insights') loop
if k in ('account','daily') then insights:=insights||jsonb_build_object(k,case when p_org_access and p_brand is null then v else '[]'::jsonb end);
else insights:=insights||jsonb_build_object(k,(select coalesce(jsonb_agg(a),'[]') from jsonb_array_elements(v) a where exists(select 1 from jsonb_array_elements(campaigns) c where c->>'id'=a->>'campaign_id')));end if;
end loop;
if not (p_org_access and p_brand is null) then insights:=insights||jsonb_build_object('account',marketing_private.ads_scope_totals(p_payload,campaigns,coalesce(insights->'campaign','[]')));end if; if p_org_access and p_brand is null then insights:=insights||jsonb_build_object('attribution_spend',(select coalesce(jsonb_agg(q),'[]') from (select c->>'feedx_brand_id' brand_id,count(*) campaigns,count(r->>'campaign_id') reported_campaigns,sum((r#>>'{metrics,spend,value}')::numeric) reported_spend from jsonb_array_elements(campaigns) c left join lateral (select a from jsonb_array_elements(coalesce(insights->'campaign','[]')) a where a->>'campaign_id'=c->>'id' and a->>'currency'=p_payload#>>'{account,currency}' and a->>'date_start'=p_payload->>'date_from' and a->>'date_stop'=p_payload->>'date_to' limit 1) v(r) on true group by c->>'feedx_brand_id') q));end if; if not (p_org_access and p_brand is null) then insights:=insights||jsonb_build_object('scope_coverage',marketing_private.ads_reporting_coverage(p_payload,campaigns,coalesce(insights->'campaign','[]')));end if; return p_payload||jsonb_build_object('configs',jsonb_build_object('campaigns',campaigns,'adsets',adsets,'ads',ads),'insights',insights,'scope',case when p_org_access and p_brand is null then 'organization' else 'attributed_campaigns' end);
end;$function$;
create temporary table qa_ads_repeats(run integer,ms numeric,digest text,bytes integer,campaigns integer,daily integer,spend numeric);
create function pg_temp.qa_ads_repeat(run integer) returns void language plpgsql as $$
declare t timestamptz:=clock_timestamp();r jsonb;p jsonb;begin
 r:=public.marketing_ads_read((select (v#>>'{}')::uuid from qa_ads_perf where k='org'),null,'2023-09-16','2026-10-16');
 p:=r#>'{reports,0,payload}';
 assert jsonb_array_length(r#>'{coverage,0,ranges}')=26,'Incomplete metadata history';
 assert jsonb_array_length(p#>'{configs,campaigns}')=52,'Incomplete campaign catalogue/pagination';
 assert jsonb_array_length(p#>'{insights,campaign}')=36,'Incomplete campaign rows';
 assert jsonb_array_length(p#>'{insights,daily}')=1070,'Incomplete daily rows';
 assert (p#>>'{insights,account,0,metrics,spend,value}')::numeric=49687.39,'Account reconciliation';
 assert (select sum((x#>>'{metrics,spend,value}')::numeric) from jsonb_array_elements(p#>'{insights,campaign}')x)=49687.39,'Campaign reconciliation';
 assert (select sum((x#>>'{metrics,spend,value}')::numeric) from jsonb_array_elements(p#>'{insights,daily}')x)=49687.39,'Daily reconciliation';
 insert into qa_ads_repeats values(run,1000*extract(epoch from clock_timestamp()-t),md5(r::text),octet_length(r::text),36,1070,49687.39);
end;$$;
do $$declare p jsonb;o uuid;a uuid;begin
 select (v#>>'{}')::uuid into o from qa_ads_perf where k='org';select (v#>>'{}')::uuid into a from qa_ads_perf where k='a';
 select payload into p from marketing_private.ads_snapshots where connection_id=(select (v#>>'{}')::uuid from qa_ads_perf where k='connection') and date_from='2023-09-16';
 assert marketing_private.ads_project(o,'99999333444',p,null,true)=pg_temp.ads_project_reference(o,'99999333444',p,null,true),'Organization complete projection changed';
 assert marketing_private.ads_project(o,'99999333444',p,a,true)=pg_temp.ads_project_reference(o,'99999333444',p,a,true),'Brand complete projection changed';
end;$$;
select pg_temp.qa_ads_repeat(1);
select pg_temp.qa_ads_repeat(2);
select pg_temp.qa_ads_repeat(3);
select pg_temp.qa_ads_repeat(4);
select pg_temp.qa_ads_repeat(5);
select pg_temp.qa_ads_repeat(6);
select pg_temp.qa_ads_repeat(7);
select pg_temp.qa_ads_repeat(8);
do $$begin assert (select count(distinct digest) from qa_ads_repeats)=1,'Repeated response evidence changed';assert (select max(ms) from qa_ads_repeats)<8000,'Read exceeds existing limit';end;$$;
select * from qa_ads_repeats order by run;
rollback;
