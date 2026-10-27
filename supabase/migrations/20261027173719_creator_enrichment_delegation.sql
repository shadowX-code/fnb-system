-- Explicit, purpose-limited delegation. No existing connection is activated.
create table marketing_private.creator_enrichment_delegations (
 organization_id uuid primary key references public.organizations(id),
 connection_id uuid references public.marketing_connections(id),
 credential_generation integer check(credential_generation>0),
 active boolean not null default false, revision integer not null default 0,
 epoch uuid not null default gen_random_uuid(),
 granted_by uuid references public.employees(id), granted_at timestamptz,
 revoked_by uuid references public.employees(id), revoked_at timestamptz,
 check(not active or (connection_id is not null and credential_generation is not null and granted_by is not null))
);
create table marketing_private.creator_enrichment_requests (
 id uuid primary key, organization_id uuid not null references public.organizations(id),
 actor uuid references public.employees(id), account_id uuid references public.marketing_creator_accounts(id),
 handle text not null check(handle ~ '^[a-z0-9._]{1,30}$'), account_identity jsonb,
 connection_id uuid not null references public.marketing_connections(id), generation integer not null,
 delegation_epoch uuid not null, worker boolean not null default false,
 state text not null default 'pending' check(state in ('pending','ready','failed')),
 created_at timestamptz not null default clock_timestamp(), expires_at timestamptz not null,
 observation jsonb, previous_observation jsonb, failure_reason text, consumed boolean not null default false,
 check(octet_length(observation::text)<=6000),check(octet_length(previous_observation::text)<=16000)
);
alter table marketing_private.creator_enrichment_delegations enable row level security;
alter table marketing_private.creator_enrichment_requests enable row level security;
revoke all on marketing_private.creator_enrichment_delegations,marketing_private.creator_enrichment_requests from public,anon,authenticated;

-- Workspace membership/role checks mirror the canonical shared Creator boundary; no Brand access is implied.
create function marketing_private.creator_enrichment_actor_allowed(p_actor uuid,p_org uuid,p_permission text)
returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.employees e join public.roles r on r.id=e.role_id
 join public.organization_memberships m on m.employee_id=e.id and m.organization_id=p_org
 where e.id=p_actor and e.auth_user_id is not null and e.is_active and e.enable_system_login and e.access_state='active' and r.is_active
 and (lower(r.name) in ('owner','admin') or not exists(select 1 from unnest(array['marketing_workspace.access','marketing_creators.view','marketing_creators.manage',p_permission]) required(code)
 where not exists(select 1 from public.role_permissions rp join public.permissions p on p.id=rp.permission_id where rp.role_id=r.id and p.code=required.code))));
$$;
create function marketing_private.creator_enrichment_connection_eligible(p_connection uuid,p_org uuid,p_generation integer)
returns boolean language sql volatile security definer set search_path=public as $$
 select exists(select 1 from public.marketing_connections c join public.brands b on b.id=c.brand_id
 join marketing_private.credentials s on s.connection_id=c.id
 where c.id=p_connection and c.organization_id=p_org and b.organization_id=p_org and b.is_active
 and c.channel='instagram' and c.provider_account_id ~ '^[0-9]{1,40}$' and c.credential_generation=p_generation
 and c.status in ('test_authorized','production_authorized') and c.expires_at>clock_timestamp() and s.expires_at>clock_timestamp() and s.sealed_token is not null
 and c.capabilities->'granted_scopes' @> '["instagram_basic","pages_read_engagement","instagram_manage_insights"]'::jsonb);
$$;
create function marketing_private.creator_enrichment_current(p_org uuid)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare d marketing_private.creator_enrichment_delegations;c public.marketing_connections;
begin
 select * into d from marketing_private.creator_enrichment_delegations where organization_id=p_org;
 if not found or not d.active or not marketing_private.creator_enrichment_connection_eligible(d.connection_id,p_org,d.credential_generation) then return null;end if;
 select * into c from public.marketing_connections where id=d.connection_id;
 if not marketing_private.creator_enrichment_actor_allowed(d.granted_by,p_org,'platform_organizations.manage')
 or not marketing_private.actor_allowed(d.granted_by,p_org,c.brand_id,'marketing_settings.configure') then return null;end if;
 return jsonb_build_object('eligible',true,'connection_id',d.connection_id,'generation',d.credential_generation,'epoch',d.epoch,'revision',d.revision);
