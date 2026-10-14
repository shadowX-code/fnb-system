CREATE OR REPLACE FUNCTION marketing_private.creators_workspace(p_org uuid, p_brand uuid, p_history boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare result jsonb; directory jsonb;
begin
 perform marketing_private.require_access(p_org,p_brand,'marketing_creators.view');
 if (select count(*) from public.marketing_creator_posts p where p.organization_id=p_org and (p_brand is null or p.brand_id=p_brand) and marketing_private.brand_allowed(p_org,p.brand_id))>5000 then raise exception 'Choose a brand to narrow this workspace.';end if;
 directory:=public.marketing_creator_directory(p_org,p_brand);
 select jsonb_build_object(
 'creators',directory->'creators','accounts',directory->'accounts',
 'collaborations',(select coalesce(jsonb_agg(to_jsonb(v)||jsonb_build_object('deliverables',(select coalesce(jsonb_agg(to_jsonb(d) order by d.due_date,d.id),'[]') from public.marketing_creator_deliverables d where d.collaboration_id=v.id)) order by v.created_at desc),'[]') from public.marketing_creator_collaborations v
 where v.organization_id=p_org and (p_brand is null or v.brand_id=p_brand) and marketing_private.brand_allowed(p_org,v.brand_id)),
 'posts',(select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('snapshot_count',(select count(*) from public.marketing_creator_metric_snapshots s where s.post_id=p.id),'latest_metrics',(select coalesce(jsonb_object_agg(x.key,x.value),'{}') from (select distinct on(k.key) k.key,k.value
 from public.marketing_creator_metric_snapshots s cross join lateral jsonb_each(s.metrics) k where s.post_id=p.id order by k.key,s.captured_at desc,s.recorded_at desc,s.id desc)x)) order by p.created_at desc),'[]')
 from public.marketing_creator_posts p where p.organization_id=p_org and (p_brand is null or p.brand_id=p_brand) and marketing_private.brand_allowed(p_org,p.brand_id)),
 'snapshots',case when p_history then (select coalesce(jsonb_agg(to_jsonb(s) order by s.captured_at desc,s.recorded_at desc,s.id desc),'[]') from public.marketing_creator_metric_snapshots s join public.marketing_creator_posts p on p.id=s.post_id
 where p.organization_id=p_org and (p_brand is null or p.brand_id=p_brand) and marketing_private.brand_allowed(p_org,p.brand_id)) else '[]'::jsonb end,
 'members',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',e.full_name,'brand_ids',(select jsonb_agg(b.id) from public.brands b where b.organization_id=p_org and marketing_private.brand_allowed(p_org,b.id) and marketing_private.creative_assignee_allowed(p_org,b.id,e.id))) order by e.full_name),'[]') from public.employees e
 join public.organization_memberships om on om.employee_id=e.id and om.organization_id=p_org where e.is_active and exists(select 1 from public.brands b where b.organization_id=p_org and marketing_private.brand_allowed(p_org,b.id) and marketing_private.creative_assignee_allowed(p_org,b.id,e.id))),
 'campaigns',case when public.current_user_has_permission('marketing_campaigns.view') then (select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'title',c.title,'brand_id',c.brand_id)),'[]') from public.marketing_campaigns c where c.organization_id=p_org and (p_brand is null or c.brand_id=p_brand) and marketing_private.brand_allowed(p_org,c.brand_id)) else '[]'::jsonb end,
 'assets',case when public.current_user_has_permission('marketing_content.view') then (select coalesce(jsonb_agg(to_jsonb(m)-'cleanup_lease'-'cleanup_started_at'),'[]') from public.marketing_assets m where m.organization_id=p_org and marketing_private.brand_allowed(p_org,m.brand_id) and (
 exists(select 1 from public.marketing_creators c where c.avatar_asset_id=m.id and marketing_private.creator_visible(p_org,c.id,p_brand)) or
 exists(select 1 from public.marketing_creator_posts p where p.asset_id=m.id and (p_brand is null or p.brand_id=p_brand) and marketing_private.brand_allowed(p_org,p.brand_id)))) else '[]'::jsonb end
 ) into result;return result||jsonb_build_object('options',directory->'options');
