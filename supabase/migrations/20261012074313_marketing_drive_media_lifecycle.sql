-- Drive originals remain external. Only new publishing snapshots are temporary.
alter table public.marketing_assets add column storage_policy text not null default 'legacy' check(storage_policy in ('legacy','temporary')),
 add column source_kind text not null default 'legacy' check(source_kind in ('legacy','device','drive')),
 add column source_metadata jsonb not null default '{}', add column sha256 text,
 add column snapshot_verified_at timestamptz, add column cleanup_lease uuid, add column cleanup_started_at timestamptz, add column retired_at timestamptz;
alter table public.marketing_assets drop constraint marketing_assets_state_check;
alter table public.marketing_assets add constraint marketing_assets_state_check check(state in ('pending','ready','retiring','retired'));
create index marketing_temporary_assets on public.marketing_assets(brand_id,sha256) where storage_policy='temporary';
create table marketing_private.drive_connections(
 organization_id uuid primary key references public.organizations(id), generation integer not null default 0,
 status text not null default 'disconnected' check(status in ('connected','expired','disconnected')),
 account jsonb not null default '{}', sealed_token jsonb, expires_at timestamptz, updated_at timestamptz not null default now());
create table marketing_private.drive_roots(
 brand_id uuid primary key, organization_id uuid not null, root_id text not null, root_name text not null,
 favorites_id text, generation integer not null, revision uuid not null default gen_random_uuid(),
 foreign key(organization_id,brand_id) references public.brands(organization_id,id), unique(organization_id,root_id));
create table marketing_private.drive_oauth(
 state_hash text primary key, organization_id uuid not null references public.organizations(id), actor uuid not null references public.employees(id),
 generation integer not null, sealed_verifier jsonb not null, expires_at timestamptz not null default now()+interval '10 minutes', consumed_at timestamptz);
alter table marketing_private.drive_connections enable row level security;
alter table marketing_private.drive_roots enable row level security;
alter table marketing_private.drive_oauth enable row level security;
revoke all on marketing_private.drive_connections,marketing_private.drive_roots,marketing_private.drive_oauth from public,anon,authenticated;
create function marketing_private.drive_admin(p_actor uuid,p_org uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.employees e join public.roles r on r.id=e.role_id join public.organization_memberships m on m.employee_id=e.id
 where e.id=p_actor and m.organization_id=p_org and e.is_active and e.enable_system_login and e.access_state='active' and r.is_active
 and (lower(r.name) in ('owner','admin') or (select count(distinct p.code) from public.role_permissions rp join public.permissions p on p.id=rp.permission_id
 where rp.role_id=r.id and p.code in ('marketing_workspace.access','marketing_settings.configure','platform_organizations.manage'))=3));$$;
