-- Resolve scope once per brand, preserving all per-record ownership boundaries.
create or replace function public.marketing_content_management(
 p_org uuid,p_brand uuid default null,p_from timestamptz default null,p_to timestamptz default null,
 p_search text default '',p_channel text default '',p_status text default '',p_sort text default 'date_desc',
 p_group text default '',p_page integer default 1,p_page_size integer default 20,p_view text default 'list'
) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
 perform marketing_private.require_access(p_org,p_brand,'marketing_calendar.view');
 if p_page is null or p_page not between 1 and 100000 or p_page_size is null or p_page_size not in (20,50,100)
 or p_view is null or p_view not in ('list','calendar') or p_sort is null or p_sort not in ('date_desc','date_asc','title','brand','status')
 or p_group is null or p_group not in ('','date','brand','status') or p_channel is null or p_channel not in ('','facebook','instagram')
 or p_status is null or p_status not in ('','draft','review','approved','scheduled','published','failed','rejected','cancelled')
 or p_search is null or length(p_search)>200 or (p_from is not null and p_to is not null and p_from>=p_to)
 or (p_view='calendar' and (p_from is null or p_to is null or p_to-p_from>interval '42 days')) then raise exception 'Invalid content filters.'; end if;
 with allowed_brands as materialized (
  select b.id from public.brands b where b.organization_id=p_org and (p_brand is null or b.id=p_brand) and marketing_private.brand_allowed(p_org,b.id)
 ), scoped_observations as materialized (
  select s.* from public.marketing_social_posts s where s.organization_id=p_org and (p_brand is null or s.brand_id=p_brand) and s.brand_id in (select id from allowed_brands)
 ), scoped_social as materialized (
  -- Old rows may lack an account snapshot. Resolve only an exact provider-post identity
  -- on the same connection/channel with one known account observation. No current-binding,
  -- caption, timestamp or task inference; ambiguous/unknown observations stay distinct.
  select s.id,s.organization_id,s.brand_id,s.connection_id,s.connection_generation,s.provider_post_id,s.channel,s.caption,s.permalink,s.published_at,s.observed_at,s.metrics,s.unavailable_metrics,s.thumbnail_url,
   coalesce(s.provider_account_id,verified.account_id) as provider_account_id
  from scoped_observations s left join lateral (
   select min(known.provider_account_id) as account_id from scoped_observations known
   where known.connection_id=s.connection_id and known.channel=s.channel and known.provider_post_id=s.provider_post_id and known.provider_account_id is not null
   having count(distinct known.provider_account_id)=1
  ) verified on s.provider_account_id is null
 ), social as materialized (
  select distinct on (channel,coalesce(provider_account_id,connection_id::text||':'||connection_generation),provider_post_id) *
  from scoped_social order by channel,coalesce(provider_account_id,connection_id::text||':'||connection_generation),provider_post_id,observed_at desc,id
 ), concepts as (
  select c.id::text as key,c.id,c.brand_id,b.name as brand_name,c.status,c.revision,c.scheduled_at,c.schedule_timezone,r.payload,
   (r.payload->>'planned_at')::timestamptz as planned_at, r.payload->>'planned_timezone' as planned_timezone,
   evidence.actual_at,coalesce(evidence.actual_at,c.scheduled_at,(r.payload->>'planned_at')::timestamptz) as display_at,
   'feedx'::text as origin,r.payload->>'title' as title,evidence.channels
  from public.marketing_content c join public.brands b on b.id=c.brand_id
  join public.marketing_content_revisions r on r.content_id=c.id and r.revision=c.revision
  cross join lateral (
   select max(s.published_at) as actual_at,jsonb_agg(jsonb_build_object(
    'channel',v->>'channel','caption',v->>'caption','format',v->>'format',
    'status',case when j.state='succeeded' then 'published' when j.state='failed' then 'failed' else c.status end,
    'job_state',j.state,'error_code',j.error_code,'provider_post_id',j.provider_post_id,'connection_id',j.connection_id,
    'scheduled_at',c.scheduled_at,'actual_at',s.published_at,'permalink',s.permalink,'metrics',coalesce(s.metrics,'{}'::jsonb),
    'observed_at',s.observed_at,'unavailable_metrics',coalesce(s.unavailable_metrics,'{}'::jsonb),
    'thumbnail_url',s.thumbnail_url,'asset',(select to_jsonb(a) from public.marketing_assets a where a.id=(v->'asset_ids'->>0)::uuid and a.brand_id=c.brand_id and a.state='ready')
   ) order by v->>'channel') as channels
   from jsonb_array_elements(r.payload->'variants') v
   left join public.marketing_jobs j on j.content_id=c.id and j.revision=c.revision and j.channel=v->>'channel'
   left join lateral (select s0.* from social s0 where s0.provider_post_id=j.provider_post_id and s0.channel=j.channel
    and s0.connection_id=j.connection_id and (s0.connection_generation=j.connection_generation or exists(
     select 1 from scoped_social old where old.connection_id=j.connection_id and old.connection_generation=j.connection_generation and old.provider_post_id=j.provider_post_id and old.provider_account_id=s0.provider_account_id
    )) limit 1) s on true
  ) evidence
  where c.organization_id=p_org and (p_brand is null or c.brand_id=p_brand) and c.brand_id in (select id from allowed_brands)
 ), external as (
  select 'meta:'||s.id as key,null::uuid as id,s.brand_id,b.name as brand_name,'published'::text as status,null::integer as revision,
   null::timestamptz as scheduled_at,null::text as schedule_timezone,null::jsonb as payload,null::timestamptz as planned_at,null::text as planned_timezone,
   s.published_at as actual_at,s.published_at as display_at,'meta'::text as origin,coalesce(nullif(s.caption,''),'Untitled '||initcap(s.channel)||' post') as title,
   jsonb_build_array(jsonb_build_object('channel',s.channel,'caption',s.caption,'status','published','actual_at',s.published_at,
    'connection_id',s.connection_id,'provider_account_id',s.provider_account_id,'provider_post_id',s.provider_post_id,
    'permalink',s.permalink,'metrics',s.metrics,'unavailable_metrics',s.unavailable_metrics,'observed_at',s.observed_at,'thumbnail_url',s.thumbnail_url)) as channels
  from social s join public.brands b on b.id=s.brand_id
  where not exists(select 1 from public.marketing_jobs j where j.organization_id=p_org and j.brand_id=s.brand_id and j.channel=s.channel and j.provider_post_id=s.provider_post_id
   and j.connection_id=s.connection_id and (j.connection_generation=s.connection_generation or exists(select 1 from scoped_social old where old.connection_id=j.connection_id and old.connection_generation=j.connection_generation and old.provider_post_id=j.provider_post_id and old.provider_account_id=s.provider_account_id)))
 ), filtered as materialized (
  select x.*,to_char(x.display_at at time zone 'Asia/Kuala_Lumpur','YYYY-MM-DD') as day,
   case p_group when 'brand' then x.brand_name when 'status' then x.status when 'date' then to_char(x.display_at at time zone 'Asia/Kuala_Lumpur','YYYY-MM-DD') else '' end as group_key
  from (select * from concepts union all select * from external) x
  where display_at is not null and (p_from is null or display_at>=p_from) and (p_to is null or display_at<p_to)
   and (p_search='' or position(lower(p_search) in lower(title||' '||coalesce((select string_agg(v->>'caption',' ') from jsonb_array_elements(channels) v),'')))>0)
   and (p_channel='' or exists(select 1 from jsonb_array_elements(channels) v where v->>'channel'=p_channel))
   and (p_status='' or status=p_status or exists(select 1 from jsonb_array_elements(channels) v where v->>'status'=p_status))
 ), ranked as (
  select f.*,row_number() over(partition by day order by display_at,key) as day_rank,
   row_number() over(order by case when p_group='date' and p_sort='date_desc' then group_key end desc,case when not(p_group='date' and p_sort='date_desc') then group_key end,
    case when p_sort='date_desc' then display_at end desc,
    case when p_sort='date_asc' then display_at end asc,
    case when p_sort='title' then lower(title) when p_sort='brand' then brand_name when p_sort='status' then status end,key) as rank
  from filtered f
 ), page_rows as (
  select * from ranked where case when p_view='calendar' then day_rank<=3 else rank>(p_page-1)*p_page_size and rank<=p_page*p_page_size end
 )
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(q)-array['day_rank','rank'] order by rank) from page_rows q),'[]'::jsonb),
  'total_count',(select count(*) from filtered),'day_counts',coalesce((select jsonb_object_agg(day,n) from (select day,count(*) n from filtered group by day) d),'{}'::jsonb),
  'timezone','Asia/Kuala_Lumpur') into result;
 return result;
end;$$;
revoke all on function public.marketing_content_management(uuid,uuid,timestamptz,timestamptz,text,text,text,text,text,integer,integer,text) from public,anon,authenticated;
grant execute on function public.marketing_content_management(uuid,uuid,timestamptz,timestamptz,text,text,text,text,text,integer,integer,text) to authenticated;
