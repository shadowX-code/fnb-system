-- L3 read-projection rehearsal. Synthetic snapshot evidence exists only within this rollback.
begin;
select set_config('request.jwt.claim.sub','b6ee4db2-0f37-4b3e-a3ee-fa804ec5e6cd',true);
do $$declare c public.marketing_connections;r jsonb;v jsonb;begin
 select * into strict c from public.marketing_connections where brand_id='0aa8ac72-6c63-4eb5-a024-1e942e6dbe4e' and channel='facebook' and status in ('test_authorized','production_authorized');
 insert into public.marketing_social_daily_observations(connection_id,connection_generation,provider_post_id,observation_date,organization_id,brand_id,channel,provider_account_id,observed_at,metrics,unavailable_metrics,metric_provenance)
 select c.id,c.credential_generation,'qa-social-projection-only',day::date,c.organization_id,c.brand_id,c.channel,c.provider_account_id,day+interval '12 hours',
 jsonb_build_object('views',case extract(day from day) when 30 then 10 when 1 then 10 when 2 then 20 when 3 then 25 else 5 end,'interactions',0),'{}',
 jsonb_build_object('views',jsonb_build_object('source',case when day::date='2025-10-03' then 'insights.changed_source' else 'insights.post_media_view' end,'period','lifetime','definition','views','graph_version','v26.0','observed_at',day+interval '12 hours'),
 'interactions',jsonb_build_object('source','insights.post_activity_by_action_type','period','lifetime','definition','actions','graph_version','v26.0','observed_at',day+interval '12 hours'))
 from generate_series('2025-09-30'::timestamp,'2025-10-04'::timestamp,interval '1 day') day;
 r:=public.marketing_social_performance(c.organization_id,c.brand_id,'2025-10-01','2025-10-05','day');
 select value into v from jsonb_array_elements(r->'rows') where value->>'metric'='views' and value->>'channel'='facebook' and value->>'ending'='2025-10-01';
 assert (v->>'growth')::numeric=0 and (v->>'paired_posts')::int=1,'Observed zero must remain zero';
 select value into v from jsonb_array_elements(r->'rows') where value->>'metric'='views' and value->>'channel'='facebook' and value->>'ending'='2025-10-02';
 assert (v->>'growth')::numeric=10,'Exact baseline pair';
 assert not exists(select 1 from jsonb_array_elements(r->'rows') x where x->>'metric'='views' and x->>'channel'='facebook' and x->>'ending' in ('2025-10-03','2025-10-04','2025-10-05') and x->>'growth' is not null),'Changed provenance, decrease or absent day cannot establish growth';
 assert not exists(select 1 from jsonb_array_elements(r->'rows') x where x->>'channel'='instagram' and x->>'cumulative' is not null),'Never cross channels';
 r:=public.marketing_social_performance(c.organization_id,c.brand_id,'2025-10-01','2025-10-04','week');
 select value into v from jsonb_array_elements(r->'rows') where value->>'metric'='views' and value->>'channel'='facebook';
 assert (v->>'cumulative')::numeric=5 and v->>'growth' is null,'Weekly ending total is not sum; counter regression is unavailable';
 r:=public.marketing_social_performance(c.organization_id,c.brand_id,'2025-10-01','2025-10-04','month');
 select value into v from jsonb_array_elements(r->'rows') where value->>'metric'='interactions' and value->>'channel'='facebook';
 assert (v->>'cumulative')::numeric=0 and (v->>'growth')::numeric=0,'Monthly zero remains zero';
 -- Exact active grant only; no observation from a revoked generation can pair.
 update public.marketing_social_daily_observations set connection_generation=c.credential_generation+99 where provider_post_id='qa-social-projection-only';
 r:=public.marketing_social_performance(c.organization_id,c.brand_id,'2025-10-01','2025-10-04','day');
 assert not exists(select 1 from jsonb_array_elements(r->'rows') x where x->>'cumulative' is not null),'Inactive generation excluded';
 begin perform public.marketing_social_performance(c.organization_id,c.brand_id,'2025-10-04','2025-10-01','day');raise exception 'Invalid range accepted';exception when raise_exception then if sqlerrm='Invalid range accepted' then raise;end if;end;
 begin perform public.marketing_social_performance(c.organization_id,c.brand_id,'2025-10-01','2025-10-04',null);raise exception 'Null grain accepted';exception when raise_exception then if sqlerrm='Null grain accepted' then raise;end if;end;
 assert not has_function_privilege('anon','public.marketing_social_performance(uuid,uuid,date,date,text)','execute'),'Anonymous denied';
 assert not has_table_privilege('authenticated','public.marketing_social_daily_observations','select'),'Raw snapshots remain private';
 perform set_config('request.jwt.claim.sub','',true);
 begin perform public.marketing_social_performance(c.organization_id,c.brand_id,'2025-10-01','2025-10-04','day');raise exception 'No actor accepted';exception when others then if sqlerrm='No actor accepted' then raise;end if;end;
end;$$;
rollback;