end;$function$
;
create or replace function public.marketing_creators_read(p_org uuid,p_brand uuid default null) returns jsonb language sql stable security definer set search_path=public as $$select marketing_private.creators_workspace(p_org,p_brand,true)$$;
create function public.marketing_creator_workspace(p_org uuid,p_brand uuid default null) returns jsonb language sql stable security definer set search_path=public as $$select marketing_private.creators_workspace(p_org,p_brand,false)$$;
revoke all on function marketing_private.creators_workspace(uuid,uuid,boolean),public.marketing_creator_workspace(uuid,uuid) from public,anon,authenticated;
grant execute on function public.marketing_creator_workspace(uuid,uuid) to authenticated;
create function public.marketing_creator_metric_history(p_org uuid,p_post uuid,p_after jsonb default null,p_size integer default 25) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare p public.marketing_creator_posts; result jsonb;
begin
 select * into p from public.marketing_creator_posts where id=p_post and organization_id=p_org;
 if p.id is null then raise exception using errcode='42501',message='Post access unavailable.';end if;
 perform marketing_private.require_access(p_org,p.brand_id,'marketing_creators.view');
 if p_size is null or p_size not between 1 and 100 or (p_after is not null and (jsonb_typeof(p_after)<>'object' or p_after->>'id' is null or p_after->>'captured_at' is null or p_after->>'recorded_at' is null)) then raise exception 'Invalid history cursor.';end if;
 with page as materialized (
 select s.* from public.marketing_creator_metric_snapshots s where s.post_id=p_post
 and (p_after is null or (s.captured_at,s.recorded_at,s.id)<((p_after->>'captured_at')::timestamptz,(p_after->>'recorded_at')::timestamptz,(p_after->>'id')::uuid))
 order by s.captured_at desc,s.recorded_at desc,s.id desc limit p_size+1
 ), visible as materialized(select * from page order by captured_at desc,recorded_at desc,id desc limit p_size)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(v) order by captured_at desc,recorded_at desc,id desc) from visible v),'[]'),
 'total',(select count(*) from public.marketing_creator_metric_snapshots where post_id=p_post),
 'next',case when (select count(*) from page)>p_size then (select jsonb_build_object('captured_at',captured_at,'recorded_at',recorded_at,'id',id) from visible order by captured_at,recorded_at,id limit 1) end) into result;
 return result;
end;$$;
revoke all on function public.marketing_creator_metric_history(uuid,uuid,jsonb,integer) from public,anon;
grant execute on function public.marketing_creator_metric_history(uuid,uuid,jsonb,integer) to authenticated;
create index marketing_creator_metrics_cursor on public.marketing_creator_metric_snapshots(post_id,captured_at desc,recorded_at desc,id desc);

create function marketing_private.content_rows(p_org uuid,p_brand uuid,p_operational boolean default false)
returns table(key text,id uuid,brand_id uuid,brand_name text,status text,revision integer,scheduled_at timestamptz,schedule_timezone text,payload jsonb,planned_at timestamptz,planned_timezone text,actual_at timestamptz,display_at timestamptz,origin text,title text,channels jsonb)
language sql stable security definer set search_path=public as $helper$
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
    'metric_provenance',coalesce(s.metric_provenance,'{}'::jsonb),'observed_at',s.observed_at,'unavailable_metrics',coalesce(s.unavailable_metrics,'{}'::jsonb),
    'media',s.media,'media_type',s.media_type,'media_product_type',s.media_product_type,'thumbnail_url',s.thumbnail_url,'assets',(select coalesce(jsonb_agg(to_jsonb(a) order by media_ord),'[]') from jsonb_array_elements_text(v->'asset_ids') with ordinality ids(asset_id,media_ord) join public.marketing_assets a on a.id=ids.asset_id::uuid where a.brand_id=c.brand_id and a.state in ('ready','retiring','retired')),'asset',(select to_jsonb(a) from public.marketing_assets a where a.id=(v->'asset_ids'->>0)::uuid and a.brand_id=c.brand_id and a.state in ('ready','retiring','retired'))
   ) order by v->>'channel') as channels
   from jsonb_array_elements(r.payload->'variants') v
   left join public.marketing_jobs j on j.content_id=c.id and j.revision=c.revision and j.channel=v->>'channel'
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
    'permalink',s.permalink,'metrics',s.metrics,'unavailable_metrics',s.unavailable_metrics,'metric_provenance',coalesce(s.metric_provenance,'{}'::jsonb),'observed_at',s.observed_at,'media',s.media,'media_type',s.media_type,'media_product_type',s.media_product_type,'thumbnail_url',s.thumbnail_url)) as channels
  from social s join public.brands b on b.id=s.brand_id
  where not exists(select 1 from public.marketing_jobs j where j.organization_id=p_org and j.brand_id=s.brand_id and j.channel=s.channel and j.provider_post_id=s.provider_post_id
   and j.connection_id=s.connection_id and (j.connection_generation=s.connection_generation or exists(select 1 from scoped_social old where old.connection_id=j.connection_id and old.connection_generation=j.connection_generation and old.provider_post_id=j.provider_post_id and old.provider_account_id=s.provider_account_id)))
 )
 select * from concepts union all select * from external;
