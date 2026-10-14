-- Phase 1 reputation reads only. Existing Performance/Customer authorities stay dormant.
create schema google_business_private;
revoke all on schema google_business_private from public, anon, authenticated;
create table google_business_private.connection (
 id boolean primary key default true check(id), generation integer not null default 0,
 status text not null default 'disconnected' check(status in ('disconnected','connected','expired','revocation_pending')),
 sealed_token jsonb, expires_at timestamptz, accounts jsonb not null default '[]',
 connected_by uuid references auth.users(id), discovered_at timestamptz, updated_at timestamptz not null default now()
);
insert into google_business_private.connection(id) values(true);
create table google_business_private.oauth (
 state_hash text primary key check(state_hash ~ '^[a-f0-9]{64}$'), actor uuid not null references auth.users(id),
 generation integer not null, sealed_verifier jsonb not null, outlet_id uuid not null references public.outlets(id),
 expires_at timestamptz not null default now()+interval '10 minutes', consumed_at timestamptz
);
create table google_business_private.inbox_cache (
 location_resource_name text primary key references public.crew_google_business_locations(resource_name),
 generation integer not null, mapping_revision uuid not null, sealed_reviews jsonb,
 fetched_at timestamptz, expires_at timestamptz, status text not null default 'awaiting_sync' check(status in ('awaiting_sync','running','complete','error')),
 lease uuid, lease_until timestamptz, error_code text
);
create table google_business_private.events (
 id bigint generated always as identity primary key, action text not null, actor uuid references auth.users(id),
 outlet_id uuid references public.outlets(id), created_at timestamptz not null default now(), details jsonb not null default '{}'
);
alter table public.crew_google_outlet_locations add column revision uuid not null default gen_random_uuid();
alter table google_business_private.connection enable row level security;
alter table google_business_private.oauth enable row level security;
alter table google_business_private.inbox_cache enable row level security;
alter table google_business_private.events enable row level security;
revoke all on all tables in schema google_business_private from public, anon, authenticated;

-- Service-only caller supplies the Auth identity verified by getUser. Reuse canonical
-- permission/outlet helpers, including their role aliases, rather than a second access model.
create function google_business_private.allowed(p_user uuid,p_outlet uuid,p_manage boolean default false)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare old_sub text:=current_setting('request.jwt.claim.sub',true); old_claims text:=current_setting('request.jwt.claims',true); ok boolean;
begin
 if p_user is null or not exists(select 1 from public.employees where auth_user_id=p_user and role_id is not null) then return false;end if;
 perform set_config('request.jwt.claim.sub',p_user::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_user,'role','authenticated')::text,true);
 ok:=public.current_user_has_permission('crew_performance.view')
  and public.current_user_can_access_outlet(p_outlet)
  and exists(select 1 from public.outlets where id=p_outlet and is_active)
  and (not p_manage or public.current_user_has_permission('crew_performance.review') and public.current_user_has_all_outlet_access());
 perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);
 perform set_config('request.jwt.claims',coalesce(old_claims,''),true);
 return coalesce(ok,false);
exception when others then
 perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);
 perform set_config('request.jwt.claims',coalesce(old_claims,''),true);raise;
end;$$;
revoke all on function google_business_private.allowed(uuid,uuid,boolean) from public,anon,authenticated;

