-- Explicit Google action grants preserve legacy access without changing roles or outlet scope.
create temporary table google_permission_before on commit drop as
 select r.id,r.name,r.outlet_access_type,
 exists(select 1 from public.role_permissions rp join public.permissions p on p.id=rp.permission_id where rp.role_id=r.id and p.code='crew_performance.view') as can_view,
 exists(select 1 from public.role_permissions rp join public.permissions p on p.id=rp.permission_id where rp.role_id=r.id and p.code='crew_performance.review') as can_reply
 from public.roles r;
insert into public.permissions(code,module,description,requires_restaurant_outlet_scope) values
 ('crew_google_reviews.view','Google Reviews','View Reviews for authorized outlets.',true),
 ('crew_google_reviews.sync','Google Reviews','Sync Reviews for authorized outlets.',true),
 ('crew_google_reviews.publish_reply','Google Reviews','Publish Reply for authorized outlets with explicit confirmation.',true),
 ('crew_google_reviews.edit_reply','Google Reviews','Edit Reply for authorized outlets with explicit confirmation.',true),
 ('crew_google_reviews.manage_connection','Google Reviews','Manage Connection across all outlets.',true),
 ('crew_google_reviews.manage_mapping','Google Reviews','Manage Outlet Mapping across all outlets.',true);
insert into public.role_permissions(role_id,permission_id)
 select b.id,p.id from google_permission_before b cross join public.permissions p
 where b.can_view and (p.code in ('crew_google_reviews.view','crew_google_reviews.sync')
 or b.can_reply and p.code in ('crew_google_reviews.publish_reply','crew_google_reviews.edit_reply')
 or b.can_reply and (b.outlet_access_type='all' or lower(b.name) in ('owner','admin')) and p.code in ('crew_google_reviews.manage_connection','crew_google_reviews.manage_mapping'))
 on conflict do nothing;
insert into public.audit_logs(action,module,user_name,description,metadata)
 select 'google_reviews_permissions_split','access-control','System migration','Preserve existing Google Reviews actions as explicit scoped grants',
 jsonb_build_object('role_id',b.id,'prior_performance_view',b.can_view,'prior_performance_review',b.can_reply,'outlet_access_type',b.outlet_access_type,'google_grants',(select jsonb_agg(p.code order by p.code) from public.role_permissions rp join public.permissions p on p.id=rp.permission_id where rp.role_id=b.id and p.code like 'crew_google_reviews.%'))
 from google_permission_before b where b.can_view;

create function google_business_private.permitted(p_user uuid,p_outlet uuid,p_permission text) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare old_sub text:=current_setting('request.jwt.claim.sub',true);old_claims text:=current_setting('request.jwt.claims',true);ok boolean;
begin
 if p_user is null or not exists(select 1 from public.employees where auth_user_id=p_user and role_id is not null) then return false;end if;
 perform set_config('request.jwt.claim.sub',p_user::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_user,'role','authenticated')::text,true);
 ok:=public.current_user_has_permission('crew_google_reviews.view') and public.current_user_has_permission('crew_google_reviews.'||p_permission)
 and public.current_user_can_access_outlet(p_outlet) and exists(select 1 from public.outlets where id=p_outlet and is_active)
 and (p_permission not in ('manage_connection','manage_mapping') or public.current_user_has_all_outlet_access());
 perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);perform set_config('request.jwt.claims',coalesce(old_claims,''),true);return coalesce(ok,false);
exception when others then
 perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);perform set_config('request.jwt.claims',coalesce(old_claims,''),true);raise;
end;$$;
revoke all on function google_business_private.permitted(uuid,uuid,text) from public,anon,authenticated,service_role;

-- Metadata only. Review content retains its existing independent 24-hour expiry.
create table google_business_private.sync_health (
 location_resource_name text primary key references public.crew_google_business_locations(resource_name) on delete cascade,
 generation integer not null,mapping_revision uuid not null,last_started_at timestamptz,last_success_at timestamptz,
 last_failure_at timestamptz,error_code text,error_service text,error_request text
);
alter table google_business_private.sync_health enable row level security;
revoke all on google_business_private.sync_health from public,anon,authenticated,service_role;
create table google_business_private.sync_worker (
 id boolean primary key default true check(id),run_id uuid,proof_hash text,lease_until timestamptz,claimed_at timestamptz,
 last_started_at timestamptz,last_finished_at timestamptz,last_error text,request_id bigint,cooldown_until timestamptz
);
insert into google_business_private.sync_worker(id) values(true);
alter table google_business_private.sync_worker enable row level security;
revoke all on google_business_private.sync_worker from public,anon,authenticated,service_role;