$helper$;
revoke all on function marketing_private.content_rows(uuid,uuid,boolean) from public,anon,authenticated;
CREATE OR REPLACE FUNCTION public.marketing_content_management(p_org uuid, p_brand uuid DEFAULT NULL::uuid, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_search text DEFAULT ''::text, p_channel text DEFAULT ''::text, p_status text DEFAULT ''::text, p_sort text DEFAULT 'date_desc'::text, p_group text DEFAULT ''::text, p_page integer DEFAULT 1, p_page_size integer DEFAULT 20, p_view text DEFAULT 'list'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare result jsonb;
begin
 perform marketing_private.require_access(p_org,p_brand,case when public.current_user_has_permission('marketing_calendar.view') then 'marketing_calendar.view' else 'marketing_content.view' end);
 if p_page is null or p_page not between 1 and 100000 or p_page_size is null or p_page_size not in (20,50,100)
 or p_view is null or p_view not in ('list','calendar') or p_sort is null or p_sort not in ('date_desc','date_asc','title','brand','status')
 or p_group is null or p_group not in ('','date','brand','status') or p_channel is null or p_channel not in ('','facebook','instagram')
 or p_status is null or p_status not in ('','draft','review','approved','scheduled','published','failed','rejected','cancelled')
 or p_search is null or length(p_search)>200 or (p_from is not null and p_to is not null and p_from>=p_to)
 or (p_view='calendar' and (p_from is null or p_to is null or p_to-p_from>interval '42 days')) then raise exception 'Invalid content filters.'; end if;
 with source as materialized (select * from marketing_private.content_rows(p_org,p_brand)), filtered as materialized (
  select x.*,to_char(x.display_at at time zone 'Asia/Kuala_Lumpur','YYYY-MM-DD') as day,
   case p_group when 'brand' then x.brand_name when 'status' then x.status when 'date' then to_char(x.display_at at time zone 'Asia/Kuala_Lumpur','YYYY-MM-DD') else '' end as group_key
  from source x
  where (p_view='list' or display_at is not null) and (p_from is null or display_at>=p_from) and (p_to is null or display_at<p_to)
   and (p_search='' or position(lower(p_search) in lower(title||' '||coalesce((select string_agg(v->>'caption',' ') from jsonb_array_elements(channels) v),'')))>0)
   and (p_channel='' or exists(select 1 from jsonb_array_elements(channels) v where v->>'channel'=p_channel))
   and (p_status='' or status=p_status or exists(select 1 from jsonb_array_elements(channels) v where v->>'status'=p_status))
 ), ranked as (
  select f.*,row_number() over(partition by day order by display_at,key) as day_rank,
   row_number() over(order by case when p_group='date' and p_sort='date_desc' then group_key end desc,case when not(p_group='date' and p_sort='date_desc') then group_key end,
    case when p_sort='date_desc' then display_at end desc nulls last,
    case when p_sort='date_asc' then display_at end asc nulls last,
    case when p_sort='title' then lower(title) when p_sort='brand' then brand_name when p_sort='status' then status end,key) as rank
  from filtered f
 ), page_rows as (
  select * from ranked where case when p_view='calendar' then day_rank<=3 else rank>(p_page-1)*p_page_size and rank<=p_page*p_page_size end
 )
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(q)-array['day_rank','rank'] order by rank) from page_rows q),'[]'::jsonb),
  'total_count',(select count(*) from filtered),'day_counts',coalesce((select jsonb_object_agg(coalesce(day,'unscheduled'),n) from (select day,count(*) n from filtered group by day) d),'{}'::jsonb),
  'timezone','Asia/Kuala_Lumpur') into result;
 return result;