create function public.crew_google_business_server(p_action text,p_user uuid,p_outlet uuid,p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c google_business_private.connection; o google_business_private.oauth; m public.crew_google_outlet_locations;
 cache google_business_private.inbox_cache; manage boolean; loc jsonb; result jsonb; g integer; lease_id uuid;
begin
 if p_action in ('oauth_consume','oauth_finish') then
  select * into o from google_business_private.oauth where state_hash=p_data->>'state_hash' for update;
  if not found or o.expires_at<=now() or (p_action='oauth_consume' and o.consumed_at is not null)
   or (p_action='oauth_finish' and o.consumed_at is null) then raise exception 'Authorization expired. Connect again.';end if;
  p_user:=o.actor;p_outlet:=o.outlet_id;
 end if;
 if not google_business_private.allowed(p_user,p_outlet) then raise exception using errcode='42501',message='Google Reviews is unavailable for this outlet.';end if;
 manage:=google_business_private.allowed(p_user,p_outlet,true);
 if p_action in ('begin','oauth_consume','oauth_finish','discover','disconnect_begin','disconnect_finish','map') and not manage then
  raise exception using errcode='42501',message='All-outlet Performance review permission is required to manage the Google connection and mappings.';
 end if;
 select * into c from google_business_private.connection where id=true for update;
 select * into m from public.crew_google_outlet_locations where outlet_id=p_outlet;
 select * into cache from google_business_private.inbox_cache where location_resource_name=m.location_resource_name;
 if p_action='context' then
  return jsonb_build_object('api_status','available','connection_status',c.status,'generation',c.generation,'can_manage',manage,
   'accounts',case when manage and c.status='connected' and c.discovered_at>now()-interval '30 days' then c.accounts else '[]'::jsonb end,
   'locations',case when manage and c.status='connected' then (select coalesce(jsonb_agg(jsonb_build_object('name',resource_name,'title',display_name,'account',account_resource_name) order by display_name),'[]') from public.crew_google_business_locations where verified_at>now()-interval '30 days') else '[]'::jsonb end,
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
  delete from google_business_private.inbox_cache;
  delete from public.crew_google_outlet_locations where location_resource_name not in (select value->>'name' from jsonb_array_elements(p_data->'locations'));
  delete from public.crew_google_business_locations where resource_name not in (select value->>'name' from jsonb_array_elements(p_data->'locations'));
  for loc in select value from jsonb_array_elements(p_data->'locations') loop
   if loc->>'name' !~ '^accounts/[A-Za-z0-9_-]+/locations/[A-Za-z0-9_-]+$' or not exists(select 1 from jsonb_array_elements(p_data->'accounts') a where a->>'name'=loc->>'account') then raise exception 'Invalid discovered location.';end if;
   insert into public.crew_google_business_locations(resource_name,account_resource_name,display_name) values(loc->>'name',loc->>'account',loc->>'title')
    on conflict(resource_name) do update set account_resource_name=excluded.account_resource_name,display_name=excluded.display_name,verified_at=now();
  end loop;
  update public.crew_google_outlet_locations set revision=gen_random_uuid();
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
  delete from google_business_private.inbox_cache;delete from google_business_private.oauth;
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
  lease_id:=gen_random_uuid();
  insert into google_business_private.inbox_cache(location_resource_name,generation,mapping_revision,status,lease,lease_until)
   values(m.location_resource_name,c.generation,m.revision,'running',lease_id,now()+interval '3 minutes')
   on conflict(location_resource_name) do update set generation=excluded.generation,mapping_revision=excluded.mapping_revision,status='running',lease=lease_id,lease_until=excluded.lease_until,error_code=null;
  return jsonb_build_object('lease',lease_id);
 elsif p_action in ('sync_finish','sync_error') then
  if c.status<>'connected' or c.generation is distinct from (p_data->>'generation')::integer or m.revision::text is distinct from p_data->>'revision'
   or cache.lease::text is distinct from p_data->>'lease' or cache.status<>'running' or cache.lease_until<=now() then raise exception 'Sync authority changed. Refresh the inbox.';end if;
  if p_action='sync_finish' then
   if p_data->'sealed_reviews' is null then raise exception 'Complete verified review page walk required.';end if;
   update google_business_private.inbox_cache set sealed_reviews=p_data->'sealed_reviews',status='complete',fetched_at=now(),expires_at=now()+interval '24 hours',lease=null,lease_until=null,error_code=null where location_resource_name=m.location_resource_name;
   update public.crew_google_business_connections set last_synced_at=now() where id=true;
  else
   update google_business_private.inbox_cache set status='error',lease=null,lease_until=null,error_code='google_sync_failed' where location_resource_name=m.location_resource_name;
  end if;
 else raise exception 'Unsupported Google Business Profile action.';end if;
 insert into google_business_private.events(action,actor,outlet_id,details) values(p_action,p_user,p_outlet,jsonb_build_object('generation',c.generation)||case when p_action='map' then jsonb_build_object('previous_location',m.location_resource_name,'location',p_data->>'location') else '{}'::jsonb end);
 return jsonb_build_object('ok',true);
end;$$;
revoke all on function public.crew_google_business_server(text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.crew_google_business_server(text,uuid,uuid,jsonb) to service_role;

-- Content is encrypted and expires after 24h; purge independently of browser traffic.
create function google_business_private.purge() returns void language sql security definer set search_path=public,pg_temp as $$
 delete from google_business_private.inbox_cache where expires_at<=now() or (expires_at is null and lease_until<now()-interval '1 day');
 delete from google_business_private.oauth where expires_at<=now();
 update google_business_private.connection set accounts='[]' where discovered_at<=now()-interval '29 days';
 update public.crew_google_business_locations set display_name='Google location' where verified_at<=now()-interval '29 days';
$$;
revoke all on function google_business_private.purge() from public,anon,authenticated;
select cron.schedule('crew-google-business-cache-purge','17 * * * *',$job$select google_business_private.purge();$job$);