revoke all on function marketing_private.drive_admin(uuid,uuid) from public,anon,authenticated;
-- Single service boundary. Auth UID is verified by the Edge Function, never taken from a browser payload.
create function public.marketing_drive_server(p_action text,p_user uuid,p_org uuid,p_brand uuid default null,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public as $$
declare actor uuid; c marketing_private.drive_connections; o marketing_private.drive_oauth; a public.marketing_assets; result jsonb; admin boolean; metadata jsonb;
begin
 if p_action in ('oauth_consume','oauth_finish') then
  select * into o from marketing_private.drive_oauth where state_hash=p_data->>'state_hash' for update;
  if not found or o.expires_at<now() or (p_action='oauth_consume' and o.consumed_at is not null) or (p_action='oauth_finish' and o.consumed_at is null) then raise exception 'Authorization expired. Connect again.';end if;
  p_org:=o.organization_id;actor:=o.actor;
 else select id into actor from public.employees where auth_user_id=p_user;end if;
 admin:=marketing_private.drive_admin(actor,p_org);
 if p_action in ('context','material','guard','prepare','finalize','refresh','expired') then
  if not admin and not marketing_private.actor_allowed(actor,p_org,p_brand,'marketing_content.view') then raise exception using errcode='42501',message='Brand media access is unavailable.';end if;
 else if not admin then raise exception using errcode='42501',message='Organization administrator access is required.';end if;end if;
 select * into c from marketing_private.drive_connections where organization_id=p_org for update;
 if p_action='context' then
  return jsonb_build_object('status',coalesce(c.status,'disconnected'),'account',c.account,'expires_at',c.expires_at,'can_manage',admin,
   'root',(select to_jsonb(r) from marketing_private.drive_roots r where r.organization_id=p_org and r.brand_id=p_brand),
   'mappings',case when admin then (select coalesce(jsonb_agg(to_jsonb(r) order by r.brand_id),'[]') from marketing_private.drive_roots r where r.organization_id=p_org) else '[]'::jsonb end);
 elsif p_action in ('material','guard') then
  if c.status<>'connected' or c.sealed_token is null then raise exception 'Connect or reconnect Google Drive in Marketing Settings.';end if;
  if p_action='guard' and (c.generation is distinct from (p_data->>'generation')::integer or not exists(select 1 from marketing_private.drive_roots r where r.brand_id=p_brand and r.revision::text=p_data->>'revision')) then raise exception 'Brand folder access changed. Refresh the library.';end if;
  return to_jsonb(c)||jsonb_build_object('root',(select to_jsonb(r) from marketing_private.drive_roots r where r.organization_id=p_org and r.brand_id=p_brand),'mappings',case when admin then (select coalesce(jsonb_agg(to_jsonb(r) order by r.brand_id),'[]') from marketing_private.drive_roots r where r.organization_id=p_org) else '[]'::jsonb end);
 elsif p_action='begin' then
  insert into marketing_private.drive_connections(organization_id) values(p_org) on conflict do nothing;
  select * into c from marketing_private.drive_connections where organization_id=p_org;
  delete from marketing_private.drive_oauth where expires_at<now();
  insert into marketing_private.drive_oauth(state_hash,organization_id,actor,generation,sealed_verifier) values(p_data->>'state_hash',p_org,actor,c.generation,p_data->'sealed_verifier');
  return jsonb_build_object('generation',c.generation);
 elsif p_action='oauth_consume' then
  if c.generation is distinct from o.generation then raise exception 'Connection changed. Connect again.';end if;
  update marketing_private.drive_oauth set consumed_at=now() where state_hash=o.state_hash;
  return to_jsonb(o)||jsonb_build_object('connection',to_jsonb(c));
 elsif p_action='oauth_finish' then
  if c.generation is distinct from o.generation then raise exception 'Connection changed. Connect again.';end if;
  if c.account->>'permissionId' is distinct from p_data->'account'->>'permissionId' then delete from marketing_private.drive_roots where organization_id=p_org;end if;
  update marketing_private.drive_connections set generation=generation+1,status='connected',account=p_data->'account',sealed_token=p_data->'sealed_token',expires_at=(p_data->>'expires_at')::timestamptz,updated_at=now() where organization_id=p_org;
  update marketing_private.drive_roots set generation=c.generation+1,revision=gen_random_uuid() where organization_id=p_org;
  delete from marketing_private.drive_oauth where state_hash=o.state_hash;
 elsif p_action='refresh' then
  if c.generation is distinct from (p_data->>'generation')::integer then raise exception 'Connection changed.';end if;
  update marketing_private.drive_connections set sealed_token=p_data->'sealed_token',expires_at=(p_data->>'expires_at')::timestamptz,updated_at=now() where organization_id=p_org;
 elsif p_action='expired' then
  update marketing_private.drive_connections set status='expired',updated_at=now() where organization_id=p_org and generation=(p_data->>'generation')::integer;
 elsif p_action='disconnect' then
  update marketing_private.drive_connections set status='disconnected',generation=generation+1,sealed_token=null,expires_at=null,updated_at=now() where organization_id=p_org;
  delete from marketing_private.drive_oauth where organization_id=p_org;
 elsif p_action='map' then
  if c.status<>'connected' or c.generation is distinct from (p_data->>'generation')::integer or not exists(select 1 from public.brands where id=p_brand and organization_id=p_org) then raise exception 'Connection or brand changed.';end if;
  -- Reject stale overlap checks after a concurrent mapping update.
  if coalesce(p_data->'mappings','[]') is distinct from (select coalesce(jsonb_agg(to_jsonb(r) order by r.brand_id),'[]') from marketing_private.drive_roots r where r.organization_id=p_org) then raise exception 'Folder mappings changed. Review and save again.';end if;
  insert into marketing_private.drive_roots(brand_id,organization_id,root_id,root_name,favorites_id,generation) values(p_brand,p_org,p_data->>'root_id',p_data->>'root_name',nullif(p_data->>'favorites_id',''),c.generation)
  on conflict(brand_id) do update set root_id=excluded.root_id,root_name=excluded.root_name,favorites_id=excluded.favorites_id,generation=excluded.generation,revision=gen_random_uuid();
 elsif p_action='prepare' then
  if not marketing_private.actor_allowed(actor,p_org,p_brand,'marketing_content.upload') or not exists(select 1 from public.brands where id=p_brand and organization_id=p_org) then raise exception 'Brand media upload permission is required.';end if;
  if p_data->>'source_kind' not in ('device','drive') or length(trim(p_data->>'filename')) not between 1 and 200 or (p_data->>'size_bytes')::bigint not between 1 and 104857600 or p_data->>'mime_type' not in ('image/jpeg','image/png','image/webp','video/mp4') then raise exception 'Use JPG, PNG, WebP or MP4 up to 100 MB.';end if;
  if p_data->>'source_kind'='drive' and (c.generation is distinct from (p_data->>'generation')::integer or not exists(select 1 from marketing_private.drive_roots where brand_id=p_brand and revision::text=p_data->>'revision')) then raise exception 'Brand folder changed.';end if;
  -- Deduplicate exact immutable Drive source versions in one brand, never across brands.
  if p_data->>'source_kind'='drive' then
   perform pg_advisory_xact_lock(hashtextextended(p_brand::text||coalesce(p_data->'source_metadata'->>'file_id',''),0));
   select * into a from public.marketing_assets where brand_id=p_brand and source_kind='drive' and state='ready' and source_metadata=p_data->'source_metadata' and sha256=p_data->>'sha256' limit 1;
   if found then return to_jsonb(a)||jsonb_build_object('reused',true);end if;
  end if;
  a.id:=gen_random_uuid();
  insert into public.marketing_assets(id,organization_id,brand_id,filename,mime_type,size_bytes,object_path,created_by,storage_policy,source_kind,source_metadata)
  values(a.id,p_org,p_brand,p_data->>'filename',p_data->>'mime_type',(p_data->>'size_bytes')::bigint,p_org::text||'/'||p_brand::text||'/'||a.id::text,actor,'temporary',p_data->>'source_kind',coalesce(p_data->'source_metadata','{}')) returning * into a;
  return to_jsonb(a)||jsonb_build_object('bucket','marketing-media');
 elsif p_action='finalize' then
  select * into a from public.marketing_assets where id=(p_data->>'id')::uuid for update;
  if a.organization_id is distinct from p_org or a.brand_id is distinct from p_brand or a.created_by is distinct from actor or a.storage_policy<>'temporary' or a.state not in ('pending','ready') then raise exception 'Upload is unavailable.';end if;
  if p_data->>'sha256' !~ '^[0-9a-f]{64}$' then raise exception 'Verified media bytes are required.';end if;
  select o.metadata into metadata from storage.objects o where bucket_id='marketing-media' and name=a.object_path;
  if metadata is null or (metadata->>'size')::bigint is distinct from a.size_bytes or metadata->>'mimetype' is distinct from a.mime_type then raise exception 'Uploaded file does not match its snapshot.';end if;
  update public.marketing_assets set state='ready',sha256=p_data->>'sha256',snapshot_verified_at=now() where id=a.id returning * into a;
  return to_jsonb(a);
 else raise exception 'Unsupported Drive action.';end if;
 insert into public.marketing_events(organization_id,brand_id,action,actor_employee_id,details) values(p_org,p_brand,'drive_'||p_action,actor,'{}');
 return jsonb_build_object('ok',true);
end;$$;
revoke all on function public.marketing_drive_server(text,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.marketing_drive_server(text,uuid,uuid,uuid,jsonb) to service_role;
-- Browser finalization remains compatible for legacy uploads but cannot attest new snapshots.
create or replace function public.marketing_finalize_asset(p_asset uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.marketing_assets; metadata jsonb; actor uuid;
begin
 select * into a from public.marketing_assets where id=p_asset for update;
 if not found then raise exception 'Media is unavailable.'; end if;
 actor:=marketing_private.require_access(a.organization_id,a.brand_id,'marketing_content.upload');
 if a.created_by<>actor then raise exception using errcode='42501',message='Only the uploader can finish this upload.'; end if;
 if a.storage_policy='temporary' and a.snapshot_verified_at is null then raise exception 'Server media verification is required.';end if;
 if a.state='ready' then return to_jsonb(a); end if;
 select o.metadata into metadata from storage.objects o where o.bucket_id='marketing-media' and o.name=a.object_path;
 if metadata is null or (metadata->>'size')::bigint is distinct from a.size_bytes or metadata->>'mimetype' is distinct from a.mime_type then raise exception 'The uploaded media does not match its registered file.'; end if;
 update public.marketing_assets set state='ready' where id=a.id returning * into a;
 insert into public.marketing_events(organization_id,brand_id,action,actor_employee_id,details) values(a.organization_id,a.brand_id,'asset_uploaded',actor,jsonb_build_object('asset_id',a.id));
 return to_jsonb(a);
end; $$;

-- Reference creation locks assets against retirement; approvals still use canonical validation.
create function marketing_private.pin_media_reference() returns trigger language plpgsql security definer set search_path=public as $$
declare ids jsonb; asset_id text; a public.marketing_assets;
begin
 if tg_table_name='marketing_content_revisions' then
  select coalesce(jsonb_agg(ids.asset_id),'[]') into ids from jsonb_array_elements(new.payload->'variants') v cross join jsonb_array_elements_text(v->'asset_ids') ids(asset_id);
 elsif tg_table_name='marketing_campaign_revisions' then ids:=jsonb_build_array(new.payload->>'asset_id');
 else ids:=jsonb_build_array(new.configuration->>'asset_id');end if;
 for asset_id in select jsonb_array_elements_text(ids) loop
  if asset_id is null or asset_id='' then continue;end if;
  select * into a from public.marketing_assets where id=asset_id::uuid for update;
  if a.id is null or a.state<>'ready' or (a.storage_policy='temporary' and a.snapshot_verified_at is null) then raise exception 'Select available, verified media before saving.';end if;
 end loop;return new;
end;$$;
revoke all on function marketing_private.pin_media_reference() from public,anon,authenticated;
create trigger marketing_pin_content_media before insert on public.marketing_content_revisions for each row execute function marketing_private.pin_media_reference();
create trigger marketing_pin_campaign_media before insert on public.marketing_campaign_revisions for each row execute function marketing_private.pin_media_reference();
create trigger marketing_pin_ads_media before insert on marketing_private.ads_changes for each row execute function marketing_private.pin_media_reference();
-- All active references, failures and uncertain operations prevent cleanup. Legacy assets are excluded.
create function public.marketing_media_cleanup_claim() returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.marketing_assets;
begin
 for a in select * from public.marketing_assets where storage_policy='temporary' and
 (state='ready' or (state='retiring' and cleanup_started_at<now()-interval '10 minutes')) order by created_at for update skip locked loop
  if exists(select 1 from public.marketing_content c join public.marketing_content_revisions r on r.content_id=c.id and r.revision=c.revision where r.payload::text like '%'||a.id::text||'%' and c.status<>'published') then continue;end if;
  if exists(select 1 from public.marketing_campaign_revisions r where r.payload::text like '%'||a.id::text||'%') or exists(select 1 from marketing_private.ads_changes r where r.configuration::text like '%'||a.id::text||'%') then continue;end if;
  if not exists(select 1 from public.marketing_jobs j join public.marketing_content_revisions r on r.content_id=j.content_id and r.revision=j.revision where r.payload::text like '%'||a.id::text||'%' and j.state='succeeded') then continue;end if;
  if exists(select 1 from public.marketing_jobs j join public.marketing_content_revisions r on r.content_id=j.content_id and r.revision=j.revision where r.payload::text like '%'||a.id::text||'%' and
   (j.state not in ('succeeded','cancelled') or (j.state='succeeded' and not exists(select 1 from public.marketing_social_posts s where s.connection_id=j.connection_id and s.connection_generation=j.connection_generation and s.provider_post_id=j.provider_post_id and s.channel=j.channel)))) then continue;end if;
  update public.marketing_assets set state='retiring',cleanup_lease=gen_random_uuid(),cleanup_started_at=now() where id=a.id returning * into a;
  return to_jsonb(a);
 end loop;return null;
end;$$;
create function public.marketing_media_cleanup_finish(p_asset uuid,p_lease uuid) returns void language plpgsql security definer set search_path=public as $$
declare a public.marketing_assets;
begin
 select * into a from public.marketing_assets where id=p_asset for update;
 if a.storage_policy<>'temporary' or a.state<>'retiring' or a.cleanup_lease is distinct from p_lease then raise exception 'Cleanup lease changed.';end if;
 if exists(select 1 from storage.objects where bucket_id='marketing-media' and name=a.object_path) then raise exception 'Storage deletion must be confirmed.';end if;
 update public.marketing_assets set state='retired',retired_at=now() where id=a.id;
 insert into public.marketing_events(organization_id,brand_id,action,details) values(a.organization_id,a.brand_id,'publishing_snapshot_retired',jsonb_build_object('asset_id',a.id,'sha256',a.sha256));
end;$$;
revoke all on function public.marketing_media_cleanup_claim(),public.marketing_media_cleanup_finish(uuid,uuid) from public,anon,authenticated;
grant execute on function public.marketing_media_cleanup_claim(),public.marketing_media_cleanup_finish(uuid,uuid) to service_role;

-- Unscheduled concepts are managed in List; Calendar remains dated.
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
  select s.id,s.organization_id,s.brand_id,s.connection_id,s.connection_generation,s.provider_post_id,s.channel,s.caption,s.permalink,s.published_at,s.observed_at,s.metrics,s.unavailable_metrics,s.thumbnail_url,s.media,s.media_type,s.media_product_type,
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
 ), external as (
  select 'meta:'||s.id as key,null::uuid as id,s.brand_id,b.name as brand_name,'published'::text as status,null::integer as revision,
   null::timestamptz as scheduled_at,null::text as schedule_timezone,null::jsonb as payload,null::timestamptz as planned_at,null::text as planned_timezone,
   s.published_at as actual_at,s.published_at as display_at,'meta'::text as origin,coalesce(nullif(s.caption,''),'Untitled '||initcap(s.channel)||' post') as title,
   jsonb_build_array(jsonb_build_object('channel',s.channel,'caption',s.caption,'status','published','actual_at',s.published_at,
    'connection_id',s.connection_id,'provider_account_id',s.provider_account_id,'provider_post_id',s.provider_post_id,
    'permalink',s.permalink,'metrics',s.metrics,'unavailable_metrics',s.unavailable_metrics,'observed_at',s.observed_at,'media',s.media,'media_type',s.media_type,'media_product_type',s.media_product_type,'thumbnail_url',s.thumbnail_url)) as channels
  from social s join public.brands b on b.id=s.brand_id
  where not exists(select 1 from public.marketing_jobs j where j.organization_id=p_org and j.brand_id=s.brand_id and j.channel=s.channel and j.provider_post_id=s.provider_post_id
   and j.connection_id=s.connection_id and (j.connection_generation=s.connection_generation or exists(select 1 from scoped_social old where old.connection_id=j.connection_id and old.connection_generation=j.connection_generation and old.provider_post_id=j.provider_post_id and old.provider_account_id=s.provider_account_id)))
 ), filtered as materialized (
  select x.*,to_char(x.display_at at time zone 'Asia/Kuala_Lumpur','YYYY-MM-DD') as day,
   case p_group when 'brand' then x.brand_name when 'status' then x.status when 'date' then to_char(x.display_at at time zone 'Asia/Kuala_Lumpur','YYYY-MM-DD') else '' end as group_key
  from (select * from concepts union all select * from external) x
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
end;$$;
revoke all on function public.marketing_content_management(uuid,uuid,timestamptz,timestamptz,text,text,text,text,text,integer,integer,text) from public,anon,authenticated;
grant execute on function public.marketing_content_management(uuid,uuid,timestamptz,timestamptz,text,text,text,text,text,integer,integer,text) to authenticated;
create function public.marketing_drive_asset(p_user uuid,p_asset uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.marketing_assets; actor uuid;
begin
 select id into actor from public.employees where auth_user_id=p_user;
 select * into a from public.marketing_assets where id=p_asset;
 if a.created_by is distinct from actor or a.storage_policy<>'temporary' or a.state not in ('pending','ready') or not marketing_private.actor_allowed(actor,a.organization_id,a.brand_id,'marketing_content.upload') then raise exception 'Brand upload unavailable.';end if;
 return to_jsonb(a);
end;$$;
revoke all on function public.marketing_drive_asset(uuid,uuid) from public,anon,authenticated;
grant execute on function public.marketing_drive_asset(uuid,uuid) to service_role;