end;$function$
;
create function public.marketing_dashboard_operations(p_org uuid,p_brand uuid default null) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare rows jsonb:=null; content jsonb:=null; actor uuid;
begin
 actor:=marketing_private.require_access(p_org,p_brand,'marketing_workspace.access');
 if public.current_user_has_permission('marketing_calendar.view') or public.current_user_has_permission('marketing_content.view') then
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into content from marketing_private.content_rows(p_org,p_brand,true) x;
 end if;
 if public.current_user_has_permission('marketing_inbox.view') then
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into rows from (
 select c.id,c.organization_id,c.brand_id,b.name brand_name,c.channel,c.title,c.status,c.priority,c.assigned_to,c.tags,c.takeover,c.escalation_reasons,c.version,c.last_inbound_at,c.updated_at,c.medium,c.intent,c.language,c.opted_out,marketing_private.inbox_needs_reply(c.id) needs_reply,latest.body latest_message,latest.kind latest_message_kind,latest.occurred_at latest_message_at,e.full_name assignee_name,marketing_private.inbox_unread(c.id,actor) unread_count
 from public.marketing_conversations c join public.brands b on b.id=c.brand_id left join public.employees e on e.id=c.assigned_to left join lateral (select last_message.body,last_message.kind,last_message.occurred_at from (select m.body,m.kind,m.occurred_at,m.id from public.marketing_conversation_messages m where m.conversation_id=c.id and m.kind in ('incoming','echo','attachment','note') union all select d.body,'echo',o.sent_at,d.id from public.marketing_reply_outbox o join public.marketing_reply_drafts d on d.id=o.draft_id where d.conversation_id=c.id and o.state in ('sent','delivered','read') and o.provider_message_id is not null and o.sent_at is not null and not exists(select 1 from public.marketing_conversation_messages m where m.conversation_id=c.id and m.kind='echo' and m.provider_message_id=o.provider_message_id)) last_message order by last_message.occurred_at desc,last_message.id desc limit 1) latest on true where c.organization_id=p_org and (p_brand is null or c.brand_id=p_brand) and marketing_private.brand_allowed(p_org,c.brand_id)
 and c.channel<>'internal' and c.status<>'resolved' and marketing_private.inbox_needs_reply(c.id) order by c.updated_at desc,c.id)x;
 end if;
 return jsonb_build_object('content',content,'conversations',rows);
end;$$;
revoke all on function public.marketing_dashboard_operations(uuid,uuid) from public,anon;
grant execute on function public.marketing_dashboard_operations(uuid,uuid) to authenticated;
create function public.marketing_planner_publishing(p_org uuid,p_brand uuid,p_from timestamptz,p_to timestamptz,p_linked uuid[] default '{}') returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
 perform marketing_private.require_access(p_org,p_brand,case when public.current_user_has_permission('marketing_calendar.view') then 'marketing_calendar.view' else 'marketing_content.view' end);
 if p_from is null or p_to is null or p_from>=p_to or p_to-p_from>interval '42 days' or cardinality(p_linked)>5000 then raise exception 'Invalid planning period.';end if;
 select jsonb_build_object('rows',coalesce(jsonb_agg(to_jsonb(x)),'[]')) into result from marketing_private.content_rows(p_org,p_brand) x
 where x.id=any(p_linked) or x.display_at>=p_from and x.display_at<p_to or exists(select 1 from jsonb_array_elements(x.channels) ch where (ch->>'actual_at')::timestamptz>=p_from and (ch->>'actual_at')::timestamptz<p_to);
 return result;
end;$$;
revoke all on function public.marketing_planner_publishing(uuid,uuid,timestamptz,timestamptz,uuid[]) from public,anon;
grant execute on function public.marketing_planner_publishing(uuid,uuid,timestamptz,timestamptz,uuid[]) to authenticated;

