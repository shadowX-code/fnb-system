-- Existing authorities only: immutable revision planning + a scoped unified projection.
alter table public.marketing_social_posts add column provider_account_id text, add column thumbnail_url text;
-- Only the current generation has an established account identity. Never guess old bindings.
update public.marketing_social_posts s set provider_account_id=c.provider_account_id
from public.marketing_connections c where c.id=s.connection_id and c.credential_generation=s.connection_generation;
create index marketing_social_posts_account_evidence on public.marketing_social_posts(organization_id,channel,provider_account_id,provider_post_id,observed_at desc);
create or replace function marketing_private.validate_content(p_org uuid,p_brand uuid,p_payload jsonb,p_complete boolean) returns void language plpgsql stable security definer set search_path=public as $$
declare variant jsonb; media uuid; outlets uuid[];
begin
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or length(trim(coalesce(p_payload->>'title',''))) not between 1 and 200 or octet_length(p_payload::text)>65536
 or coalesce(jsonb_typeof(p_payload->'variants'),'')<>'array' or coalesce(jsonb_typeof(p_payload->'outlet_ids'),'')<>'array' then raise exception 'A title, outlet targets and channel variants are required.'; end if;
 if p_payload->>'planned_at' is not null then
   if (p_payload->>'planned_at')::timestamptz is null or not exists(select 1 from pg_timezone_names where name=p_payload->>'planned_timezone') then raise exception 'Choose a valid planned date and timezone.'; end if;
 end if;
 if jsonb_array_length(p_payload->'variants') not between 1 and 2 then raise exception 'Choose one or two channel variants.'; end if;
 if (select count(distinct x->>'channel') from jsonb_array_elements(p_payload->'variants') x)<>jsonb_array_length(p_payload->'variants') then raise exception 'Use one variant per channel.'; end if;
 for media in select value::uuid from jsonb_array_elements_text(p_payload->'outlet_ids') loop
 if not exists(select 1 from public.brand_outlets where organization_id=p_org and brand_id=p_brand and outlet_id=media) then raise exception 'Outlet target does not belong to this brand.'; end if;
 end loop;
 for variant in select value from jsonb_array_elements(p_payload->'variants') loop
   if coalesce(variant->>'channel','') not in ('facebook','instagram') or coalesce(variant->>'format','') not in ('text','image','carousel','reel')
   or length(coalesce(variant->>'caption',''))>(case when variant->>'channel'='instagram' then 2200 else 63206 end)
   or coalesce(jsonb_typeof(variant->'asset_ids'),'')<>'array'
   or (variant->>'channel'='instagram' and variant->>'format'='text') then raise exception 'Channel format, caption or media is invalid.'; end if;
   if jsonb_array_length(variant->'asset_ids')>10 then raise exception 'Use at most ten media assets per variant.'; end if;
   for media in select value::uuid from jsonb_array_elements_text(variant->'asset_ids') loop
     if not exists(select 1 from public.marketing_assets where id=media and organization_id=p_org and brand_id=p_brand and state='ready') then raise exception 'Use ready media belonging to this brand.'; end if;
     if variant->>'format' in ('image','carousel') and exists(select 1 from public.marketing_assets where id=media and mime_type not like 'image/%')
     or variant->>'format'='reel' and exists(select 1 from public.marketing_assets where id=media and mime_type<>'video/mp4') then raise exception 'Media type does not match the publishing format.'; end if;
   end loop;
   if p_complete and (length(trim(coalesce(variant->>'caption','')))=0
   or (variant->>'format' in ('image','reel') and jsonb_array_length(variant->'asset_ids')<>1)
   or (variant->>'format'='carousel' and jsonb_array_length(variant->'asset_ids') not between 2 and 10)
   or (variant->>'format'='text' and jsonb_array_length(variant->'asset_ids')<>0)) then raise exception 'Complete the caption and required media before review.'; end if;
 end loop;
end; $$;

create or replace function public.marketing_meta_sync_finish(p_connection uuid,p_generation integer,p_lease uuid,p_posts jsonb,p_after text,p_error text) returns void
language plpgsql security definer set search_path=public as $$
declare c public.marketing_connections; post jsonb;
begin
 select * into c from public.marketing_connections where id=p_connection for update;
 if not public.marketing_meta_sync_guard(p_connection,p_generation,p_lease) then raise exception 'Synchronization authority expired.';end if;
 if jsonb_typeof(p_posts)<>'array' or jsonb_array_length(p_posts)>25 or octet_length(p_posts::text)>1000000 then raise exception 'Invalid post evidence.';end if;
 for post in select value from jsonb_array_elements(p_posts) loop
  if coalesce(post->>'id','') !~ '^[0-9]+(_[0-9]+)?$' then raise exception 'Invalid provider post identity.';end if;
  insert into public.marketing_social_posts(organization_id,brand_id,connection_id,connection_generation,provider_post_id,channel,caption,permalink,published_at,metrics,unavailable_metrics,provider_account_id,thumbnail_url)
  values(c.organization_id,c.brand_id,c.id,p_generation,post->>'id',c.channel,left(post->>'caption',63206),case when post->>'permalink' ~ '^https://' then post->>'permalink' end,(post->>'published_at')::timestamptz,coalesce(post->'metrics','{}'),coalesce(post->'unavailable_metrics','{}'),c.provider_account_id,case when post->>'thumbnail_url' ~ '^https://([a-z0-9-]+\.)*(fbcdn\.net|cdninstagram\.com)/' and post->>'thumbnail_url' !~* '(access_token|authorization|appsecret)' and length(post->>'thumbnail_url')<=4096 then post->>'thumbnail_url' end)
  on conflict(connection_id,connection_generation,provider_post_id) do update set caption=excluded.caption,permalink=excluded.permalink,published_at=excluded.published_at,metrics=excluded.metrics,unavailable_metrics=excluded.unavailable_metrics,observed_at=now(),provider_account_id=excluded.provider_account_id,thumbnail_url=excluded.thumbnail_url;
 end loop;
 update public.marketing_connections set sync_lease_until=null,sync_after=case when p_error is null then case when sync_pages>=39 then null else p_after end else sync_after end,
 sync_pages=case when p_error is null and (p_after is null or sync_pages>=39) then 0 when p_error is null then sync_pages+1 else sync_pages end,
 sync_truncated=case when p_error is null and sync_pages>=39 and p_after is not null then true when p_error is null and sync_after is null then false else sync_truncated end,
 sync_requested_at=case when p_error is null and (p_after is null or sync_pages>=39) then null else coalesce(sync_requested_at,now()) end,
 last_synced_at=case when p_error is null then now() else last_synced_at end,last_checked_at=now(),
 sync_attempts=case when p_error is null then 0 else sync_attempts end,sync_retry_at=case when p_error is not null then now()+make_interval(secs=>least(3600,60*(2^sync_attempts)::integer)) end,
 sync_error_code=left(p_error,100),status=case when p_error='meta_permission_or_token_invalid' then 'error' else status end,error_code=case when p_error='meta_permission_or_token_invalid' then p_error else error_code end where id=c.id;
end;$$;

create function public.marketing_content_management(
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
 with scoped_social as materialized (
  select s.* from public.marketing_social_posts s where s.organization_id=p_org and (p_brand is null or s.brand_id=p_brand) and marketing_private.brand_allowed(p_org,s.brand_id)
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
  where c.organization_id=p_org and (p_brand is null or c.brand_id=p_brand) and marketing_private.brand_allowed(p_org,c.brand_id)
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
   row_number() over(order by group_key,
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