end;$$;
create or replace function public.marketing_creator_profile_connection(p_org uuid)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
begin
 perform marketing_private.require_access(p_org,null,'marketing_creators.view');
 if marketing_private.creator_enrichment_current(p_org) is not null then return jsonb_build_object('eligible',true);end if;
 return jsonb_build_object('eligible',false,'reason','organization_profile_authorization_required');
end;$$;

create function public.marketing_creator_enrichment_settings(p_org uuid)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare actor uuid:=marketing_private.require_access(p_org,null,'marketing_creators.manage');d marketing_private.creator_enrichment_delegations;
begin
 if not marketing_private.creator_enrichment_actor_allowed(actor,p_org,'platform_organizations.manage') then raise exception using errcode='42501',message='Workspace administrator permission is required.';end if;
 select * into d from marketing_private.creator_enrichment_delegations where organization_id=p_org;
 return jsonb_build_object('revision',coalesce(d.revision,0),'active',coalesce(d.active,false),'eligible',marketing_private.creator_enrichment_current(p_org) is not null,
 'connection_id',d.connection_id,'generation',d.credential_generation,'granted_at',d.granted_at,'revoked_at',d.revoked_at,
 'connections',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'account_name',c.account_name,'provider_account_id',c.provider_account_id,'generation',c.credential_generation,'brand',b.name))
 from public.marketing_connections c join public.brands b on b.id=c.brand_id where c.organization_id=p_org
 and marketing_private.actor_allowed(actor,p_org,c.brand_id,'marketing_settings.configure')
 and marketing_private.creator_enrichment_connection_eligible(c.id,p_org,c.credential_generation)),'[]'::jsonb));
