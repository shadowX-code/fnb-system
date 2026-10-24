-- Reel covers are immutable revision media; live availability never rewrites a receipt.
create function marketing_private.variant_asset_ids(p_variant jsonb) returns setof uuid
language sql immutable set search_path=public as $$
 select distinct asset_id::uuid from (
  select jsonb_array_elements_text(coalesce(p_variant->'asset_ids','[]')) asset_id
  union all select p_variant->'reel_cover'->>'asset_id' where p_variant->'reel_cover'->>'mode'='image'
 ) ids where asset_id is not null;
$$;
revoke all on function marketing_private.variant_asset_ids(jsonb) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION marketing_private.validate_content(p_org uuid, p_brand uuid, p_payload jsonb, p_complete boolean)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
   if coalesce(variant->>'channel','') not in ('facebook','instagram') or coalesce(variant->>'format','') not in ('text','image','carousel','reel','video','story')
   or length(coalesce(variant->>'caption',''))>(case when variant->>'channel'='instagram' then 2200 else 63206 end)
   or coalesce(jsonb_typeof(variant->'asset_ids'),'')<>'array'
   or (variant->>'channel'='facebook' and variant->>'format'='story') or (variant->>'channel'='instagram' and variant->>'format' in ('text','video')) then raise exception 'Channel format, caption or media is invalid.'; end if;
   if jsonb_array_length(variant->'asset_ids')>10 then raise exception 'Use at most ten media assets per variant.'; end if;
   for media in select value::uuid from jsonb_array_elements_text(variant->'asset_ids') loop
     if not exists(select 1 from public.marketing_assets where id=media and organization_id=p_org and brand_id=p_brand and state='ready') then raise exception 'Use ready media belonging to this brand.'; end if;
     if (variant->>'format'='image' or variant->>'format'='carousel' and variant->>'channel'='facebook') and exists(select 1 from public.marketing_assets where id=media and mime_type not like 'image/%')
     or variant->>'channel'='instagram' and variant->>'format' in ('carousel','story') and exists(select 1 from public.marketing_assets where id=media and (mime_type not in ('image/jpeg','video/mp4') or size_bytes>case when mime_type='video/mp4' then 52428800 else 8388608 end))
     or variant->>'format' in ('reel','video') and exists(select 1 from public.marketing_assets where id=media and mime_type<>'video/mp4') then raise exception 'Media type does not match the publishing format.'; end if;
   end loop;
   if variant ? 'reel_cover' then
    if jsonb_typeof(variant->'reel_cover') is distinct from 'object' or variant->>'format'<>'reel' then raise exception 'Cover settings are only available for Reels.';end if;
    if variant->'reel_cover'->>'mode'='automatic' then
     if (select count(*) from jsonb_object_keys(variant->'reel_cover'))<>1 then raise exception 'Invalid automatic cover settings.';end if;
    elsif variant->>'channel'='instagram' and jsonb_array_length(variant->'asset_ids')=1
      and variant->'reel_cover'->>'video_asset_id'=variant->'asset_ids'->>0 then
     if variant->'reel_cover'->>'mode'='frame' then
      if (select array_agg(k order by k) from jsonb_object_keys(variant->'reel_cover') k)<>array['mode','offset_ms','video_asset_id']::text[]
       or jsonb_typeof(variant->'reel_cover'->'offset_ms') is distinct from 'number'
       or (variant->'reel_cover'->>'offset_ms')::numeric not between 0 and 3600000
       or trunc((variant->'reel_cover'->>'offset_ms')::numeric)<>(variant->'reel_cover'->>'offset_ms')::numeric then raise exception 'Choose a valid video-frame offset.';end if;
     elsif variant->'reel_cover'->>'mode'='image' then
      if (select array_agg(k order by k) from jsonb_object_keys(variant->'reel_cover') k)<>array['asset_id','mode','video_asset_id']::text[]
       or not exists(select 1 from public.marketing_assets a where a.id=(variant->'reel_cover'->>'asset_id')::uuid
        and a.organization_id=p_org and a.brand_id=p_brand and a.state='ready' and a.mime_type='image/jpeg' and a.size_bytes<=8388608
        and a.id<>(variant->'asset_ids'->>0)::uuid) then raise exception 'Choose a ready Brand JPEG cover, up to 8 MB.';end if;
     else raise exception 'Choose an automatic, video-frame or custom-image cover.';end if;
    else raise exception 'Cover settings do not match this channel or video.';end if;
   end if;
   if p_complete and (length(trim(coalesce(variant->>'caption','')))=0
   or (variant->>'format' in ('image','reel','video','story') and jsonb_array_length(variant->'asset_ids')<>1)
   or (variant->>'format'='carousel' and jsonb_array_length(variant->'asset_ids') not between 2 and 10)
   or (variant->>'format'='text' and jsonb_array_length(variant->'asset_ids')<>0)) then raise exception 'Complete the caption and required media before review.'; end if;
 end loop;
