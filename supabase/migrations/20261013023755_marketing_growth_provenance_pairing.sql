-- Preserve JSONB pairing precedence; no data backfill.
create or replace function public.marketing_social_observed_growth(p_org uuid,p_brand uuid default null) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;begin
 perform marketing_private.require_access(p_org,p_brand,'marketing_analytics.view');
 with scoped as materialized (
 select d.* from public.marketing_social_daily_observations d join public.marketing_connections c on c.id=d.connection_id and c.credential_generation=d.connection_generation
 where d.organization_id=p_org and (p_brand is null or d.brand_id=p_brand) and marketing_private.brand_allowed(p_org,d.brand_id)
 and c.status in ('test_authorized','production_authorized') and d.observation_date between (now() at time zone 'UTC')::date-60 and (now() at time zone 'UTC')::date),
 windows as (select (now() at time zone 'UTC')::date as ending,7 as days union all select (now() at time zone 'UTC')::date,30
 union all select d::date,1 from generate_series((now() at time zone 'UTC')::date-29,(now() at time zone 'UTC')::date,interval '1 day') d),
 pairs as (select w.ending,w.days,a.channel,k.metric,a.metrics->k.metric as current_value,b.metrics->k.metric as prior_value,
 (a.metric_provenance->k.metric)-'observed_at' as current_source,(b.metric_provenance->k.metric)-'observed_at' as prior_source
 from windows w join scoped a on a.observation_date=w.ending
 left join scoped b on b.connection_id=a.connection_id and b.connection_generation=a.connection_generation and b.provider_post_id=a.provider_post_id and b.observation_date=w.ending-w.days
 cross join (values('views'),('interactions'),('likes'),('reactions'),('comments'),('shares'),('saves')) k(metric)),
 valid as (select *,jsonb_typeof(current_value)='number' and jsonb_typeof(prior_value)='number' and current_source=prior_source and current_source->>'period'='lifetime' and (current_value#>>'{}')::numeric>=(prior_value#>>'{}')::numeric as comparable from pairs),
 totals as (select ending,days,channel,metric,count(*) as observed_posts,count(*) filter(where comparable) as paired_posts,
 sum((current_value#>>'{}')::numeric-(prior_value#>>'{}')::numeric) filter(where comparable) as growth
 from valid group by ending,days,channel,metric)
 select coalesce(jsonb_agg(to_jsonb(t) order by ending,days,channel,metric),'[]') into result from totals t;
 return jsonb_build_object('timezone','UTC','rows',result,'first_observation_date',(select min(observation_date) from public.marketing_social_daily_observations d where d.organization_id=p_org and (p_brand is null or d.brand_id=p_brand) and marketing_private.brand_allowed(p_org,d.brand_id)),'complete',false);
end;$$;
revoke all on function public.marketing_social_observed_growth(uuid,uuid) from public,anon;
grant execute on function public.marketing_social_observed_growth(uuid,uuid) to authenticated;
