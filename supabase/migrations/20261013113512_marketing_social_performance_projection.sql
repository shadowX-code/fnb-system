-- Read-only projection of real UTC snapshot days; never backfill or carry missing days.
create function public.marketing_social_performance(p_org uuid,p_brand uuid,p_from date,p_to date,p_grain text default 'day') returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare result jsonb;begin
 perform marketing_private.require_access(p_org,p_brand,'marketing_analytics.view');
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>730 or p_grain not in ('day','week','month') then raise exception 'Choose a valid analytics period of at most two years.';end if;
 with scoped as materialized (
  select distinct on (d.observation_date,d.channel,d.provider_account_id,d.provider_post_id) d.*
  from public.marketing_social_daily_observations d join public.marketing_connections c on c.id=d.connection_id and c.credential_generation=d.connection_generation
  where d.organization_id=p_org and (p_brand is null or d.brand_id=p_brand) and marketing_private.brand_allowed(p_org,d.brand_id)
  and c.status in ('test_authorized','production_authorized') and d.observation_date between p_from-30 and p_to
  order by d.observation_date,d.channel,d.provider_account_id,d.provider_post_id,d.observed_at desc,d.connection_id),
 buckets as (select min(day::date) starting,max(day::date) ending from generate_series(p_from::timestamp,p_to::timestamp,interval '1 day') day group by date_trunc(p_grain,day)),
 windows as (select 'trend' kind,starting,ending,ending-starting+1 days from buckets union all select 'window',p_to-6,p_to,7 union all select 'window',p_to-29,p_to,30),
 evidence as (
  select w.*,ch.channel,k.metric,a.connection_id,a.connection_generation,a.provider_account_id,a.provider_post_id,a.observed_at,
  case when jsonb_typeof(a.metrics->k.metric)='number' and (a.metric_provenance->k.metric)->>'period'='lifetime'
   and ((a.metric_provenance->k.metric)->>'observed_at')::timestamptz at time zone 'UTC' >= w.ending::timestamp
   and ((a.metric_provenance->k.metric)->>'observed_at')::timestamptz at time zone 'UTC' < (w.ending+1)::timestamp
   then (a.metrics->>k.metric)::numeric end current_value,
  case when jsonb_typeof(b.metrics->k.metric)='number' and (b.metric_provenance->k.metric)->>'period'='lifetime'
   and ((b.metric_provenance->k.metric)->>'observed_at')::timestamptz at time zone 'UTC' >= (w.starting-1)::timestamp
   and ((b.metric_provenance->k.metric)->>'observed_at')::timestamptz at time zone 'UTC' < w.starting::timestamp
   then (b.metrics->>k.metric)::numeric end prior_value,
  (a.metric_provenance->k.metric)-'observed_at' current_source,(b.metric_provenance->k.metric)-'observed_at' prior_source
  from windows w cross join (values('facebook'),('instagram')) ch(channel) cross join (values('views'),('interactions'),('likes'),('reactions'),('comments'),('shares'),('saves')) k(metric)
  left join scoped a on a.channel=ch.channel and a.observation_date=w.ending
  left join scoped b on b.connection_id=a.connection_id and b.connection_generation=a.connection_generation and b.provider_post_id=a.provider_post_id and b.provider_account_id=a.provider_account_id and b.observation_date=w.starting-1),
 valid as (select *,current_value is not null and prior_value is not null and current_source=prior_source and current_value>=prior_value comparable from evidence),
 totals as (
  select kind,starting,ending,days,channel,metric,count(provider_post_id) observed_posts,count(current_value) available_posts,count(*) filter(where comparable) paired_posts,
  sum(current_value) cumulative,sum(current_value-prior_value) filter(where comparable) growth,
  md5(string_agg(concat(connection_id,':',connection_generation,':',provider_account_id,':',provider_post_id,':',current_source),',' order by connection_id,connection_generation,provider_account_id,provider_post_id) filter(where current_value is not null)) cohort,
  min(observed_at) first_observed_at,max(observed_at) last_observed_at
  from valid group by kind,starting,ending,days,channel,metric)
 select jsonb_build_object('timezone','UTC','rows',coalesce((select jsonb_agg(to_jsonb(t) order by ending,channel,metric) from totals t where kind='trend'),'[]'),
  'windows',coalesce((select jsonb_agg(to_jsonb(t) order by days,channel,metric) from totals t where kind='window'),'[]'),
  'first_observation_date',(select min(d.observation_date) from public.marketing_social_daily_observations d join public.marketing_connections c on c.id=d.connection_id and c.credential_generation=d.connection_generation where d.organization_id=p_org and (p_brand is null or d.brand_id=p_brand) and marketing_private.brand_allowed(p_org,d.brand_id) and c.status in ('test_authorized','production_authorized')),
  'observation_days',(select count(distinct observation_date) from scoped where observation_date between p_from and p_to)) into result;
 return result;
end;$$;
revoke all on function public.marketing_social_performance(uuid,uuid,date,date,text) from public,anon;
grant execute on function public.marketing_social_performance(uuid,uuid,date,date,text) to authenticated;