end;$$;
create function public.marketing_creator_enrichment_delegate(p_request uuid,p_org uuid,p_revision integer,p_connection uuid,p_generation integer,p_active boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=marketing_private.require_access(p_org,null,'marketing_creators.manage');d marketing_private.creator_enrichment_delegations;c public.marketing_connections;
 fp text:=md5(jsonb_build_array('creator_enrichment_delegate',p_org,p_revision,p_connection,p_generation,p_active)::text);prior public.marketing_requests;result jsonb;
begin
 if not marketing_private.creator_enrichment_actor_allowed(actor,p_org,'platform_organizations.manage') or p_request is null or p_revision is null or p_active is null then raise exception using errcode='42501',message='Workspace administrator permission and a valid request are required.';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 select * into prior from public.marketing_requests where request_id=p_request;
 if found then if prior.actor_employee_id<>actor or prior.fingerprint<>fp then raise exception 'Retry changed. Use a new request.';end if;return public.marketing_creator_enrichment_settings(p_org);end if;
 perform pg_advisory_xact_lock(hashtextextended('creator-delegation:'||p_org::text,0));
 insert into marketing_private.creator_enrichment_delegations(organization_id) values(p_org) on conflict do nothing;
 select * into d from marketing_private.creator_enrichment_delegations where organization_id=p_org for update;
 if d.revision<>p_revision then raise exception using errcode='40001',message='Delegation changed. Reload before continuing.';end if;
 if p_active then
  select * into c from public.marketing_connections where id=p_connection for share;
  if not marketing_private.creator_enrichment_connection_eligible(p_connection,p_org,p_generation)
  or not marketing_private.actor_allowed(actor,p_org,c.brand_id,'marketing_settings.configure') then raise exception using errcode='42501',message='Choose an eligible, authorized Instagram connection and its current generation.';end if;
  update marketing_private.creator_enrichment_delegations set connection_id=p_connection,credential_generation=p_generation,active=true,revision=revision+1,epoch=gen_random_uuid(),granted_by=actor,granted_at=clock_timestamp(),revoked_by=null,revoked_at=null where organization_id=p_org;
 else
  update marketing_private.creator_enrichment_delegations set active=false,revision=revision+1,epoch=gen_random_uuid(),revoked_by=actor,revoked_at=clock_timestamp() where organization_id=p_org;
 end if;
 insert into public.marketing_events(organization_id,action,actor_employee_id,details) values(p_org,case when p_active then 'creators.enrichment_delegated' else 'creators.enrichment_revoked' end,actor,jsonb_build_object('connection_id',case when p_active then p_connection else d.connection_id end,'generation',case when p_active then p_generation else d.credential_generation end,'purpose','public_instagram_creator_enrichment','revision',d.revision+1,'request_id',p_request));
 result:=public.marketing_creator_enrichment_settings(p_org);
 insert into public.marketing_requests values(p_request,actor,fp,result);return result;
end;$$;

-- Locks are held until commit; grant/revoke and credential rotation serialize with persistence.
create function marketing_private.creator_enrichment_lock(p_org uuid,p_connection uuid,p_generation integer,p_epoch uuid)
returns void language plpgsql security definer set search_path=public as $$
declare current_scope jsonb;
begin
 perform 1 from marketing_private.creator_enrichment_delegations where organization_id=p_org for share;
 perform 1 from public.marketing_connections where id=p_connection for share;
 current_scope:=marketing_private.creator_enrichment_current(p_org);
 if current_scope is null or current_scope->>'connection_id' is distinct from p_connection::text
 or (current_scope->>'generation')::integer is distinct from p_generation or current_scope->>'epoch' is distinct from p_epoch::text then
 raise exception using errcode='42501',message='organization_profile_authorization_required';end if;
end;$$;
create function marketing_private.creator_enrichment_identity(a public.marketing_creator_accounts)
returns jsonb language sql immutable set search_path=public as $$
 select jsonb_build_array(a.creator_id,a.platform,a.handle,a.external_id,a.profile_url);
$$;
create function public.marketing_creator_enrichment_begin(p_org uuid,p_handle text,p_account uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=marketing_private.require_access(p_org,null,'marketing_creators.manage');s jsonb;r uuid;a public.marketing_creator_accounts;
begin
 if p_handle is null or p_handle !~ '^[a-z0-9._]{1,30}$' then raise exception 'Choose a valid Instagram profile.';end if;
 s:=marketing_private.creator_enrichment_current(p_org);
 if s is null then return jsonb_build_object('eligible',false,'reason','organization_profile_authorization_required');end if;
 perform marketing_private.creator_enrichment_lock(p_org,(s->>'connection_id')::uuid,(s->>'generation')::int,(s->>'epoch')::uuid);
 if p_account is not null then
  select * into a from public.marketing_creator_accounts where id=p_account and organization_id=p_org and platform='instagram' and handle=p_handle and not archived;
  if a.id is null or not marketing_private.creator_editable(p_org,a.creator_id) or not exists(select 1 from public.marketing_creators where id=a.creator_id and not archived) then raise exception using errcode='42501',message='Choose an editable active Instagram profile.';end if;
 end if;
 r:=public.marketing_creator_inspection_access(p_org,null,true);
 insert into marketing_private.creator_enrichment_requests(id,organization_id,actor,account_id,handle,account_identity,connection_id,generation,delegation_epoch,expires_at)
 values(r,p_org,actor,p_account,p_handle,case when a.id is not null then marketing_private.creator_enrichment_identity(a) end,(s->>'connection_id')::uuid,(s->>'generation')::int,(s->>'epoch')::uuid,clock_timestamp()+interval '1 minute');
 return jsonb_build_object('eligible',true,'request_id',r);
end;$$;
create function public.marketing_creator_enrichment_material(p_request uuid,p_auth_user uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r marketing_private.creator_enrichment_requests;c public.marketing_connections;s jsonb;
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='Service required.';end if;
 select * into r from marketing_private.creator_enrichment_requests where id=p_request;
 if r.id is null or r.state<>'pending' or r.expires_at<=clock_timestamp() or
 (not r.worker and (p_auth_user is null or not exists(select 1 from public.employees where id=r.actor and auth_user_id=p_auth_user) or not marketing_private.creator_enrichment_actor_allowed(r.actor,r.organization_id,'marketing_creators.manage')))
 or (r.worker and p_auth_user is not null) then raise exception using errcode='42501',message='Enrichment request is unavailable.';end if;
 if r.account_id is not null and not exists(select 1 from public.marketing_creator_accounts a join public.marketing_creators cr on cr.id=a.creator_id where a.id=r.account_id and a.organization_id=r.organization_id and not a.archived and not cr.archived and marketing_private.creator_enrichment_identity(a)=r.account_identity and (not r.worker or (a.followers_lease=r.id and a.followers_lease_until>clock_timestamp()))) then raise exception using errcode='40001',message='Profile changed during refresh.';end if;
 perform marketing_private.creator_enrichment_lock(r.organization_id,r.connection_id,r.generation,r.delegation_epoch);
 select * into c from public.marketing_connections where id=r.connection_id;
 select sealed_token into s from marketing_private.credentials where connection_id=c.id;
 return jsonb_build_object('purpose','public_instagram_creator_enrichment','request_id',r.id,'id',c.id,'organization_id',c.organization_id,'brand_id',c.brand_id,'channel',c.channel,'provider_account_id',c.provider_account_id,'account_name',c.account_name,'credential_generation',c.credential_generation,'sealed_token',s,'handle',r.handle);
end;$$;
create function public.marketing_creator_enrichment_finish(p_request uuid,p_auth_user uuid,p_observation jsonb default null,p_error text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r marketing_private.creator_enrichment_requests;a public.marketing_creator_accounts;o jsonb;captured timestamptz:=clock_timestamp();count_value bigint;image text;result jsonb;
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='Service required.';end if;
 select * into r from marketing_private.creator_enrichment_requests where id=p_request;
 if r.id is null then raise exception using errcode='42501',message='Enrichment request is unavailable.';end if;
 perform marketing_private.creator_enrichment_lock(r.organization_id,r.connection_id,r.generation,r.delegation_epoch);
 select * into r from marketing_private.creator_enrichment_requests where id=p_request for update;
 if r.expires_at<=clock_timestamp() or (not r.worker and (p_auth_user is null or not exists(select 1 from public.employees where id=r.actor and auth_user_id=p_auth_user) or not marketing_private.creator_enrichment_actor_allowed(r.actor,r.organization_id,'marketing_creators.manage')))
 or (r.worker and p_auth_user is not null) then raise exception using errcode='42501',message='Enrichment request is unavailable.';end if;
 if r.state<>'pending' then
  if r.account_id is not null and r.account_identity is not null then select * into a from public.marketing_creator_accounts where id=r.account_id and not archived and marketing_private.creator_enrichment_identity(marketing_creator_accounts)=r.account_identity;end if;
  return jsonb_build_object('state',r.state,'observation',r.observation,'enrichment_receipt',r.id,'account',case when a.id is not null then to_jsonb(a) end);end if;
 if r.account_id is not null then
  perform 1 from public.marketing_creators where id=(select creator_id from public.marketing_creator_accounts where id=r.account_id) and not archived for share;
  if not found then raise exception using errcode='40001',message='Creator changed during refresh.';end if;
  select * into a from public.marketing_creator_accounts where id=r.account_id and not archived for update;
  if a.id is null or marketing_private.creator_enrichment_identity(a) is distinct from r.account_identity
  or (r.worker and (a.followers_lease is distinct from r.id or a.followers_lease_until<=clock_timestamp())) then raise exception using errcode='40001',message='Profile changed during refresh.';end if;
 end if;
 if p_error is not null then
  update marketing_private.creator_enrichment_requests set state='failed',failure_reason=case when p_error in ('provider_identity_mismatch','provider_profile_unavailable','provider_read_failed','meta_permission_or_token_invalid') then p_error else 'provider_read_failed' end where id=r.id;
  if a.id is not null then update public.marketing_creator_accounts set followers_sync_status='failed',followers_sync_reason='provider_read_failed',followers_due_at=clock_timestamp()+interval '1 hour',followers_lease=null,followers_lease_until=null where id=a.id;end if;
  return jsonb_build_object('state','failed','reason','provider_read_failed');
 end if;
 if jsonb_typeof(p_observation)<>'object' or octet_length(p_observation::text)>6000 or p_observation->>'username' is distinct from r.handle or coalesce(p_observation->>'id','') !~ '^[0-9]{1,40}$'
 or (a.identity_verified and nullif(a.external_id,'') is not null and a.external_id<>p_observation->>'id') then raise exception 'Invalid matching provider observation.';end if;
 image:=nullif(p_observation->>'avatar_url','');
 if image is not null and (image !~ '^https://([A-Za-z0-9-]+[.])*(cdninstagram[.]com|fbcdn[.]net)/[^[:space:]]+$' or image ~ '[?&]access_token=') then raise exception 'Invalid provider profile image.';end if;
 if p_observation?'followers' then
  if jsonb_typeof(p_observation->'followers')<>'number' or p_observation->>'followers' !~ '^[0-9]{1,16}$' then raise exception 'Invalid provider follower evidence.';end if;
  count_value:=(p_observation->>'followers')::bigint;if count_value>1000000000000000 then raise exception 'Invalid provider follower evidence.';end if;
 end if;
 if image is null and count_value is null then raise exception 'No usable provider observation.';end if;
 o:=jsonb_build_object('source','Meta Instagram Business Discovery','captured_at',captured,'profile_url','https://www.instagram.com/'||r.handle||'/','provider_id',p_observation->>'id','connection_id',r.connection_id,'connection_generation',r.generation,'delegation_epoch',r.delegation_epoch,'request_id',r.id);
 if image is not null then o:=o||jsonb_build_object('avatar_url',image,'avatar_kind','profile_picture');end if;
 if count_value is not null then o:=o||jsonb_build_object('followers',count_value);end if;
 update marketing_private.creator_enrichment_requests set state='ready',observation=o,previous_observation=case when a.id is not null then jsonb_build_object('public_observation',a.public_observation,'followers',a.followers,'followers_source',a.followers_source,'followers_captured_at',a.followers_captured_at) end,expires_at=clock_timestamp()+interval '5 minutes' where id=r.id;
 if a.id is not null then
  update public.marketing_creator_accounts set public_observation=case when image is null then public_observation else (o-'followers')||jsonb_build_object('source','meta_instagram_business_discovery','source_hint','Meta Instagram Business Discovery') end,
   followers=coalesce(count_value,followers),followers_source=case when count_value is null then followers_source else 'meta_instagram_business_discovery' end,
   followers_captured_at=case when count_value is null then followers_captured_at else captured end,
   followers_sync_status=case when count_value is null then 'unavailable' else 'ready' end,followers_sync_reason=case when count_value is null then 'followers_not_returned' end,
   followers_due_at=clock_timestamp()+interval '1 day',followers_lease=null,followers_lease_until=null where id=a.id returning * into a;
  update marketing_private.creator_enrichment_requests set consumed=true where id=r.id;
 end if;
 insert into public.marketing_events(organization_id,action,actor_employee_id,details) values(r.organization_id,'creators.profile_enriched',r.actor,jsonb_build_object('account_id',r.account_id,'request_id',r.id,'connection_id',r.connection_id,'generation',r.generation,'purpose','public_instagram_creator_enrichment'));
 return jsonb_build_object('state','ready','observation',o,'enrichment_receipt',r.id,'account',case when a.id is not null then to_jsonb(a) end);
end;$$;

-- Ordinary browser edits cannot introduce Meta evidence. New-profile previews use one-use server receipts.
create function marketing_private.creator_enrichment_payload(p_org uuid,p_action text,p_id uuid,p_payload jsonb,p_lock_only boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.marketing_creator_accounts;r marketing_private.creator_enrichment_requests;child jsonb;platform text;
begin
 if p_action='save_creator' then
  for child in select value from jsonb_array_elements(coalesce(p_payload->'profiles','[]')) loop
   perform marketing_private.creator_enrichment_payload(p_org,'save_account',nullif(child->>'id','')::uuid,child,true);
  end loop;return p_payload;
 end if;
 if p_action not in ('save_account','archive_account') then return p_payload;end if;
 if p_id is not null then select * into a from public.marketing_creator_accounts where id=p_id and organization_id=p_org;end if;
 platform:=coalesce(p_payload->>'platform',a.platform);
 if platform<>'instagram' then return p_payload;end if;
 if p_action='archive_account' then return p_payload-'public_observation'-'profile_enrichment_receipt';end if;
 if nullif(p_payload->>'profile_enrichment_receipt','') is null then
  if p_payload?'public_observation' and p_payload->'public_observation' is distinct from 'null'::jsonb and p_payload->'public_observation' is distinct from a.public_observation then raise exception using errcode='42501',message='Refresh Instagram through delegated enrichment before saving new evidence.';end if;
  return p_payload-'public_observation';
 end if;
 select * into r from marketing_private.creator_enrichment_requests where id=(p_payload->>'profile_enrichment_receipt')::uuid;
 if r.id is null or r.organization_id<>p_org or r.actor<>marketing_private.actor() or r.account_id is not null or r.state<>'ready' or r.expires_at<=clock_timestamp() or r.consumed then raise exception using errcode='42501',message='Profile enrichment evidence expired or is unavailable. Refresh again.';end if;
 perform marketing_private.creator_enrichment_lock(r.organization_id,r.connection_id,r.generation,r.delegation_epoch);
 select * into r from marketing_private.creator_enrichment_requests where id=r.id for update;
 if (a.identity_verified and nullif(a.external_id,'') is not null and a.external_id is distinct from r.observation->>'provider_id') then raise exception using errcode='42501',message='Provider identity no longer matches this verified profile.';end if;
 if r.consumed or r.handle is distinct from lower(ltrim(p_payload->>'handle','@')) or (a.public_observation->>'captured_at')::timestamptz>(r.observation->>'captured_at')::timestamptz then raise exception using errcode='40001',message='Profile evidence changed. Refresh again.';end if;
 if p_lock_only then return p_payload;end if;
 update marketing_private.creator_enrichment_requests set consumed=true where id=r.id;
 if nullif(r.observation->>'avatar_url','') is null then return p_payload-'public_observation';end if;
 return (p_payload-'public_observation')||jsonb_build_object('public_observation',r.observation);
end;$$;

do $patch$
declare original text;body text;needle text;
begin
 select pg_get_functiondef('public.marketing_creator_command(uuid,uuid,uuid,text,uuid,integer,jsonb)'::regprocedure) into original;
 needle:=' if p_action in (''save_creator'',''archive_creator'',''share_creator'') and p_id is not null then';
 if strpos(original,needle)=0 then raise exception 'Creator command boundary changed.';end if;
 body:=replace(original,needle,' p_payload:=marketing_private.creator_enrichment_payload(p_org,p_action,p_id,p_payload);'||chr(10)||needle);
 needle:=' if p_action=''archive_account'' then';
 if strpos(body,needle)=0 then raise exception 'Account evidence snapshot boundary changed.';end if;
 body:=replace(body,needle,$history$
 if a.id is not null and p_action='save_account' and p_payload?'profile_enrichment_receipt' then
  update marketing_private.creator_enrichment_requests set previous_observation=jsonb_build_object('public_observation',a.public_observation,'followers',a.followers,'followers_source',a.followers_source,'followers_captured_at',a.followers_captured_at) where id=(p_payload->>'profile_enrichment_receipt')::uuid;
 end if;
 if p_action='archive_account' then
$history$);

 needle:=' result:=to_jsonb(a);entity:=''account'';record_id:=a.id;rev:=a.revision;';
 if strpos(body,needle)=0 then raise exception 'Account evidence projection changed.';end if;
 body:=replace(body,needle,$append$
 if p_action='save_account' and p_payload?'profile_enrichment_receipt' then
  if p_payload?'public_observation' then
  update public.marketing_creator_accounts set public_observation=public_observation||jsonb_build_object('request_id',p_payload->>'profile_enrichment_receipt','connection_id',p_payload->'public_observation'->'connection_id','connection_generation',p_payload->'public_observation'->'connection_generation','delegation_epoch',p_payload->'public_observation'->'delegation_epoch') where id=a.id returning * into a;
  end if;
  update marketing_private.creator_enrichment_requests set account_id=a.id where id=(p_payload->>'profile_enrichment_receipt')::uuid;
 end if;
 result:=to_jsonb(a);entity:='account';record_id:=a.id;rev:=a.revision;
$append$);
 execute body;
end;$patch$;


-- Use the existing bounded follower queue, with the same delegation lock order as commit.
create or replace function public.marketing_creator_followers_claim() returns jsonb
language plpgsql security definer set search_path=public as $$
declare candidate uuid;a public.marketing_creator_accounts;s jsonb;
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='Worker required.';end if;
 select ca.id into candidate from public.marketing_creator_accounts ca join public.marketing_creators cr on cr.id=ca.creator_id
 where not ca.archived and not cr.archived and ca.platform in ('facebook','instagram') and ca.followers_due_at<=now() and (ca.followers_lease_until is null or ca.followers_lease_until<now()) order by ca.followers_due_at,ca.id limit 1;
 if candidate is null then return null;end if;
 select * into a from public.marketing_creator_accounts where id=candidate;
 if a.platform='instagram' and a.handle ~ '^[a-z0-9._]{1,30}$' then s:=marketing_private.creator_enrichment_current(a.organization_id);end if;
 if s is not null then perform marketing_private.creator_enrichment_lock(a.organization_id,(s->>'connection_id')::uuid,(s->>'generation')::int,(s->>'epoch')::uuid);end if;
 select ca.* into a from public.marketing_creator_accounts ca join public.marketing_creators cr on cr.id=ca.creator_id where ca.id=candidate and not ca.archived and not cr.archived and ca.followers_due_at<=now() and (ca.followers_lease_until is null or ca.followers_lease_until<now()) for update of ca skip locked;
 if a.id is null then return null;end if;
 -- Re-read after the row lock; an identity/platform move must not borrow an old scope.
 if a.platform<>'instagram' or s->>'connection_id' is null then s:=null;end if;
 if s is not null then perform marketing_private.creator_enrichment_lock(a.organization_id,(s->>'connection_id')::uuid,(s->>'generation')::int,(s->>'epoch')::uuid);end if;
 update public.marketing_creator_accounts set followers_sync_status='syncing',followers_sync_reason=null,followers_lease=gen_random_uuid(),followers_lease_until=clock_timestamp()+interval '90 seconds',followers_attempted_at=clock_timestamp() where id=a.id returning * into a;
 if s is not null then
  insert into marketing_private.creator_enrichment_requests(id,organization_id,account_id,handle,account_identity,connection_id,generation,delegation_epoch,worker,expires_at)
  values(a.followers_lease,a.organization_id,a.id,a.handle,marketing_private.creator_enrichment_identity(a),(s->>'connection_id')::uuid,(s->>'generation')::int,(s->>'epoch')::uuid,true,a.followers_lease_until);
 end if;
 return to_jsonb(a)||jsonb_build_object('connection_id',s->>'connection_id','connection_generation',(s->>'generation')::integer,'enrichment_request_id',case when s is not null then a.followers_lease end);
end;$$;

revoke all on function marketing_private.creator_enrichment_actor_allowed(uuid,uuid,text),marketing_private.creator_enrichment_connection_eligible(uuid,uuid,integer),marketing_private.creator_enrichment_current(uuid),marketing_private.creator_enrichment_lock(uuid,uuid,integer,uuid),marketing_private.creator_enrichment_identity(public.marketing_creator_accounts),marketing_private.creator_enrichment_payload(uuid,text,uuid,jsonb,boolean) from public,anon,authenticated;
revoke all on function public.marketing_creator_enrichment_settings(uuid),public.marketing_creator_enrichment_delegate(uuid,uuid,integer,uuid,integer,boolean),public.marketing_creator_enrichment_begin(uuid,text,uuid),public.marketing_creator_enrichment_material(uuid,uuid),public.marketing_creator_enrichment_finish(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.marketing_creator_enrichment_settings(uuid),public.marketing_creator_enrichment_delegate(uuid,uuid,integer,uuid,integer,boolean),public.marketing_creator_enrichment_begin(uuid,text,uuid) to authenticated;
grant execute on function public.marketing_creator_enrichment_material(uuid,uuid),public.marketing_creator_enrichment_finish(uuid,uuid,jsonb,text) to service_role;
