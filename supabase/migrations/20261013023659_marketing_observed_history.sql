-- Observed UTC-day snapshots: only future canonical observations, never backfilled.
create table public.marketing_social_daily_observations (
 connection_id uuid not null references public.marketing_connections(id) on delete cascade,
 connection_generation integer not null, provider_post_id text not null, observation_date date not null,
 organization_id uuid not null, brand_id uuid not null, channel text not null check(channel in ('facebook','instagram')),
 provider_account_id text not null, observed_at timestamptz not null,
 metrics jsonb not null, unavailable_metrics jsonb not null, metric_provenance jsonb not null,
 primary key(connection_id,connection_generation,provider_post_id,observation_date),
 foreign key(organization_id,brand_id) references public.brands(organization_id,id));
alter table public.marketing_social_daily_observations enable row level security;
revoke all on public.marketing_social_daily_observations from public,anon,authenticated;
create index marketing_daily_scope on public.marketing_social_daily_observations(organization_id,brand_id,observation_date,channel);
create function marketing_private.capture_social_day() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.provider_account_id is not null and new.channel in ('facebook','instagram') then
 insert into public.marketing_social_daily_observations values(new.connection_id,new.connection_generation,new.provider_post_id,(new.observed_at at time zone 'UTC')::date,new.organization_id,new.brand_id,new.channel,new.provider_account_id,new.observed_at,new.metrics,new.unavailable_metrics,new.metric_provenance)
 on conflict(connection_id,connection_generation,provider_post_id,observation_date) do update set observed_at=excluded.observed_at,metrics=excluded.metrics,unavailable_metrics=excluded.unavailable_metrics,metric_provenance=excluded.metric_provenance where excluded.observed_at>=marketing_social_daily_observations.observed_at;
 end if;return new;
end;$$;
create trigger marketing_social_day after insert or update on public.marketing_social_posts for each row execute function marketing_private.capture_social_day();
-- Existing grant removal deletes the canonical post. The same exact lineage removes snapshots.
create function marketing_private.erase_social_days() returns trigger language plpgsql security definer set search_path=public as $$
begin delete from public.marketing_social_daily_observations where connection_id=old.connection_id and connection_generation=old.connection_generation and provider_post_id=old.provider_post_id;return old;end;$$;
create trigger marketing_social_day_erase after delete on public.marketing_social_posts for each row execute function marketing_private.erase_social_days();
revoke all on function marketing_private.capture_social_day(),marketing_private.erase_social_days() from public,anon,authenticated,service_role;

create table marketing_private.social_coverage (
 connection_id uuid primary key references public.marketing_connections(id) on delete cascade,generation integer not null,
 history_after text,recent_after text,history_pages integer not null default 0,recent_pages integer not null default 0,
 history_due timestamptz not null default now(),recent_due timestamptz not null default now(),
 history_completed_at timestamptz,recent_completed_at timestamptz,active_mode text check(active_mode in ('history','recent')));
alter table marketing_private.social_coverage enable row level security;
revoke all on marketing_private.social_coverage from public,anon,authenticated;
create function marketing_private.sync_coverage_finish(p_connection uuid,p_generation integer,p_after text,p_error text) returns void language plpgsql security definer set search_path=public as $$
declare h marketing_private.social_coverage;begin
 select * into h from marketing_private.social_coverage where connection_id=p_connection and generation=p_generation for update;
 if not found or p_error is not null then return;end if;
 if h.active_mode='recent' then
 update marketing_private.social_coverage set recent_after=case when p_after is null or recent_pages>=3 then null else p_after end,recent_pages=case when p_after is null or recent_pages>=3 then 0 else recent_pages+1 end,recent_due=case when p_after is null or recent_pages>=3 then now()+interval '30 minutes' else now() end,recent_completed_at=case when p_after is null or recent_pages>=3 then now() else recent_completed_at end where connection_id=p_connection;
 else
 update marketing_private.social_coverage set history_after=p_after,history_pages=case when p_after is null or history_pages>=39 then 0 else history_pages+1 end,history_due=case when p_after is null then now()+interval '1 day' when history_pages>=39 then now()+interval '30 minutes' else now() end,history_completed_at=case when p_after is null then now() else history_completed_at end where connection_id=p_connection;
 end if;
