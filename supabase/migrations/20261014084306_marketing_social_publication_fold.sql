create or replace function public.marketing_social_publications(p_org uuid,p_brand uuid,p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
 perform marketing_private.require_access(p_org,p_brand,'marketing_analytics.view');
 if p_from is not null and p_to is not null and p_from>p_to then raise exception 'Invalid publication dates.';end if;
 with scoped as materialized (
 select s.* from public.marketing_social_posts s where s.organization_id=p_org and (p_brand is null or s.brand_id=p_brand) and marketing_private.brand_allowed(p_org,s.brand_id)
 ), known_accounts as materialized (
 select connection_id,channel,provider_post_id,min(provider_account_id) account_id from scoped where provider_account_id is not null group by connection_id,channel,provider_post_id having count(distinct provider_account_id)=1
 ), identities as materialized (
 select s.*,coalesce(s.provider_account_id,k.account_id,s.connection_id::text||':'||s.connection_generation) identity_key
 from scoped s left join known_accounts k on s.provider_account_id is null and k.connection_id=s.connection_id and k.channel=s.channel and k.provider_post_id=s.provider_post_id
 ), latest as materialized (
 select distinct on(channel,identity_key,provider_post_id) * from identities order by channel,identity_key,provider_post_id,observed_at desc,id desc
 ), selected as materialized (
 select * from latest where published_at is not null and (p_from is null or published_at>=p_from::timestamp at time zone 'Asia/Kuala_Lumpur') and (p_to is null or published_at<(p_to+1)::timestamp at time zone 'Asia/Kuala_Lumpur')
 ), candidates as (
 select o.channel,o.identity_key,o.provider_post_id,o.connection_id,o.connection_generation,keys.key,o.observed_at,o.id,
 case when case when jsonb_typeof(o.metrics->keys.key)='number' then (o.metrics->>keys.key)::numeric>=0 else false end
 then (o.metrics->>keys.key)::numeric
 when keys.key='interactions' and o.channel='facebook' and case when jsonb_typeof(o.metrics->'reactions')='number' and jsonb_typeof(o.metrics->'comments')='number' and jsonb_typeof(o.metrics->'shares')='number'
 then (o.metrics->>'reactions')::numeric>=0 and (o.metrics->>'comments')::numeric>=0 and (o.metrics->>'shares')::numeric>=0 else false end
 then (o.metrics->>'reactions')::numeric+(o.metrics->>'comments')::numeric+(o.metrics->>'shares')::numeric end value,
 o.metric_provenance->keys.key provenance,coalesce(o.metric_provenance->keys.key->>'observed_at',o.observed_at::text) metric_observed_at
 from identities o join selected s on o.channel=s.channel and o.identity_key=s.identity_key and o.provider_post_id=s.provider_post_id and o.connection_id=s.connection_id and o.connection_generation=s.connection_generation
 cross join unnest(array['views','viewers','interactions','likes','reactions','comments','shares','saves','reach','watch_time_ms','avg_watch_time_ms']) keys(key)
 ), valid as (
 select distinct on(channel,identity_key,provider_post_id,key) * from candidates where value is not null order by channel,identity_key,provider_post_id,key,observed_at desc,id desc
 ), metrics as (
 select channel,identity_key,provider_post_id,jsonb_object_agg(key,value) metrics,jsonb_object_agg(key,provenance) filter(where provenance is not null) provenance,jsonb_object_agg(key,metric_observed_at) observations
 from valid group by channel,identity_key,provider_post_id
 ), folded as (
 select (to_jsonb(s)-'identity_key')||jsonb_build_object('metrics',coalesce(m.metrics,'{}'),'metric_provenance',coalesce(m.provenance,'{}'),'metric_observations',coalesce(m.observations,'{}')) record
 from selected s left join metrics m on m.channel=s.channel and m.identity_key=s.identity_key and m.provider_post_id=s.provider_post_id
 )
 select jsonb_build_object('posts',coalesce((select jsonb_agg(record) from folded),'[]'),'connections',coalesce((select jsonb_agg(to_jsonb(c)-array['sync_after','sync_lease','sync_lease_until']) from public.marketing_connections c where c.organization_id=p_org and (p_brand is null or c.brand_id=p_brand) and c.channel in ('facebook','instagram') and marketing_private.brand_allowed(p_org,c.brand_id)),'[]')) into result;
 return result;
end;$$;
revoke all on function public.marketing_social_publications(uuid,uuid,date,date) from public,anon;
grant execute on function public.marketing_social_publications(uuid,uuid,date,date) to authenticated;