create function google_business_private.worker_valid(p_run uuid,p_proof text,p_outlet uuid default null) returns boolean
language sql security definer set search_path=public,pg_temp as $$
 select exists(select 1 from google_business_private.sync_worker w where id=true and run_id=p_run and proof_hash=p_proof and lease_until>now() and claimed_at is not null)
 and (p_outlet is null or exists(select 1 from public.crew_google_outlet_locations m join public.outlets o on o.id=m.outlet_id where o.id=p_outlet and o.is_active));
$$;
revoke all on function google_business_private.worker_valid(uuid,text,uuid) from public,anon,authenticated,service_role;
create function public.crew_google_business_sync_worker(p_action text,p_run uuid,p_proof text,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare w google_business_private.sync_worker;
begin
 select * into w from google_business_private.sync_worker where id=true for update;
 if not coalesce(w.run_id=p_run and w.proof_hash=p_proof and w.lease_until>now(),false) then raise exception using errcode='42501',message='Scheduled sync authorization expired.';end if;
 if p_action='claim' then
  if w.claimed_at is not null then return jsonb_build_object('claimed',false);end if;
  update google_business_private.sync_worker set claimed_at=now() where id=true;
  return jsonb_build_object('claimed',true,'outlets',(select coalesce(jsonb_agg(x.outlet_id),'[]') from (
   select m.outlet_id from public.crew_google_outlet_locations m join public.outlets o on o.id=m.outlet_id
   left join google_business_private.sync_health h on h.location_resource_name=m.location_resource_name
   where o.is_active and (select status='connected' from google_business_private.connection where id=true)
   order by h.last_success_at nulls first,m.outlet_id limit 32)x));
 elsif p_action='finish' and w.claimed_at is not null then
  update google_business_private.sync_worker set lease_until=null,proof_hash=null,last_finished_at=now(),last_error=nullif(p_data->>'error','') where id=true;
  return jsonb_build_object('ok',true);
 end if;
 raise exception 'Scheduled sync action unavailable.';
end;$$;
revoke all on function public.crew_google_business_sync_worker(text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.crew_google_business_sync_worker(text,uuid,text,jsonb) to service_role;

-- Staging-only dispatch, matching the established Cron -> pg_net -> Edge infrastructure.
-- Each invocation has a short-lived opaque capability; no permanent worker credential is added.
create function google_business_private.sync_tick() returns bigint language plpgsql security definer set search_path=public,pg_temp as $$
declare w google_business_private.sync_worker;t text;r uuid:=gen_random_uuid();request bigint;
begin
 select * into w from google_business_private.sync_worker where id=true for update;
 if w.lease_until>now() or w.cooldown_until>now() or not exists(select 1 from google_business_private.connection where id=true and status='connected' and sealed_token is not null)
 or not exists(select 1 from public.crew_google_outlet_locations m join public.outlets o on o.id=m.outlet_id where o.is_active) then return null;end if;
 t:=gen_random_uuid()::text||gen_random_uuid()::text;
 update google_business_private.sync_worker set run_id=r,proof_hash=encode(extensions.digest(t,'sha256'),'hex'),lease_until=now()+interval '4 minutes',claimed_at=null,last_started_at=now(),last_error=case when w.lease_until<=now() and w.last_finished_at is distinct from w.last_started_at then 'previous_run_expired' end where id=true;
 request:=net.http_post(url:='https://ujkzdaaadnvcfayuldmh.supabase.co/functions/v1/google-business/scheduled-sync',
  headers:=jsonb_build_object('Content-Type','application/json','x-google-sync-token',t),body:=jsonb_build_object('runId',r),timeout_milliseconds:=120000);
 update google_business_private.sync_worker set request_id=request where id=true;return request;
end;$$;
revoke all on function google_business_private.sync_tick() from public,anon,authenticated,service_role;
select cron.schedule('crew-google-business-review-sync','*/30 * * * *','select google_business_private.sync_tick();');


do $guard$ begin if md5(pg_get_functiondef('google_business_private.allowed(uuid,uuid,boolean)'::regprocedure))<>'7c355b2b6fb3cd78b92e85ad4d6b3321' then raise exception 'Google authority drift: google_business_private.allowed(uuid,uuid,boolean)';end if;end $guard$;

CREATE OR REPLACE FUNCTION google_business_private.allowed(p_user uuid, p_outlet uuid, p_manage boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin return google_business_private.permitted(p_user,p_outlet,case when p_manage then 'manage_connection' else 'view' end);end;
$function$;

do $guard$ begin if md5(pg_get_functiondef('google_business_private.reply_allowed(uuid,uuid)'::regprocedure))<>'c73f5037c6afd3332cbb508cf77e6910' then raise exception 'Google authority drift: google_business_private.reply_allowed(uuid,uuid)';end if;end $guard$;

CREATE OR REPLACE FUNCTION google_business_private.reply_allowed(p_user uuid, p_outlet uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin return google_business_private.permitted(p_user,p_outlet,'publish_reply') or google_business_private.permitted(p_user,p_outlet,'edit_reply');end;
$function$;

do $guard$ begin if md5(pg_get_functiondef('crew_google_business_server(text,uuid,uuid,jsonb)'::regprocedure))<>'eaa6e6e34e1f3c4a73cbe206cdc61acd' then raise exception 'Google authority drift: crew_google_business_server(text,uuid,uuid,jsonb)';end if;end $guard$;

CREATE OR REPLACE FUNCTION public.crew_google_business_server(p_action text, p_user uuid, p_outlet uuid, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare c google_business_private.connection; o google_business_private.oauth; m public.crew_google_outlet_locations;
 cache google_business_private.inbox_cache; manage boolean; loc jsonb; result jsonb; g integer; lease_id uuid; worker boolean:=false;
begin
 if p_action in ('oauth_consume','oauth_finish') then
  select * into o from google_business_private.oauth where state_hash=p_data->>'state_hash' for update;
  if not found or o.expires_at<=now() or (p_action='oauth_consume' and o.consumed_at is not null)
   or (p_action='oauth_finish' and o.consumed_at is null) then raise exception 'Authorization expired. Connect again.';end if;
  p_user:=o.actor;p_outlet:=o.outlet_id;
 end if;
 worker:=p_user is null and p_action in ('material','guard','inbox','refresh','expired','sync_begin','sync_finish','sync_error') and google_business_private.worker_valid((p_data->>'worker_run')::uuid,p_data->>'worker_proof',p_outlet);
 if not worker and not google_business_private.allowed(p_user,p_outlet) then raise exception using errcode='42501',message='Google Reviews is unavailable for this outlet.';end if;
 manage:=google_business_private.allowed(p_user,p_outlet,true);
 if p_action in ('begin','oauth_consume','oauth_finish','discover','disconnect_begin','disconnect_finish') and not manage then
  raise exception using errcode='42501',message='All-outlet Performance review permission is required to manage the Google connection and mappings.';
 end if;
 if p_action='map' and not google_business_private.permitted(p_user,p_outlet,'manage_mapping') then raise exception using errcode='42501',message='All-outlet mapping administration permission is required.';end if;
 if p_action in ('sync_begin','sync_finish','sync_error') and not worker and not google_business_private.permitted(p_user,p_outlet,'sync') then raise exception using errcode='42501',message='Sync Reviews permission is required.';end if;
 select * into c from google_business_private.connection where id=true for update;
 select * into m from public.crew_google_outlet_locations where outlet_id=p_outlet;
 select * into cache from google_business_private.inbox_cache where location_resource_name=m.location_resource_name;
 if p_action='context' then
  return jsonb_build_object('api_status','available','connection_status',c.status,'generation',c.generation,'can_manage',manage,'can_manage_connection',manage,'can_manage_mapping',google_business_private.permitted(p_user,p_outlet,'manage_mapping'),'can_sync',google_business_private.permitted(p_user,p_outlet,'sync'),
   'automatic_sync',c.status='connected' and m.outlet_id is not null and exists(select 1 from cron.job where jobname='crew-google-business-review-sync' and active),'scheduler_error',(select case when lease_until<=now() then 'scheduled_run_expired' when last_error='scheduled_sync_failed' then last_error end from google_business_private.sync_worker where id=true),'sync_health',(select to_jsonb(h)-'location_resource_name' from google_business_private.sync_health h where h.location_resource_name=m.location_resource_name and h.generation=c.generation and h.mapping_revision=m.revision),
   'accounts',case when (manage or google_business_private.permitted(p_user,p_outlet,'manage_mapping')) and c.status='connected' and c.discovered_at>now()-interval '30 days' then c.accounts else '[]'::jsonb end,
   'locations',case when (manage or google_business_private.permitted(p_user,p_outlet,'manage_mapping')) and c.status='connected' then (select coalesce(jsonb_agg(jsonb_build_object('name',resource_name,'title',display_name,'account',account_resource_name) order by display_name),'[]') from public.crew_google_business_locations where verified_at>now()-interval '30 days') else '[]'::jsonb end,
   'mapping',case when m.outlet_id is not null then jsonb_build_object('name',m.location_resource_name,'revision',m.revision,'title',(select display_name from public.crew_google_business_locations where resource_name=m.location_resource_name)) else null end,
   'sync_status',case when cache.status='running' and cache.lease_until>now() then 'running' when cache.status='error' then 'error' when cache.expires_at>now() and cache.generation=c.generation and cache.mapping_revision=m.revision then 'complete' else 'awaiting_sync' end,
   'fetched_at',cache.fetched_at,'cache_expires_at',cache.expires_at,'sync_error',cache.error_code,'scoring_enabled',false);
 elsif p_action='begin' then
  if c.status='revocation_pending' then raise exception 'Finish disconnecting before reconnecting.';end if;
  delete from google_business_private.oauth where expires_at<now();
  insert into google_business_private.oauth(state_hash,actor,generation,sealed_verifier,outlet_id)
   values(p_data->>'state_hash',p_user,c.generation,p_data->'sealed_verifier',p_outlet);
  return jsonb_build_object('generation',c.generation);
 elsif p_action='oauth_consume' then
  if c.generation<>o.generation or c.status='revocation_pending' then raise exception 'Connection changed. Connect again.';end if;
  update google_business_private.oauth set consumed_at=now() where state_hash=o.state_hash;
  return to_jsonb(o);
 elsif p_action='oauth_finish' then
  if c.generation<>o.generation or c.status='revocation_pending' then raise exception 'Connection changed. Connect again.';end if;
  if jsonb_typeof(p_data->'accounts')<>'array' or jsonb_typeof(p_data->'locations')<>'array' or p_data->'sealed_token' is null
   or (p_data->>'expires_at')::timestamptz<=now() then raise exception 'Verified offline Google authorization is required.';end if;
  g:=c.generation+1;
  update google_business_private.connection set generation=g,status='connected',sealed_token=p_data->'sealed_token',expires_at=(p_data->>'expires_at')::timestamptz,
   accounts=p_data->'accounts',connected_by=p_user,discovered_at=now(),updated_at=now() where id=true;
  delete from google_business_private.inbox_cache where generation<=c.generation;
  delete from public.crew_google_outlet_locations where location_resource_name not in (select value->>'name' from jsonb_array_elements(p_data->'locations'));
  delete from public.crew_google_business_locations where resource_name not in (select value->>'name' from jsonb_array_elements(p_data->'locations'));
  for loc in select value from jsonb_array_elements(p_data->'locations') loop
   if loc->>'name' !~ '^accounts/[A-Za-z0-9_-]+/locations/[A-Za-z0-9_-]+$' or not exists(select 1 from jsonb_array_elements(p_data->'accounts') a where a->>'name'=loc->>'account') then raise exception 'Invalid discovered location.';end if;
   insert into public.crew_google_business_locations(resource_name,account_resource_name,display_name) values(loc->>'name',loc->>'account',loc->>'title')
    on conflict(resource_name) do update set account_resource_name=excluded.account_resource_name,display_name=excluded.display_name,verified_at=now();
  end loop;
  update public.crew_google_outlet_locations set revision=gen_random_uuid() where location_resource_name in (select value->>'name' from jsonb_array_elements(p_data->'locations'));
  insert into public.crew_google_business_connections(id,status,updated_at) values(true,'connected',now()) on conflict(id) do update set status='connected',account_resource_name=null,updated_at=now();
  delete from google_business_private.oauth where state_hash=o.state_hash;
 elsif p_action='discover' then
  if c.status<>'connected' or c.generation is distinct from (p_data->>'generation')::integer
   or jsonb_typeof(p_data->'accounts')<>'array' or jsonb_typeof(p_data->'locations')<>'array' then raise exception 'Connection changed. Reconnect Google.';end if;
  delete from google_business_private.inbox_cache where location_resource_name not in (select value->>'name' from jsonb_array_elements(p_data->'locations'));
  delete from public.crew_google_outlet_locations where location_resource_name not in (select value->>'name' from jsonb_array_elements(p_data->'locations'));
  delete from public.crew_google_business_locations where resource_name not in (select value->>'name' from jsonb_array_elements(p_data->'locations'));
  for loc in select value from jsonb_array_elements(p_data->'locations') loop
   if loc->>'name' !~ '^accounts/[A-Za-z0-9_-]+/locations/[A-Za-z0-9_-]+$' or not exists(select 1 from jsonb_array_elements(p_data->'accounts') a where a->>'name'=loc->>'account') then raise exception 'Invalid discovered location.';end if;
   insert into public.crew_google_business_locations(resource_name,account_resource_name,display_name) values(loc->>'name',loc->>'account',loc->>'title')
    on conflict(resource_name) do update set account_resource_name=excluded.account_resource_name,display_name=excluded.display_name,verified_at=now();
  end loop;
  update google_business_private.connection set accounts=p_data->'accounts',discovered_at=now() where id=true;
 elsif p_action in ('material','guard','inbox') then
  if c.status<>'connected' or c.sealed_token is null then raise exception 'Connect or reconnect Google Business Profile in Settings.';end if;
  if p_action='guard' and (c.generation is distinct from (p_data->>'generation')::integer or m.revision::text is distinct from p_data->>'revision') then raise exception 'Google connection or outlet mapping changed. Refresh the inbox.';end if;
  if p_action='material' then return to_jsonb(c)||jsonb_build_object('mapping',to_jsonb(m));end if;
  if p_action='inbox' then
   return jsonb_build_object('generation',c.generation,'mapping',to_jsonb(m),'cache',case when cache.expires_at>now() and cache.generation=c.generation and cache.mapping_revision=m.revision then to_jsonb(cache) else null end);
  end if;
  return jsonb_build_object('ok',true);
 elsif p_action='refresh' then
  if c.status<>'connected' or c.generation is distinct from (p_data->>'generation')::integer or c.sealed_token is distinct from p_data->'expected_token' then return jsonb_build_object('updated',false);end if;
  update google_business_private.connection set sealed_token=p_data->'sealed_token',expires_at=(p_data->>'expires_at')::timestamptz,updated_at=now() where id=true;
  return jsonb_build_object('updated',true);
 elsif p_action='expired' then
  update google_business_private.connection set status='expired',updated_at=now() where id=true and generation=(p_data->>'generation')::integer and sealed_token=p_data->'expected_token' and status='connected';
 elsif p_action='disconnect_begin' then
  if c.status='disconnected' then return jsonb_build_object('disconnected',true);end if;
  if c.status<>'revocation_pending' then update google_business_private.connection set status='revocation_pending',generation=generation+1,updated_at=now() where id=true;end if;
  delete from google_business_private.inbox_cache where generation<=c.generation;delete from google_business_private.oauth where generation<=c.generation;
  insert into google_business_private.events(action,actor,outlet_id,details) values('disconnect_begin',p_user,p_outlet,jsonb_build_object('generation',c.generation));
  return jsonb_build_object('sealed_token',c.sealed_token,'token_generation',case when c.status='revocation_pending' then c.generation-1 else c.generation end,'generation',case when c.status='revocation_pending' then c.generation else c.generation+1 end);
 elsif p_action='disconnect_finish' then
  if c.status<>'revocation_pending' or c.generation is distinct from (p_data->>'generation')::integer then raise exception 'Connection changed.';end if;
  update google_business_private.connection set status='disconnected',sealed_token=null,expires_at=null,accounts='[]',connected_by=null,updated_at=now() where id=true;
  update public.crew_google_business_connections set status='not_connected',account_resource_name=null,last_synced_at=null,updated_at=now() where id=true;
 elsif p_action='map' then
  if c.status<>'connected' or c.generation is distinct from (p_data->>'generation')::integer or m.revision::text is distinct from p_data->>'expected_revision' then raise exception 'Mapping changed. Refresh Settings.';end if;
  if p_data->>'location' is null then
   delete from google_business_private.inbox_cache where location_resource_name=m.location_resource_name;
   delete from public.crew_google_outlet_locations where outlet_id=p_outlet;
  else
   if not exists(select 1 from public.crew_google_business_locations where resource_name=p_data->>'location' and verified_at>now()-interval '30 days') then raise exception 'Select an authorized discovered Google location. Refresh Locations if discovery has expired.';end if;
   if exists(select 1 from public.crew_google_outlet_locations where location_resource_name=p_data->>'location' and outlet_id<>p_outlet) then raise exception 'This Google location is already mapped to another outlet.';end if;
   delete from google_business_private.inbox_cache where location_resource_name=m.location_resource_name or location_resource_name=p_data->>'location';
   insert into public.crew_google_outlet_locations(outlet_id,location_resource_name,mapped_by) values(p_outlet,p_data->>'location',p_user)
    on conflict(outlet_id) do update set location_resource_name=excluded.location_resource_name,mapped_by=p_user,mapped_at=now(),revision=gen_random_uuid();
  end if;
 elsif p_action='sync_begin' then
  if c.status<>'connected' or m.outlet_id is null or c.generation is distinct from (p_data->>'generation')::integer or m.revision::text is distinct from p_data->>'revision' then raise exception 'Connection or mapping changed. Refresh the inbox.';end if;
  if cache.status='running' and cache.lease_until>now() then raise exception 'A review sync is already running. Refresh shortly.';end if;
  if exists(select 1 from google_business_private.sync_worker where id=true and cooldown_until>now()) then raise exception 'Google rate limit cooldown is active. Try after the next automatic sync interval.';end if;
  lease_id:=gen_random_uuid();
  insert into google_business_private.inbox_cache(location_resource_name,generation,mapping_revision,status,lease,lease_until)
   values(m.location_resource_name,c.generation,m.revision,'running',lease_id,now()+interval '3 minutes')
   on conflict(location_resource_name) do update set generation=excluded.generation,mapping_revision=excluded.mapping_revision,status='running',lease=lease_id,lease_until=excluded.lease_until,error_code=null;
  insert into google_business_private.sync_health(location_resource_name,generation,mapping_revision,last_started_at) values(m.location_resource_name,c.generation,m.revision,now()) on conflict(location_resource_name) do update set generation=excluded.generation,mapping_revision=excluded.mapping_revision,last_started_at=now(),last_success_at=case when sync_health.generation=excluded.generation and sync_health.mapping_revision=excluded.mapping_revision then sync_health.last_success_at end,error_code=null,error_service=null,error_request=null;
  return jsonb_build_object('lease',lease_id);
 elsif p_action in ('sync_finish','sync_error') then
  if c.status<>'connected' or c.generation is distinct from (p_data->>'generation')::integer or m.revision::text is distinct from p_data->>'revision'
   or cache.lease::text is distinct from p_data->>'lease' or cache.status<>'running' or cache.lease_until<=now() then raise exception 'Sync authority changed. Refresh the inbox.';end if;
  if p_action='sync_finish' then
   if p_data->'sealed_reviews' is null then raise exception 'Complete verified review page walk required.';end if;
   update google_business_private.inbox_cache set sealed_reviews=p_data->'sealed_reviews',status='complete',fetched_at=now(),expires_at=now()+interval '24 hours',lease=null,lease_until=null,error_code=null where location_resource_name=m.location_resource_name;
   update google_business_private.sync_health set last_success_at=now(),error_code=null,error_service=null,error_request=null where location_resource_name=m.location_resource_name;
   update public.crew_google_business_connections set last_synced_at=now() where id=true;
  else
   update google_business_private.inbox_cache set status='error',lease=null,lease_until=null,error_code=coalesce(p_data->>'error_code','google_sync_failed') where location_resource_name=m.location_resource_name;
   update google_business_private.sync_health set last_failure_at=now(),error_code=coalesce(p_data->>'error_code','google_sync_failed'),error_service=left(p_data->>'error_service',120),error_request=left(p_data->>'error_request',300) where location_resource_name=m.location_resource_name;
   if p_data->>'error_code'='google_rate_limited' then update google_business_private.sync_worker set cooldown_until=now()+interval '30 minutes' where id=true;end if;
  end if;
 else raise exception 'Unsupported Google Business Profile action.';end if;
 insert into google_business_private.events(action,actor,outlet_id,details) values(p_action,p_user,p_outlet,jsonb_build_object('generation',c.generation)||case when p_action='map' then jsonb_build_object('previous_location',m.location_resource_name,'location',p_data->>'location') else '{}'::jsonb end);
 return jsonb_build_object('ok',true);
end;$function$;

do $guard$ begin if md5(pg_get_functiondef('crew_google_business_reply_server(text,uuid,uuid,jsonb)'::regprocedure))<>'d63535cfd8086014f0709ec8a906e4ce' then raise exception 'Google authority drift: crew_google_business_reply_server(text,uuid,uuid,jsonb)';end if;end $guard$;

CREATE OR REPLACE FUNCTION public.crew_google_business_reply_server(p_action text, p_user uuid, p_outlet uuid, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare r google_business_private.reply_requests;c google_business_private.connection;m public.crew_google_outlet_locations;
 review text:=p_data->>'review';request_id uuid;attempt uuid;can_reply boolean;history jsonb;
begin
 if p_action='finish' then
  select * into r from google_business_private.reply_requests where id=(p_data->>'id')::uuid for update;
  if not found or r.outlet_id is distinct from p_outlet or r.lease_actor is distinct from p_user then raise exception 'Reply attempt unavailable.';end if;
  if r.status='confirmed' then return jsonb_build_object('status','confirmed','id',r.id);end if;
  if r.status<>'sending' or r.lease is distinct from (p_data->>'lease')::uuid then raise exception 'Reply attempt changed. Check status.';end if;
  if p_data->>'status' not in ('confirmed','rejected','uncertain','conflict') then raise exception 'Invalid reply outcome.';end if;
  if p_data->>'status'='confirmed' and (p_data->'sealed_remote' is null or p_data->>'remote_hash' is null or p_data->>'remote_time' is null) then raise exception 'Verified Google reply evidence is required.';end if;
  update google_business_private.reply_requests set status=p_data->>'status',operation=coalesce(p_data->>'operation',r.operation),outcome_code=p_data->>'code',
   sealed_remote=p_data->'sealed_remote',remote_time=(p_data->>'remote_time')::timestamptz,content_expires_at=now()+interval '24 hours',lease=null,lease_until=null,updated_at=now() where id=r.id;
  if p_data->>'status'='confirmed' then
   -- Patch only the exact complete snapshot; preserve its rating evidence and expiry.
   update google_business_private.inbox_cache set sealed_reviews=p_data->'sealed_projection'
    where location_resource_name=split_part(r.review_name,'/reviews/',1) and status='complete' and expires_at>now()
     and generation=r.generation and mapping_revision=r.mapping_revision and sealed_reviews=p_data->'expected_cache' and p_data->'sealed_projection' is not null;
   if not found then
    -- Invalidate concurrent sync leases too; they cannot restore pre-reply evidence.
    delete from google_business_private.inbox_cache where location_resource_name=split_part(r.review_name,'/reviews/',1);
   end if;
  end if;
  insert into google_business_private.events(action,actor,outlet_id,details) values('reply_outcome',p_user,p_outlet,
   jsonb_build_object('request_id',r.id,'review',r.review_name,'operation',coalesce(p_data->>'operation',r.operation),'status',p_data->>'status','code',p_data->>'code','remote_hash',p_data->>'remote_hash','remote_time',p_data->>'remote_time','moderation',p_data->>'moderation'));
  return jsonb_build_object('id',r.id,'status',p_data->>'status');
 end if;
 if not google_business_private.allowed(p_user,p_outlet) then raise exception using errcode='42501',message='Google Reviews is unavailable for this outlet.';end if;
 can_reply:=google_business_private.reply_allowed(p_user,p_outlet);
 if p_action in ('prepare','claim') and not can_reply then raise exception using errcode='42501',message='Reply management permission is required for this outlet.';end if;
 select * into c from google_business_private.connection where id=true for update;
 select * into m from public.crew_google_outlet_locations where outlet_id=p_outlet;
 if p_action in ('status','claim','check') then
  select * into r from google_business_private.reply_requests where id=(p_data->>'id')::uuid and outlet_id=p_outlet for update;
  if not found then raise exception 'Reply request unavailable.';end if;
  review:=r.review_name;
 end if;
 if p_action='status' then
  return jsonb_build_object('id',r.id,'status',r.status,'code',r.outcome_code,'review',r.review_name,'generation',r.generation,'mapping_revision',r.mapping_revision,
   'sealed_remote',case when r.content_expires_at>now() and m.location_resource_name=split_part(r.review_name,'/reviews/',1) then r.sealed_remote end);
 end if;
 if m.outlet_id is null or review !~ '^accounts/[A-Za-z0-9_-]+/locations/[A-Za-z0-9_-]+/reviews/[A-Za-z0-9_-]+$'
  or split_part(review,'/reviews/',1) is distinct from m.location_resource_name then raise exception 'Review does not belong to this outlet mapping.';end if;
 if p_action in ('access','history') then
  select coalesce(jsonb_agg(jsonb_build_object('request_id',x.id,'operation',x.operation,'status',x.status,'code',x.outcome_code,'actor',coalesce(e.full_name,'Admin'),'created_at',x.created_at,'updated_at',x.updated_at) order by x.created_at desc),'[]') into history
  from (select * from google_business_private.reply_requests where outlet_id=p_outlet and review_name=review order by created_at desc limit 20) x left join public.employees e on e.auth_user_id=x.actor;
  return jsonb_build_object('can_reply',can_reply,'can_publish_reply',google_business_private.permitted(p_user,p_outlet,'publish_reply'),'can_edit_reply',google_business_private.permitted(p_user,p_outlet,'edit_reply'),'generation',c.generation,'revision',m.revision,'history',history);
 end if;
 if c.status<>'connected' then raise exception 'Reconnect Google Business Profile before managing replies.';end if;
 if p_action='prepare' then
  if c.generation is distinct from (p_data->>'generation')::integer or m.revision is distinct from (p_data->>'revision')::uuid then raise exception 'Connection or mapping changed. Reload Review Detail.';end if;
  if p_data->>'confirmed' is distinct from 'true' or p_data->'sealed_intent' is null or p_data->>'operation' not in ('publish','update')
   or coalesce(p_data->>'payload_hash','') !~ '^[a-f0-9]{64}$' or coalesce(p_data->>'desired_hash','') !~ '^[a-f0-9]{64}$' then raise exception 'Confirm a complete reply intent.';end if;
  if not google_business_private.permitted(p_user,p_outlet,case when p_data->>'operation'='update' then 'edit_reply' else 'publish_reply' end) then raise exception using errcode='42501',message='This reply action is not permitted.';end if;
  request_id:=(p_data->>'id')::uuid;
  insert into google_business_private.reply_requests(id,actor,outlet_id,review_name,generation,mapping_revision,payload_hash,desired_hash,operation,sealed_intent)
   values(request_id,p_user,p_outlet,review,c.generation,m.revision,p_data->>'payload_hash',p_data->>'desired_hash',p_data->>'operation',p_data->'sealed_intent') on conflict(id) do nothing;
  select * into r from google_business_private.reply_requests where id=request_id for update;
  if r.actor is distinct from p_user or r.outlet_id is distinct from p_outlet or r.review_name is distinct from review or r.payload_hash is distinct from p_data->>'payload_hash' then raise exception 'Reply request ID was already used for a different intent.';end if;
  return jsonb_build_object('id',r.id,'status',r.status);
 elsif p_action in ('claim','check') then
  if p_action='claim' and not google_business_private.permitted(p_user,p_outlet,case when r.operation='update' then 'edit_reply' else 'publish_reply' end) then raise exception using errcode='42501',message='This reply action is not permitted.';end if;
  if p_action='claim' and r.actor is distinct from p_user then raise exception 'Only the confirming Admin can retry this reply.';end if;
  if r.status in ('confirmed','conflict') then return jsonb_build_object('claimed',false,'id',r.id,'status',r.status,'code',r.outcome_code);end if;
  if r.status='sending' and r.lease_until>now() then return jsonb_build_object('claimed',false,'id',r.id,'status','sending','code','reply_busy');end if;
  if c.generation<>r.generation or m.revision<>r.mapping_revision then
   if p_action='claim' then raise exception 'Reply authority changed. Check status, then reload Review Detail.';end if;
  end if;
  -- Serialize different intent IDs for one review; an uncertain outcome must be reconciled first.
  perform pg_advisory_xact_lock(hashtextextended(review,619));
  if exists(select 1 from google_business_private.reply_requests where review_name=review and id<>r.id and status in ('sending','uncertain')) then raise exception 'Another reply update is unresolved. Check its status in Reply History.';end if;
  attempt:=gen_random_uuid();
  update google_business_private.reply_requests set status='sending',lease=attempt,lease_actor=p_user,lease_until=now()+interval '2 minutes',updated_at=now() where id=r.id;
  insert into google_business_private.events(action,actor,outlet_id,details) values('reply_attempt',p_user,p_outlet,jsonb_build_object('request_id',r.id,'review',review,'operation',r.operation,'reconcile_only',p_action='check'));
  return to_jsonb(r)||jsonb_build_object('claimed',true,'lease',attempt,'read_only',p_action='check' or r.content_expires_at<=now() or r.sealed_intent is null);
 end if;
 raise exception 'Unsupported Google reply action.';
end;$function$;

do $guard$ begin if md5(pg_get_functiondef('crew_google_business_reply_guard(uuid,uuid,uuid,uuid)'::regprocedure))<>'4793e95e7316a5e007a60f753f80b751' then raise exception 'Google authority drift: crew_google_business_reply_guard(uuid,uuid,uuid,uuid)';end if;end $guard$;

CREATE OR REPLACE FUNCTION public.crew_google_business_reply_guard(p_user uuid, p_outlet uuid, p_id uuid, p_lease uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare c google_business_private.connection;m public.crew_google_outlet_locations;r google_business_private.reply_requests;
begin
 if not google_business_private.reply_allowed(p_user,p_outlet) then raise exception using errcode='42501',message='Reply permission changed. Reload Review Detail.';end if;
 select * into c from google_business_private.connection where id=true for update;
 select * into m from public.crew_google_outlet_locations where outlet_id=p_outlet;
 select * into r from google_business_private.reply_requests where id=p_id for update;
 if not found or r.outlet_id is distinct from p_outlet or r.lease_actor is distinct from p_user or r.actor is distinct from p_user
  or r.status<>'sending' or r.lease is distinct from p_lease or r.lease_until<=now() or c.status<>'connected'
  or r.generation<>c.generation or r.mapping_revision is distinct from m.revision
  or split_part(r.review_name,'/reviews/',1) is distinct from m.location_resource_name then raise exception 'Reply authority changed. Check status before retrying.';end if;
 if not google_business_private.permitted(p_user,p_outlet,case when r.operation='update' then 'edit_reply' else 'publish_reply' end) then raise exception using errcode='42501',message='Reply action permission changed.';end if;
 return jsonb_build_object('ok',true);
end;$function$;