create function public.marketing_social_publications(p_org uuid,p_brand uuid,p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
 perform marketing_private.require_access(p_org,p_brand,'marketing_analytics.view');
 if p_from is not null and p_to is not null and p_from>p_to then raise exception 'Invalid publication dates.';end if;
 with scoped as materialized (
 select s.* from public.marketing_social_posts s where s.organization_id=p_org and (p_brand is null or s.brand_id=p_brand) and marketing_private.brand_allowed(p_org,s.brand_id)
 ), identities as materialized (
 select s.*,coalesce(s.provider_account_id,verified.account_id,s.connection_id::text||':'||s.connection_generation) identity_key
 from scoped s left join lateral(select min(k.provider_account_id) account_id from scoped k where k.connection_id=s.connection_id and k.channel=s.channel and k.provider_post_id=s.provider_post_id and k.provider_account_id is not null having count(distinct k.provider_account_id)=1) verified on s.provider_account_id is null
 ), latest as materialized (
 select distinct on(channel,identity_key,provider_post_id) * from identities order by channel,identity_key,provider_post_id,observed_at desc,id desc
 ), selected as materialized (
 select * from latest where published_at is not null and (p_from is null or published_at>=p_from::timestamp at time zone 'Asia/Kuala_Lumpur') and (p_to is null or published_at<(p_to+1)::timestamp at time zone 'Asia/Kuala_Lumpur')
 ), folded as (
 select (to_jsonb(s)-'identity_key')||jsonb_build_object('metrics',coalesce(metric_fold.metrics,'{}'),'metric_provenance',coalesce(metric_fold.provenance,'{}'),'metric_observations',coalesce(metric_fold.observations,'{}')) record
 from selected s left join lateral(
 select jsonb_object_agg(key,value) metrics,jsonb_object_agg(key,provenance) filter(where provenance is not null) provenance,jsonb_object_agg(key,observed_at) observations from(
 select distinct on(keys.key) keys.key,
 case when keys.key='interactions' and s.channel='facebook' then case when case when jsonb_typeof(o.metrics->'interactions')='number' then (o.metrics->>'interactions')::numeric>=0 else false end then (o.metrics->>'interactions')::numeric else (o.metrics->>'reactions')::numeric+(o.metrics->>'comments')::numeric+(o.metrics->>'shares')::numeric end else (o.metrics->>keys.key)::numeric end value,
 o.metric_provenance->keys.key provenance,coalesce(o.metric_provenance->keys.key->>'observed_at',o.observed_at::text) observed_at
 from identities o cross join unnest(array['views','viewers','interactions','likes','reactions','comments','shares','saves','reach','watch_time_ms','avg_watch_time_ms']) keys(key)
 where o.channel=s.channel and o.identity_key=s.identity_key and o.provider_post_id=s.provider_post_id and o.connection_id=s.connection_id and o.connection_generation=s.connection_generation
 and (case when jsonb_typeof(o.metrics->keys.key)='number' then (o.metrics->>keys.key)::numeric>=0 else false end
 or keys.key='interactions' and s.channel='facebook'
 and case when jsonb_typeof(o.metrics->'reactions')='number' and jsonb_typeof(o.metrics->'comments')='number' and jsonb_typeof(o.metrics->'shares')='number' then (o.metrics->>'reactions')::numeric>=0 and (o.metrics->>'comments')::numeric>=0 and (o.metrics->>'shares')::numeric>=0 else false end)
 order by keys.key,o.observed_at desc,o.id desc
 ) v
 ) metric_fold on true
 )
 select jsonb_build_object('posts',coalesce((select jsonb_agg(record) from folded),'[]'),'connections',coalesce((select jsonb_agg(to_jsonb(c)-array['sync_after','sync_lease','sync_lease_until']) from public.marketing_connections c where c.organization_id=p_org and (p_brand is null or c.brand_id=p_brand) and c.channel in ('facebook','instagram') and marketing_private.brand_allowed(p_org,c.brand_id)),'[]')) into result;
 return result;
end;$$;
revoke all on function public.marketing_social_publications(uuid,uuid,date,date) from public,anon;
grant execute on function public.marketing_social_publications(uuid,uuid,date,date) to authenticated;