end;$$;
revoke all on function marketing_private.sync_coverage_finish(uuid,integer,text,text) from public,anon,authenticated,service_role;
create or replace function public.marketing_meta_sync_claim() returns jsonb language plpgsql security definer set search_path=public as $$
declare c public.marketing_connections;h marketing_private.social_coverage;mode text;begin
 -- No cursor or credential migration; initialize/reset only through the current guarded claim.
 insert into marketing_private.social_coverage(connection_id,generation,history_after)
 select id,credential_generation,sync_after from public.marketing_connections where channel in ('facebook','instagram') and status in ('test_authorized','production_authorized')
 on conflict(connection_id) do update set generation=excluded.generation,history_after=null,recent_after=null,history_pages=0,recent_pages=0,history_due=now(),recent_due=now(),history_completed_at=null,recent_completed_at=null,active_mode=null where social_coverage.generation<>excluded.generation;
 select x.* into c from public.marketing_connections x join marketing_private.social_coverage s on s.connection_id=x.id and s.generation=x.credential_generation
 where x.status in ('test_authorized','production_authorized') and x.expires_at>now() and x.capabilities->>'posts'='true'
 and (x.sync_lease_until is null or x.sync_lease_until<now()) and x.sync_attempts<5 and (x.sync_retry_at is null or x.sync_retry_at<=now())
 and (x.sync_requested_at is not null or s.recent_due<=now() or s.history_due<=now())
 and marketing_private.actor_allowed(x.connected_by,x.organization_id,x.brand_id,'marketing_settings.configure')
 order by x.last_synced_at nulls first,x.id for update of x skip locked limit 1;
 if not found then return null;end if;
 select * into h from marketing_private.social_coverage where connection_id=c.id for update;
 -- A failed/expired lease retries its exact cursor/mode. Recent refresh wins only between successful pages.
 mode:=case when c.sync_attempts>0 and h.active_mode is not null then h.active_mode when c.sync_requested_at is not null or h.recent_due<=now() then 'recent' else 'history' end;
 update marketing_private.social_coverage set active_mode=mode where connection_id=c.id;
 update public.marketing_connections set sync_lease=gen_random_uuid(),sync_lease_until=now()+interval '3 minutes',sync_attempts=sync_attempts+1 where id=c.id returning * into c;
 return to_jsonb(c)||jsonb_build_object('sync_after',case mode when 'recent' then h.recent_after else h.history_after end);
end;$$;
revoke all on function public.marketing_meta_sync_claim() from public,anon,authenticated;
grant execute on function public.marketing_meta_sync_claim() to service_role;

create or replace function public.marketing_meta_sync_finish(p_connection uuid,p_generation integer,p_lease uuid,p_posts jsonb,p_after text,p_error text) returns void
language plpgsql security definer set search_path=public as $$
declare c public.marketing_connections; post jsonb; safe_media jsonb; safe_provenance jsonb; item record;
begin
 select * into c from public.marketing_connections where id=p_connection for update;
 if not public.marketing_meta_sync_guard(p_connection,p_generation,p_lease) then raise exception 'Synchronization authority expired.';end if;
 if jsonb_typeof(p_posts)<>'array' or jsonb_array_length(p_posts)>25 or octet_length(p_posts::text)>1000000 then raise exception 'Invalid post evidence.';end if;
 for post in select value from jsonb_array_elements(p_posts) loop
  if coalesce(post->>'id','') !~ '^[0-9]+(_[0-9]+)?$' then raise exception 'Invalid provider post identity.';end if;
  select coalesce(jsonb_agg(jsonb_build_object('type',m->>'type','url',m->>'url','previewOnly',m->'previewOnly','thumbnail_url',case when m->>'thumbnail_url' ~ '^https://([a-z0-9-]+[.])*(fbcdn[.]net|cdninstagram[.]com)/' and m->>'thumbnail_url' !~* '(access_token|authorization|appsecret)' then m->>'thumbnail_url' end)),'[]') into safe_media
  from (select value m from jsonb_array_elements(case when jsonb_typeof(post->'media')='array' then post->'media' else '[]' end) limit 10) x
  where m->>'type' in ('image','video') and m->>'url' ~ '^https://([a-z0-9-]+[.])*(fbcdn[.]net|cdninstagram[.]com)/' and m->>'url' !~* '(access_token|authorization|appsecret)' and length(m->>'url')<=4096;
  if jsonb_typeof(coalesce(post->'metric_provenance','{}'))<>'object' then raise exception 'Invalid metric provenance.';end if;
  safe_provenance:='{}'::jsonb;
  for item in select key,value from jsonb_each(coalesce(post->'metric_provenance','{}')) loop
   if item.key not in ('likes','reactions','comments','shares','reach','views','viewers','interactions','saves','watch_time_ms','avg_watch_time_ms')
    or jsonb_typeof(post->'metrics'->item.key) is distinct from 'number' or (post->'metrics'->>item.key)::numeric<0
    or jsonb_typeof(item.value) is distinct from 'object'
    or coalesce(item.value->>'source','') !~ '^(post[.](shares[.]count|(likes|reactions|comments)[.]summary[.]total_count)|media[.](like_count|comments_count)|insights[.](post_media_view|post_total_media_view_unique|post_reactions_by_type_total([.]like)?|post_activity_by_action_type([.](comment|share))?|reach|views|total_interactions|shares|saved|ig_reels_video_view_total_time|ig_reels_avg_watch_time)|derived[.]reactions_comments_shares)$'
    or coalesce(item.value->>'period','')<>'lifetime' or coalesce(item.value->>'definition','') !~ '^[a-z_]{1,80}$'
    or coalesce(item.value->>'graph_version','') !~ '^v[0-9]+[.]0$'
    or coalesce(item.value->>'observed_at','') !~ '^20[0-9]{2}-' then raise exception 'Invalid metric provenance.';end if;
   if (item.value->>'observed_at')::timestamptz not between now()-interval '1 hour' and now()+interval '5 minutes' then raise exception 'Invalid metric observation time.';end if;
   safe_provenance:=safe_provenance||jsonb_build_object(item.key,jsonb_build_object('source',item.value->>'source','period','lifetime','definition',item.value->>'definition','graph_version',item.value->>'graph_version','observed_at',item.value->>'observed_at'));
  end loop;
  insert into public.marketing_social_posts(organization_id,brand_id,connection_id,connection_generation,provider_post_id,channel,caption,permalink,published_at,metrics,unavailable_metrics,metric_provenance,provider_account_id,thumbnail_url,media,media_type,media_product_type)
  values(c.organization_id,c.brand_id,c.id,p_generation,post->>'id',c.channel,left(post->>'caption',63206),case when post->>'permalink' ~ '^https://' then post->>'permalink' end,(post->>'published_at')::timestamptz,coalesce(post->'metrics','{}'),coalesce(post->'unavailable_metrics','{}'),safe_provenance,c.provider_account_id,case when post->>'thumbnail_url' ~ '^https://([a-z0-9-]+[.])*(fbcdn[.]net|cdninstagram[.]com)/' and post->>'thumbnail_url' !~* '(access_token|authorization|appsecret)' and length(post->>'thumbnail_url')<=4096 then post->>'thumbnail_url' end,safe_media,case when post->>'media_type' in ('IMAGE','VIDEO','CAROUSEL_ALBUM') then post->>'media_type' end,case when post->>'media_product_type' in ('FEED','REELS','STORY') then post->>'media_product_type' end)
  on conflict(connection_id,connection_generation,provider_post_id) do update set caption=excluded.caption,permalink=excluded.permalink,published_at=excluded.published_at,metrics=excluded.metrics,unavailable_metrics=excluded.unavailable_metrics,metric_provenance=excluded.metric_provenance,observed_at=now(),provider_account_id=excluded.provider_account_id,thumbnail_url=excluded.thumbnail_url,media=excluded.media,media_type=excluded.media_type,media_product_type=excluded.media_product_type;
 end loop;
 perform marketing_private.sync_coverage_finish(c.id,p_generation,p_after,p_error);
 update public.marketing_connections set sync_lease_until=null,sync_after=p_after,
 sync_pages=case when p_error is null then sync_pages+1 else sync_pages end,
 sync_truncated=case when p_error is null then p_after is not null else sync_truncated end,
 sync_requested_at=null,last_synced_at=case when p_error is null then now() else last_synced_at end,last_checked_at=now(),
 sync_attempts=case when p_error is null then 0 else sync_attempts end,
 sync_retry_at=case when p_error is not null then now()+make_interval(secs=>least(3600,60*(2^sync_attempts)::integer)) end,
 sync_error_code=left(p_error,100),status=case when p_error='meta_permission_or_token_invalid' then 'error' else status end,
 error_code=case when p_error='meta_permission_or_token_invalid' then p_error else error_code end where id=c.id;