end; $function$;

CREATE OR REPLACE FUNCTION marketing_private.pin_media_reference()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare ids jsonb; asset_id text; a public.marketing_assets;
begin
 if tg_table_name='marketing_content_revisions' then
  select coalesce(jsonb_agg(ids.asset_id),'[]') into ids from jsonb_array_elements(new.payload->'variants') v cross join marketing_private.variant_asset_ids(v) ids(asset_id);
 elsif tg_table_name='marketing_campaign_revisions' then ids:=jsonb_build_array(new.payload->>'asset_id');
 else ids:=jsonb_build_array(new.configuration->>'asset_id');end if;
 for asset_id in select distinct value from jsonb_array_elements_text(ids) order by value loop
  if asset_id is null or asset_id='' then continue;end if;
  select * into a from public.marketing_assets where id=asset_id::uuid for update;
  if a.id is null or a.state<>'ready' or (a.storage_policy='temporary' and a.snapshot_verified_at is null) then raise exception 'Select available, verified media before saving.';end if;
 end loop;return new;
end;$function$;

CREATE OR REPLACE FUNCTION public.marketing_job_assets(p_job uuid, p_lease uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare j public.marketing_jobs; result jsonb;
begin
 perform public.marketing_job_guard(p_job,p_lease);select * into j from public.marketing_jobs where id=p_job;
 select coalesce(jsonb_agg(to_jsonb(a)),'[]') into result from public.marketing_assets a
 join public.marketing_content_revisions r on r.content_id=j.content_id and r.revision=j.revision
 where a.brand_id=j.brand_id and a.organization_id=j.organization_id and a.state='ready'
 and exists(select 1 from jsonb_array_elements(r.payload->'variants') v cross join marketing_private.variant_asset_ids(v) aid where v->>'channel'=j.channel and aid::uuid=a.id);
 return result;
end;$function$;

CREATE OR REPLACE FUNCTION public.marketing_content_detail(p_content uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c public.marketing_content; actor uuid; assets jsonb; events jsonb; projection jsonb;
begin
 select * into c from public.marketing_content where id=p_content;
 if not found then raise exception using errcode='42501',message='Content is unavailable.'; end if;
 actor:=marketing_private.require_access(c.organization_id,c.brand_id,'marketing_content.view');
 select coalesce(jsonb_agg(to_jsonb(a)),'[]') into assets from public.marketing_assets a where a.id in (
 select ids.asset_id::uuid from public.marketing_content_revisions r cross join lateral jsonb_array_elements(r.payload->'variants') v(variant)
 cross join lateral marketing_private.variant_asset_ids(v.variant) ids(asset_id) where r.content_id=c.id and r.revision=c.revision);
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into events from (select action,actor_employee_id,details,created_at from public.marketing_events where content_id=c.id order by id desc limit 50)x;
 select to_jsonb(row) into projection from marketing_private.content_rows(c.organization_id,c.brand_id) row where row.id=c.id;
 return jsonb_build_object('assets',assets,'events',events,'content',to_jsonb(c)||coalesce(projection,'{}'::jsonb)||jsonb_build_object('brand_name',(select name from public.brands where id=c.brand_id),'payload',(select payload from public.marketing_content_revisions where content_id=c.id and revision=c.revision)));
end; $function$;


create table marketing_private.publication_availability (
 connection_id uuid not null references public.marketing_connections(id),
 connection_generation integer not null check(connection_generation>0),
 provider_account_id text not null check(provider_account_id ~ '^[0-9]{1,30}$'),
 provider_post_id text not null check(provider_post_id ~ '^[0-9]{1,30}(_[0-9]{1,30})?$'),
 state text not null default 'unknown' check(state in ('unknown','available','unavailable','access_restricted','temporarily_unavailable','deleted')),
 source text not null default 'not_checked',reason text not null default 'not_checked',
 checked_at timestamptz,last_attempt_at timestamptz,next_check_at timestamptz not null default now(),
 last_available_at timestamptz,last_removal_at timestamptz,last_removal_fingerprint text,
 primary key(connection_id,connection_generation,provider_post_id)
);
alter table marketing_private.publication_availability enable row level security;
revoke all on marketing_private.publication_availability from public,anon,authenticated;
create index publication_availability_identity_idx on marketing_private.publication_availability(connection_id,provider_post_id,provider_account_id,checked_at desc);

create function marketing_private.publication_known(p_connection uuid,p_generation integer,p_post text) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.marketing_connections c where c.id=p_connection and c.credential_generation=p_generation and (
  exists(select 1 from public.marketing_social_posts s where s.connection_id=c.id and s.organization_id=c.organization_id and s.brand_id=c.brand_id and s.provider_post_id=p_post
   and (s.connection_generation=p_generation or s.provider_account_id=c.provider_account_id))
  or exists(select 1 from public.marketing_jobs j where j.connection_id=c.id and j.organization_id=c.organization_id and j.brand_id=c.brand_id and j.connection_generation=p_generation and j.provider_post_id=p_post and j.state='succeeded')
 ));
$$;
revoke all on function marketing_private.publication_known(uuid,integer,text) from public,anon,authenticated;

create function public.marketing_meta_availability_targets(p_connection uuid,p_generation integer,p_lease uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare c public.marketing_connections;result jsonb;
begin
 if not public.marketing_meta_sync_guard(p_connection,p_generation,p_lease) then raise exception 'Synchronization authority expired.';end if;
 select * into c from public.marketing_connections where id=p_connection;
 with known as (
  select s.provider_post_id id,max(s.published_at) published_at from public.marketing_social_posts s
  where s.connection_id=c.id and s.organization_id=c.organization_id and s.brand_id=c.brand_id
   and (s.connection_generation=p_generation or s.provider_account_id=c.provider_account_id) and coalesce(s.media_product_type,'')<>'STORY' group by s.provider_post_id
  union all select j.provider_post_id,j.updated_at from public.marketing_jobs j join public.marketing_content_revisions r on r.content_id=j.content_id and r.revision=j.revision
  where j.connection_id=c.id and j.organization_id=c.organization_id and j.brand_id=c.brand_id and j.connection_generation=p_generation and j.state='succeeded' and j.provider_post_id is not null
   and not exists(select 1 from jsonb_array_elements(r.payload->'variants') v where v->>'channel'=c.channel and v->>'format'='story')
 ), targets as (
  select k.id,max(k.published_at) published_at,a.last_attempt_at from known k left join marketing_private.publication_availability a
   on a.connection_id=c.id and a.connection_generation=p_generation and a.provider_post_id=k.id
  where k.id ~ '^[0-9]{1,30}(_[0-9]{1,30})?$' and coalesce(a.next_check_at,'-infinity')<=now() group by k.id,a.last_attempt_at
  order by a.last_attempt_at nulls first,max(k.published_at) desc nulls last,k.id limit 1
 ) select coalesce(jsonb_agg(jsonb_build_object('id',id,'require_object_read',coalesce((select prior.state='deleted' from marketing_private.publication_availability prior where prior.connection_id=c.id and prior.provider_account_id=c.provider_account_id and prior.provider_post_id=targets.id order by prior.checked_at desc nulls last,prior.connection_generation desc limit 1),false))),'[]') into result from targets;
 return result;
end;$$;
revoke all on function public.marketing_meta_availability_targets(uuid,integer,uuid) from public,anon,authenticated;
grant execute on function public.marketing_meta_availability_targets(uuid,integer,uuid) to service_role;

create function marketing_private.record_publication_availability(p_connection uuid,p_generation integer,p_lease uuid,p_observations jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare c public.marketing_connections;o jsonb;a marketing_private.publication_availability;next_state text;next_reason text;next_source text;observed_time timestamptz;can_restore boolean;
begin
 if not public.marketing_meta_sync_guard(p_connection,p_generation,p_lease) then raise exception 'Synchronization authority expired.';end if;
 if jsonb_typeof(p_observations) is distinct from 'array' or jsonb_array_length(p_observations)>8 or octet_length(p_observations::text)>8192 then raise exception 'Invalid availability evidence.';end if;
 select * into c from public.marketing_connections where id=p_connection;
 for o in select value from jsonb_array_elements(p_observations) loop
  if not marketing_private.publication_known(c.id,p_generation,o->>'id') then raise exception 'Availability identity is not known to this connection.';end if;
  if o->>'state' not in ('available','unavailable','access_restricted','temporarily_unavailable') or o->>'state' is null
   or coalesce(o->>'source','') not in ('owned_feed','object_read')
   or coalesce(o->>'reason','') not in ('provider_observed','object_missing_or_unreadable','not_public','identity_unverified','permission_or_token','provider_temporary','response_unverified')
   or (o->>'source'='owned_feed' and (o->>'state'<>'available' or o->>'reason'<>'provider_observed')) then raise exception 'Invalid availability classification.';end if;
  insert into marketing_private.publication_availability(connection_id,connection_generation,provider_account_id,provider_post_id,state,source,reason,checked_at,last_available_at,last_removal_at,last_removal_fingerprint)
  select c.id,p_generation,c.provider_account_id,o->>'id',coalesce(prior.state,'unknown'),coalesce(prior.source,'not_checked'),coalesce(prior.reason,'not_checked'),prior.checked_at,prior.last_available_at,prior.last_removal_at,prior.last_removal_fingerprint
  from (select 1) seed left join lateral(select * from marketing_private.publication_availability old where old.connection_id=c.id and old.provider_account_id=c.provider_account_id and old.provider_post_id=o->>'id' order by old.checked_at desc nulls last,old.connection_generation desc limit 1) prior on true on conflict do nothing;
  select * into a from marketing_private.publication_availability where connection_id=c.id and connection_generation=p_generation and provider_post_id=o->>'id' for update;
  observed_time:=clock_timestamp();
  can_restore:=o->>'state'='available' and (a.state<>'deleted' or o->>'source'='object_read' and observed_time>a.last_removal_at);
  -- An ambiguous read cannot erase signed removal proof. A later positive read can.
  next_state:=case when a.state='deleted' and not can_restore then a.state else o->>'state' end;
  next_reason:=case when a.state='deleted' and not can_restore then a.reason else o->>'reason' end;
  next_source:=case when a.state='deleted' and not can_restore then a.source else o->>'source' end;
  update marketing_private.publication_availability set state=next_state,reason=next_reason,source=next_source,
   checked_at=case when a.state='deleted' and not can_restore then a.checked_at else observed_time end,last_attempt_at=observed_time,
   last_available_at=case when can_restore then observed_time else a.last_available_at end,
   next_check_at=observed_time+case when next_state='temporarily_unavailable' then interval '15 minutes' when next_state='deleted' then interval '24 hours' else interval '6 hours' end
  where connection_id=c.id and connection_generation=p_generation and provider_post_id=o->>'id';
 end loop;
end;$$;
revoke all on function marketing_private.record_publication_availability(uuid,integer,uuid,jsonb) from public,anon,authenticated;

-- Only the signature-verified Inbox webhook calls this service-only authority.
-- Feed removal is independent from customer messages and immutable publish receipts.
create function public.marketing_meta_publication_events(p_events jsonb) returns integer
language plpgsql security definer set search_path=public as $$
declare e jsonb;c public.marketing_connections;a marketing_private.publication_availability;at_time timestamptz;applied integer:=0;next_state text;
begin
 if jsonb_typeof(p_events) is distinct from 'array' or jsonb_array_length(p_events)>20 or octet_length(p_events::text)>8192 then raise exception 'Invalid publication event batch.';end if;
 for e in select value from jsonb_array_elements(p_events) loop
  if coalesce(e->>'source','')<>'signed_page_feed_remove' or coalesce(e->>'account_id','')!~'^[0-9]{1,30}$'
   or coalesce(e->>'id','')!~'^[0-9]{1,30}_[0-9]{1,30}$' or split_part(e->>'id','_',1)<>e->>'account_id'
   or coalesce(e->>'fingerprint','')!~'^[a-f0-9]{64}$' or jsonb_typeof(e->'occurred_at') is distinct from 'number' then raise exception 'Invalid signed removal evidence.';end if;
  at_time:=to_timestamp((e->>'occurred_at')::numeric);
  if at_time>now()+interval '5 minutes' or at_time<'2000-01-01' then raise exception 'Invalid removal timestamp.';end if;
  for c in select * from public.marketing_connections where channel='facebook' and provider_account_id=e->>'account_id'
   and status in ('test_authorized','production_authorized') and expires_at>now() and connected_at<=at_time
   and marketing_private.actor_allowed(connected_by,organization_id,brand_id,'marketing_settings.configure') for share loop
   if not marketing_private.publication_known(c.id,c.credential_generation,e->>'id') then continue;end if;
   insert into marketing_private.publication_availability(connection_id,connection_generation,provider_account_id,provider_post_id) values(c.id,c.credential_generation,c.provider_account_id,e->>'id') on conflict do nothing;
   select * into a from marketing_private.publication_availability where connection_id=c.id and connection_generation=c.credential_generation and provider_post_id=e->>'id' for update;
   if a.last_removal_at is not null and at_time<=a.last_removal_at then continue;end if;
   next_state:=case when a.last_available_at is null or at_time>a.last_available_at then 'deleted'
    when at_time=date_trunc('second',a.last_available_at) then 'unavailable' else null end;
   update marketing_private.publication_availability set state=coalesce(next_state,a.state),
    source=case when next_state='deleted' then 'signed_page_feed_remove' when next_state='unavailable' then 'signed_page_feed_remove' else a.source end,
    reason=case when next_state='deleted' then 'provider_removal' when next_state='unavailable' then 'event_order_ambiguous' else a.reason end,
    checked_at=case when next_state in ('deleted','unavailable') then at_time else a.checked_at end,
    last_removal_at=at_time,last_removal_fingerprint=e->>'fingerprint',next_check_at=case when next_state='deleted' then now()+interval '24 hours' else a.next_check_at end
   where connection_id=c.id and connection_generation=c.credential_generation and provider_post_id=e->>'id';
   insert into public.marketing_events(organization_id,brand_id,action,details) values(c.organization_id,c.brand_id,'publishing.provider_removal',jsonb_build_object('connection_id',c.id,'generation',c.credential_generation,'provider_post_id',e->>'id','source','signed_page_feed_remove','occurred_at',at_time,'fingerprint',e->>'fingerprint','effective_state',coalesce(next_state,a.state)));
   applied:=applied+1;
  end loop;
 end loop;return applied;
end;$$;
revoke all on function public.marketing_meta_publication_events(jsonb) from public,anon,authenticated;
grant execute on function public.marketing_meta_publication_events(jsonb) to service_role;

create function marketing_private.publication_availability_projection(p_connection uuid,p_generation integer,p_account text,p_post text) returns jsonb
language sql stable security definer set search_path=public as $$
 select coalesce((select jsonb_build_object('state',a.state,'source',a.source,'reason',a.reason,'checked_at',a.checked_at,'last_available_at',a.last_available_at,'last_attempt_at',a.last_attempt_at)
  from marketing_private.publication_availability a where a.connection_id=p_connection and a.provider_post_id=p_post
   and (a.connection_generation=p_generation or p_account is not null and a.provider_account_id=p_account)
  order by a.checked_at desc nulls last,a.connection_generation desc limit 1),jsonb_build_object('state','unknown','reason','not_checked'));
$$;
revoke all on function marketing_private.publication_availability_projection(uuid,integer,text,text) from public,anon,authenticated;

-- Seven explicit parameters select the extended finalizer; the exact six-argument RPC remains compatible.
CREATE OR REPLACE FUNCTION public.marketing_meta_sync_finish(p_connection uuid, p_generation integer, p_lease uuid, p_posts jsonb, p_after text, p_error text, p_availability jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
 perform marketing_private.record_publication_availability(p_connection,p_generation,p_lease,p_availability);
 perform marketing_private.sync_coverage_finish(c.id,p_generation,p_after,p_error);
 update public.marketing_connections set sync_lease_until=null,sync_after=p_after,
 sync_pages=case when p_error is null then sync_pages+1 else sync_pages end,
 sync_truncated=case when p_error is null then p_after is not null else sync_truncated end,
 sync_requested_at=null,last_synced_at=case when p_error is null then now() else last_synced_at end,last_checked_at=now(),
 sync_attempts=case when p_error is null then 0 else sync_attempts end,
 sync_retry_at=case when p_error is not null then now()+make_interval(secs=>least(3600,60*(2^sync_attempts)::integer)) end,
 sync_error_code=left(p_error,100),status=case when p_error='meta_permission_or_token_invalid' then 'error' else status end,
 error_code=case when p_error='meta_permission_or_token_invalid' then p_error else error_code end where id=c.id;
end;$function$;

revoke all on function public.marketing_meta_sync_finish(uuid,integer,uuid,jsonb,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.marketing_meta_sync_finish(uuid,integer,uuid,jsonb,text,text,jsonb) to service_role;

CREATE OR REPLACE FUNCTION marketing_private.content_rows(p_org uuid, p_brand uuid, p_operational boolean DEFAULT false)
 RETURNS TABLE(key text, id uuid, brand_id uuid, brand_name text, status text, revision integer, scheduled_at timestamp with time zone, schedule_timezone text, payload jsonb, planned_at timestamp with time zone, planned_timezone text, actual_at timestamp with time zone, display_at timestamp with time zone, origin text, title text, channels jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 with allowed_brands as materialized (
  select b.id from public.brands b where b.organization_id=p_org and (p_brand is null or b.id=p_brand) and marketing_private.brand_allowed(p_org,b.id)
 ), scoped_observations as materialized (
  select s.* from public.marketing_social_posts s where not p_operational and s.organization_id=p_org and (p_brand is null or s.brand_id=p_brand) and s.brand_id in (select id from allowed_brands)
 ), scoped_social as materialized (
  -- Old rows may lack an account snapshot. Resolve only an exact provider-post identity
  -- on the same connection/channel with one known account observation. No current-binding,
  -- caption, timestamp or task inference; ambiguous/unknown observations stay distinct.
  select s.id,s.organization_id,s.brand_id,s.connection_id,s.connection_generation,s.provider_post_id,s.channel,s.caption,s.permalink,s.published_at,s.observed_at,s.metrics,s.unavailable_metrics,s.metric_provenance,s.thumbnail_url,s.media,s.media_type,s.media_product_type,
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
  select c.id::text as key,c.id,c.brand_id,b.name as brand_name,
   case when c.status in ('scheduled','failed') then case
    when exists(select 1 from jsonb_array_elements(evidence.channels) v where v->>'job_state'='reconciling') then 'uncertain'
    when exists(select 1 from jsonb_array_elements(evidence.channels) v where v->>'job_state'='leased') then 'publishing'
    when exists(select 1 from jsonb_array_elements(evidence.channels) v where v->>'job_state'='failed') then 'failed'
    else c.status end else c.status end as status,c.revision,evidence.scheduled_at,c.schedule_timezone,r.payload,
   (r.payload->>'planned_at')::timestamptz as planned_at, r.payload->>'planned_timezone' as planned_timezone,
   evidence.actual_at,coalesce(evidence.actual_at,evidence.receipt_confirmed_at,evidence.scheduled_at,(r.payload->>'planned_at')::timestamptz) as display_at,
   'feedx'::text as origin,r.payload->>'title' as title,evidence.channels
  from public.marketing_content c join public.brands b on b.id=c.brand_id
  join public.marketing_content_revisions r on r.content_id=c.id and r.revision=c.revision
  cross join lateral (
   select max(s.published_at) as actual_at,min((timeline.evidence->>'scheduled_at')::timestamptz) as scheduled_at,max((timeline.evidence->>'receipt_confirmed_at')::timestamptz) as receipt_confirmed_at,jsonb_agg(jsonb_build_object(
    'channel',v->>'channel','caption',v->>'caption','format',v->>'format',
    'status',case when j.state='succeeded' then 'published' when j.state='failed' then 'failed' when j.state='leased' then 'publishing' when j.state='reconciling' then 'uncertain' when j.state in ('queued','retry') then 'scheduled' when j.state='blocked' then 'awaiting_authorization' when j.state='cancelled' then 'cancelled' else c.status end,
    'job_id',j.id,'job_updated_at',j.updated_at,'attempts',j.attempts,'failures',j.failures,'operations',marketing_private.publishing_job_actions(j),'job_state',j.state,'error_code',j.error_code,'provider_post_id',j.provider_post_id,'connection_id',j.connection_id,
    'scheduled_at',timeline.evidence->'scheduled_at','publishing_intention',timeline.evidence->'publishing_intention',
    'processing_started_at',timeline.evidence->'processing_started_at','receipt_confirmed_at',timeline.evidence->'receipt_confirmed_at',
    'receipt_verified',timeline.evidence->'receipt_verified','actual_at',s.published_at,
    'reel_cover',v->'reel_cover','availability',marketing_private.publication_availability_projection(j.connection_id,j.connection_generation,s.provider_account_id,j.provider_post_id),
    'permalink',coalesce(nullif(s.permalink,''),timeline.evidence->>'receipt_permalink'),
    'permalink_source',case when nullif(s.permalink,'') is not null then 'meta_observation' when timeline.evidence->>'receipt_permalink' is not null then 'facebook_receipt' end,'metrics',coalesce(s.metrics,'{}'::jsonb),
    'metric_provenance',coalesce(s.metric_provenance,'{}'::jsonb),'observed_at',s.observed_at,'unavailable_metrics',coalesce(s.unavailable_metrics,'{}'::jsonb),
    'media',s.media,'media_type',s.media_type,'media_product_type',s.media_product_type,'thumbnail_url',s.thumbnail_url,'assets',(select coalesce(jsonb_agg(to_jsonb(a) order by media_ord),'[]') from jsonb_array_elements_text(v->'asset_ids') with ordinality ids(asset_id,media_ord) join public.marketing_assets a on a.id=ids.asset_id::uuid where a.brand_id=c.brand_id and a.state in ('ready','retiring','retired')),'asset',(select to_jsonb(a) from public.marketing_assets a where a.id=(v->'asset_ids'->>0)::uuid and a.brand_id=c.brand_id and a.state in ('ready','retiring','retired'))
   ) order by v->>'channel') as channels
   from jsonb_array_elements(r.payload->'variants') v
   left join public.marketing_jobs j on j.content_id=c.id and j.revision=c.revision and j.channel=v->>'channel'
   left join lateral (select marketing_private.publishing_job_timeline(j) as evidence) timeline on true
   left join lateral (select s0.* from social s0 where s0.provider_post_id=j.provider_post_id and s0.channel=j.channel
    and s0.connection_id=j.connection_id and (s0.connection_generation=j.connection_generation or exists(
     select 1 from scoped_social old where old.connection_id=j.connection_id and old.connection_generation=j.connection_generation and old.provider_post_id=j.provider_post_id and old.provider_account_id=s0.provider_account_id
    )) limit 1) s on true
  ) evidence
  where c.organization_id=p_org and (p_brand is null or c.brand_id=p_brand) and c.brand_id in (select id from allowed_brands)
  and (not p_operational or c.status not in ('published','cancelled') or exists(select 1 from public.marketing_jobs pending where pending.content_id=c.id and pending.revision=c.revision and pending.state in ('failed','blocked','reconciling')))
 ), external as (
  select 'meta:'||s.id as key,null::uuid as id,s.brand_id,b.name as brand_name,'published'::text as status,null::integer as revision,
   null::timestamptz as scheduled_at,null::text as schedule_timezone,null::jsonb as payload,null::timestamptz as planned_at,null::text as planned_timezone,
   s.published_at as actual_at,s.published_at as display_at,'meta'::text as origin,coalesce(nullif(s.caption,''),'Untitled '||initcap(s.channel)||' post') as title,
   jsonb_build_array(jsonb_build_object('channel',s.channel,'caption',s.caption,'status','published','actual_at',s.published_at,
    'connection_id',s.connection_id,'provider_account_id',s.provider_account_id,'provider_post_id',s.provider_post_id,
    'availability',marketing_private.publication_availability_projection(s.connection_id,s.connection_generation,s.provider_account_id,s.provider_post_id),
    'permalink',s.permalink,'metrics',s.metrics,'unavailable_metrics',s.unavailable_metrics,'metric_provenance',coalesce(s.metric_provenance,'{}'::jsonb),'observed_at',s.observed_at,'media',s.media,'media_type',s.media_type,'media_product_type',s.media_product_type,'thumbnail_url',s.thumbnail_url)) as channels
  from social s join public.brands b on b.id=s.brand_id
  where not exists(select 1 from public.marketing_jobs j where j.organization_id=p_org and j.brand_id=s.brand_id and j.channel=s.channel and j.provider_post_id=s.provider_post_id
   and j.connection_id=s.connection_id and (j.connection_generation=s.connection_generation or exists(select 1 from scoped_social old where old.connection_id=j.connection_id and old.connection_generation=j.connection_generation and old.provider_post_id=j.provider_post_id and old.provider_account_id=s.provider_account_id)))
 )
 select * from concepts union all select * from external;
$function$;

CREATE OR REPLACE FUNCTION public.marketing_social_publications(p_org uuid, p_brand uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
 select (to_jsonb(s)-'identity_key')||jsonb_build_object('availability',marketing_private.publication_availability_projection(s.connection_id,s.connection_generation,case when s.identity_key ~ '^[0-9]{1,30}$' then s.identity_key end,s.provider_post_id),'metrics',coalesce(m.metrics,'{}'),'metric_provenance',coalesce(m.provenance,'{}'),'metric_observations',coalesce(m.observations,'{}')) record
 from selected s left join metrics m on m.channel=s.channel and m.identity_key=s.identity_key and m.provider_post_id=s.provider_post_id
 )
 select jsonb_build_object('posts',coalesce((select jsonb_agg(record) from folded),'[]'),'connections',coalesce((select jsonb_agg(to_jsonb(c)-array['sync_after','sync_lease','sync_lease_until']) from public.marketing_connections c where c.organization_id=p_org and (p_brand is null or c.brand_id=p_brand) and c.channel in ('facebook','instagram') and marketing_private.brand_allowed(p_org,c.brand_id)),'[]')) into result;
 return result;
end;$function$;

create or replace function public.marketing_meta_sync_finish(p_connection uuid,p_generation integer,p_lease uuid,p_posts jsonb,p_after text,p_error text) returns void
language plpgsql security definer set search_path=public as $$
begin perform public.marketing_meta_sync_finish(p_connection,p_generation,p_lease,p_posts,p_after,p_error,'[]'::jsonb);end;$$;
revoke all on function public.marketing_meta_sync_finish(uuid,integer,uuid,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.marketing_meta_sync_finish(uuid,integer,uuid,jsonb,text,text) to service_role;
