-- Production approval remains distinct from Content/Publishing approval.
do $$declare body text;old text:=$old$if t.status<>'in_review' or t.blocked then raise exception 'Review the current unblocked task first.';end if;$old$;
begin
 body:=pg_get_functiondef('public.marketing_planner_command(uuid,uuid,uuid,text,uuid,integer,jsonb)'::regprocedure);
 if position(old in body)=0 then raise exception 'Planner review contract changed.';end if;
 execute replace(body,old,$new$if t.status not in ('planned','in_progress','in_review') or t.blocked then raise exception 'Choose a current unblocked task for production review.';end if;$new$);
end;$$;

-- Monthly target credit is a projection of immutable publication identities, never task dates.
create function marketing_private.creative_publication_counts(p_org uuid,p_brand uuid,p_month date) returns jsonb
language sql stable security definer set search_path=public as $$
 with observations as materialized (
  select s.* from public.marketing_social_posts s
  where s.organization_id=p_org and s.brand_id=p_brand and marketing_private.brand_allowed(p_org,s.brand_id)
 ), resolved as materialized (
  select s.*,coalesce(s.provider_account_id,known.account_id) as resolved_account
  from observations s left join lateral (
   select min(k.provider_account_id) as account_id from observations k
   where k.connection_id=s.connection_id and k.channel=s.channel and k.provider_post_id=s.provider_post_id
    and k.provider_account_id is not null having count(distinct k.provider_account_id)=1
  ) known on s.provider_account_id is null
 ), social as materialized (
  select distinct on (channel,coalesce(resolved_account,connection_id::text||':'||connection_generation),provider_post_id) *
  from resolved order by channel,coalesce(resolved_account,connection_id::text||':'||connection_generation),provider_post_id,observed_at desc,id
 ), receipts as materialized (
  select j.*,s.published_at,
   case when v.variant->>'format'='reel' then 'reel' else 'post' end as content_type
  from public.marketing_jobs j join public.marketing_content c on c.id=j.content_id and c.organization_id=j.organization_id and c.brand_id=j.brand_id
  join public.marketing_content_revisions r on r.content_id=j.content_id and r.revision=j.revision
  cross join lateral (select value as variant from jsonb_array_elements(r.payload->'variants') where value->>'channel'=j.channel limit 1) v
  left join lateral (select s0.* from social s0 where s0.connection_id=j.connection_id and s0.channel=j.channel and s0.provider_post_id=j.provider_post_id
   and (s0.connection_generation=j.connection_generation or exists(select 1 from resolved old where old.connection_id=j.connection_id and old.channel=j.channel and old.provider_post_id=j.provider_post_id and old.connection_generation=j.connection_generation and old.resolved_account=s0.resolved_account)) limit 1) s on true
  where j.organization_id=p_org and j.brand_id=p_brand and marketing_private.brand_allowed(p_org,j.brand_id)
   and j.state='succeeded' and j.provider_post_id is not null
 ), concepts as (
  -- First verified publication earns one credit, even across channels, months and revisions.
  select 'content:'||content_id as identity,min(published_at) as published_at,
   (array_agg(content_type order by published_at nulls last,revision,channel,id))[1] as content_type
  from receipts group by content_id
 ), external as (
  select 'social:'||s.id as identity,s.published_at,
   case when upper(coalesce(s.media_product_type,''))='STORY' then 'story'
    when upper(coalesce(s.media_product_type,''))='REELS' or upper(coalesce(s.media_type,''))='REEL' then 'reel' else 'post' end as content_type
  from social s where not exists(select 1 from public.marketing_jobs j
   where j.organization_id=p_org and j.brand_id=p_brand and j.channel=s.channel and j.provider_post_id=s.provider_post_id and j.connection_id=s.connection_id
    and (j.connection_generation=s.connection_generation or exists(select 1 from resolved old where old.connection_id=j.connection_id and old.channel=j.channel and old.provider_post_id=j.provider_post_id and old.connection_generation=j.connection_generation and old.resolved_account=s.resolved_account)))
 ), published as (select * from concepts union all select * from external),
 permission as (select public.current_user_has_permission('marketing_calendar.view') or public.current_user_has_permission('marketing_content.view') as allowed),
 coverage as (
  select permission.allowed,
   exists(select 1 from public.marketing_connections c where c.organization_id=p_org and c.brand_id=p_brand and c.channel in ('facebook','instagram') and c.last_synced_at is not null)
    or exists(select 1 from published where published_at is not null) as observed,
   (select count(*) from published where published_at is null) as undated
  from permission
 ), scheduled as (
  select c.id,case when coalesce(r.payload->>'planner_type',r.payload->'variants'->0->>'format')='reel' then 'reel' else 'post' end as content_type
  from public.marketing_content c join public.marketing_content_revisions r on r.content_id=c.id and r.revision=c.revision
  where c.organization_id=p_org and c.brand_id=p_brand and marketing_private.brand_allowed(p_org,c.brand_id)
   and c.status='scheduled' and c.approved_revision=c.revision
   and timezone('Asia/Kuala_Lumpur',c.scheduled_at)::date>=p_month
   and timezone('Asia/Kuala_Lumpur',c.scheduled_at)::date<p_month+interval '1 month'
 )
 select jsonb_build_object(
  'published_available',allowed and observed and undated=0,
  'published_coverage',case when not allowed then 'permission_required' when not observed then 'unavailable' when undated>0 then 'publication_date_unavailable' else 'observed' end,
  'undated_publications',case when allowed then undated end,
  'published_posts',case when allowed and observed and undated=0 then (select count(*) from published where content_type='post' and timezone('Asia/Kuala_Lumpur',published_at)::date>=p_month and timezone('Asia/Kuala_Lumpur',published_at)::date<p_month+interval '1 month') end,
  'published_reels',case when allowed and observed and undated=0 then (select count(*) from published where content_type='reel' and timezone('Asia/Kuala_Lumpur',published_at)::date>=p_month and timezone('Asia/Kuala_Lumpur',published_at)::date<p_month+interval '1 month') end,
  'scheduled_posts',case when allowed then (select count(*) from scheduled where content_type='post') end,
  'scheduled_reels',case when allowed then (select count(*) from scheduled where content_type='reel') end
 ) from coverage;
$$;
revoke all on function marketing_private.creative_publication_counts(uuid,uuid,date) from public,anon,authenticated;

-- Retain the canonical task/member/target authority and append only the corrected projection.
do $$declare body text;old text;start_at integer;end_at integer;
begin
 body:=pg_get_functiondef('public.marketing_planner_read(uuid,date,uuid)'::regprocedure);
 start_at:=position(E',\n  ''published_available''' in body);
 end_at:=position(' ) order by b.name)' in substring(body from start_at));
 if start_at=0 or end_at=0 then raise exception 'Planner targets contract changed.';end if;
 old:=substring(body from start_at for end_at+1);
 execute replace(body,old,E'\n ) || marketing_private.creative_publication_counts(p_org,b.id,p_month)');
end;$$;