end;$$;

revoke all on function public.marketing_meta_sync_finish(uuid,integer,uuid,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.marketing_meta_sync_finish(uuid,integer,uuid,jsonb,text,text) to service_role;


-- Exact UTC-day baseline pairs only; partial coverage is explicit. No reach/viewers/rate sums.
create function public.marketing_social_observed_growth(p_org uuid,p_brand uuid default null) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;begin
 perform marketing_private.require_access(p_org,p_brand,'marketing_analytics.view');
 with scoped as materialized (
 select d.* from public.marketing_social_daily_observations d join public.marketing_connections c on c.id=d.connection_id and c.credential_generation=d.connection_generation
 where d.organization_id=p_org and (p_brand is null or d.brand_id=p_brand) and marketing_private.brand_allowed(p_org,d.brand_id)
 and c.status in ('test_authorized','production_authorized') and d.observation_date between (now() at time zone 'UTC')::date-60 and (now() at time zone 'UTC')::date),
 windows as (select (now() at time zone 'UTC')::date as ending,7 as days union all select (now() at time zone 'UTC')::date,30
 union all select d::date,1 from generate_series((now() at time zone 'UTC')::date-29,(now() at time zone 'UTC')::date,interval '1 day') d),
 pairs as (select w.ending,w.days,a.channel,k.metric,a.metrics->k.metric as current_value,b.metrics->k.metric as prior_value,
 a.metric_provenance->k.metric-'observed_at' as current_source,b.metric_provenance->k.metric-'observed_at' as prior_source
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

-- Extend the established scoped account read, without leaking private cursors.
do $$declare body text;begin
 body:=pg_get_functiondef('public.marketing_social_accounts(uuid,uuid)'::regprocedure);
 body:=replace(body,'c||jsonb_build_object(', 'c||jsonb_build_object(''coverage'',(select jsonb_build_object(''history_completed_at'',s.history_completed_at,''recent_completed_at'',s.recent_completed_at,''history_pending'',s.history_after is not null,''next_history_at'',s.history_due) from marketing_private.social_coverage s where s.connection_id=(c->>''id'')::uuid and s.generation=(c->>''credential_generation'')::integer),');
 if position('history_pending' in body)=0 then raise exception 'Social account projection contract changed.';end if;execute body;
end;$$;
