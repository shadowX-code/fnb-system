-- Ads reuse the canonical credential/grant lineage; no social capability or execution policy changes.
alter table public.marketing_connections drop constraint marketing_connections_channel_check;
alter table public.marketing_connections add constraint marketing_connections_channel_check check(channel in ('facebook','instagram','ad_account'));
alter table public.marketing_connections add column account_slot text not null default '';
alter table public.marketing_connections add constraint marketing_connection_slot check((channel='ad_account' and account_slot ~ '^[0-9]+$') or (channel<>'ad_account' and account_slot=''));
alter table public.marketing_connections drop constraint marketing_connections_brand_id_channel_key;
alter table public.marketing_connections add unique(brand_id,channel,account_slot);
alter table marketing_private.oauth_sessions add column purpose text not null default 'social' check(purpose in ('social','ads'));
-- Preserve the social upsert authority, with its unchanged empty slot.
do $$ declare body text; begin
 select pg_get_functiondef('public.marketing_meta_bind(uuid,uuid,text,text,jsonb,timestamptz,text)'::regprocedure) into body;
 body:=replace(body,'on conflict(brand_id,channel)','on conflict(brand_id,channel,account_slot)');execute body;
 -- Social surfaces never consume Ads bindings or Ads discovery sessions.
 select pg_get_functiondef('public.marketing_integrations(uuid,uuid,text,integer)'::regprocedure) into body;
 body:=replace(body,'where c.organization_id=p_org','where c.channel in (''facebook'',''instagram'') and c.organization_id=p_org');execute body;
 select pg_get_functiondef('public.marketing_inbox_read(uuid,uuid,text,text,text,integer,integer,text,boolean)'::regprocedure) into body;
 body:=replace(body,'where c.organization_id=p_org','where c.channel in (''facebook'',''instagram'') and c.organization_id=p_org');execute body;
 select pg_get_functiondef('public.marketing_meta_pending(uuid,uuid)'::regprocedure) into body;
 body:=replace(body,'where s.organization_id=p_org','where s.purpose=''social'' and s.organization_id=p_org');execute body;
end $$;
create table marketing_private.ads_accounts (
 connection_id uuid primary key references public.marketing_connections(id), generation integer not null,
 currency text not null check(currency ~ '^[A-Z]{3}$'), timezone text not null, account_status integer,
 tasks jsonb not null default '[]', read_verified boolean not null default false, manage_verified boolean not null default false,
 checked_at timestamptz not null default now(), sync_error text
);
create table marketing_private.ads_sync_jobs (
 id uuid primary key default gen_random_uuid(), connection_id uuid not null references public.marketing_connections(id), generation integer not null,
 actor_employee_id uuid not null references public.employees(id), date_from date not null,date_to date not null,
 state text not null default 'queued' check(state in ('queued','leased','retry','succeeded','failed','cancelled')),
 attempts integer not null default 0, lease uuid, lease_until timestamptz,retry_at timestamptz,error_code text,
 created_at timestamptz not null default now(), completed_at timestamptz,
 check(date_to>=date_from and date_to-date_from<=93)
);
create index ads_sync_pending on marketing_private.ads_sync_jobs(state,retry_at,created_at);
create unique index ads_sync_active on marketing_private.ads_sync_jobs(connection_id,generation,date_from,date_to) where state in ('queued','leased','retry');
create table marketing_private.ads_snapshots (
 connection_id uuid not null references public.marketing_connections(id), generation integer not null,date_from date not null,date_to date not null,
 observed_at timestamptz not null default now(), payload jsonb not null,
 primary key(connection_id,generation,date_from,date_to)
);
alter table marketing_private.ads_accounts enable row level security;
alter table marketing_private.ads_sync_jobs enable row level security;
alter table marketing_private.ads_snapshots enable row level security;
revoke all on marketing_private.ads_accounts,marketing_private.ads_sync_jobs,marketing_private.ads_snapshots from public,anon,authenticated;
insert into public.permissions(code,module,description,requires_restaurant_outlet_scope) values
 ('marketing_ads.view','Marketing Ads','View brand-scoped advertising accounts and performance.',false),
 ('marketing_ads.connect','Marketing Ads','Discover and bind authorized ad accounts.',false),
 ('marketing_ads.manage','Marketing Ads','Prepare advertising revisions.',false),
 ('marketing_ads.review','Marketing Ads','Review advertising proposals.',false),
 ('marketing_ads.approve','Marketing Ads','Approve exact advertising configurations and budgets.',false),
 ('marketing_ads.execute','Marketing Ads','Execute explicitly approved advertising changes.',false),
 ('marketing_ads.ai','Marketing Ads','Request evidence-grounded advisory Ads recommendations.',false)
on conflict(code) do nothing;

create function public.marketing_ads_begin(p_org uuid,p_brand uuid,p_state_hash text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare actor uuid:=marketing_private.require_access(p_org,p_brand,'marketing_ads.connect'); s marketing_private.oauth_sessions;
begin
 if p_brand is null or coalesce(p_state_hash,'') !~ '^[a-f0-9]{64}$' then raise exception 'Choose a brand.';end if;
 if (select count(*) from marketing_private.oauth_sessions where actor_employee_id=actor and expires_at>now())>=10 then raise exception 'Too many pending connections.';end if;
 insert into marketing_private.oauth_sessions(state_hash,organization_id,brand_id,actor_employee_id,redirect_uri,purpose)
 values(p_state_hash,p_org,p_brand,actor,'https://ujkzdaaadnvcfayuldmh.supabase.co/functions/v1/marketing-meta/callback','ads') returning * into s;
 return jsonb_build_object('id',s.id,'expires_at',s.expires_at);
end;$$;
-- The same callback/state authority selects the operation-specific permission.
create or replace function public.marketing_meta_consume(p_state_hash text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare s marketing_private.oauth_sessions;
begin
 select * into s from marketing_private.oauth_sessions where state_hash=p_state_hash for update;
 if not found or s.consumed_at is not null or s.expires_at<=now() then raise exception using errcode='42501',message='Meta authorization expired or was already used.';end if;
 if not marketing_private.actor_allowed(s.actor_employee_id,s.organization_id,s.brand_id,case s.purpose when 'ads' then 'marketing_ads.connect' else 'marketing_settings.configure' end) then raise exception using errcode='42501',message='Meta authorization scope was revoked.';end if;
 update marketing_private.oauth_sessions set consumed_at=now() where id=s.id;
 return jsonb_build_object('id',s.id,'organization_id',s.organization_id,'brand_id',s.brand_id,'actor_employee_id',s.actor_employee_id,'redirect_uri',s.redirect_uri,'purpose',s.purpose);
end;$$;
create function public.marketing_ads_stage(p_session uuid,p_user_id text,p_sealed jsonb,p_accounts jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare s marketing_private.oauth_sessions;
begin
 select * into s from marketing_private.oauth_sessions where id=p_session for update;
 if not found or s.purpose<>'ads' or s.consumed_at is null or s.expires_at<=now() or s.sealed_discovery is not null
 or not marketing_private.actor_allowed(s.actor_employee_id,s.organization_id,s.brand_id,'marketing_ads.connect')
 or coalesce(p_user_id,'') !~ '^[0-9]+$' or p_sealed is null or jsonb_typeof(p_accounts)<>'array' or jsonb_array_length(p_accounts)>500 then raise exception 'Ad Account discovery unavailable.';end if;
 update marketing_private.oauth_sessions set meta_user_id=p_user_id,sealed_discovery=p_sealed,accounts=p_accounts,expires_at=now()+interval '15 minutes' where id=s.id;
end;$$;
create function public.marketing_ads_pending(p_org uuid,p_brand uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=marketing_private.require_access(p_org,p_brand,'marketing_ads.connect'); result jsonb;
begin
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'expires_at',s.expires_at,'accounts',(
 select coalesce(jsonb_agg(a.value||jsonb_build_object('available',not exists(select 1 from public.marketing_connections x where x.channel='ad_account' and x.provider_account_id=a.value->>'id' and x.brand_id<>s.brand_id))),'[]') from jsonb_array_elements(s.accounts) a))),'[]') into result
 from marketing_private.oauth_sessions s where s.purpose='ads' and s.organization_id=p_org and s.brand_id=p_brand and s.actor_employee_id=actor and s.expires_at>now() and s.sealed_discovery is not null and s.selected_at is null;
 return result;
end;$$;
create function public.marketing_ads_session(p_session uuid,p_auth_user uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare s marketing_private.oauth_sessions; actor uuid;
begin
 select id into actor from public.employees where auth_user_id=p_auth_user;
 select * into s from marketing_private.oauth_sessions where id=p_session and actor_employee_id=actor;
 if not found or s.purpose<>'ads' or s.expires_at<=now() or s.sealed_discovery is null or not marketing_private.actor_allowed(actor,s.organization_id,s.brand_id,'marketing_ads.connect') then raise exception using errcode='42501',message='Ad Account selection unavailable.';end if;
 return to_jsonb(s)-'state_hash';
end;$$;
create function public.marketing_ads_bind(p_session uuid,p_auth_user uuid,p_account text,p_brand uuid,p_sealed jsonb,p_expiry timestamptz,p_account_evidence jsonb,p_expected_generation integer) returns jsonb
language plpgsql security definer set search_path=public as $$
declare s marketing_private.oauth_sessions;c public.marketing_connections;a jsonb;
begin
 perform public.marketing_ads_session(p_session,p_auth_user);
 select * into s from marketing_private.oauth_sessions where id=p_session for update;
 if s.selected_at is not null or s.brand_id is distinct from p_brand or p_sealed is null or p_expiry<=now() or p_expiry is null then raise exception 'Selection changed or expired.';end if;
 select value into a from jsonb_array_elements(s.accounts) where value->>'id'=p_account;
 if a is null or p_account_evidence->>'id' is distinct from p_account or p_account_evidence->>'read_verified' is distinct from 'true' then raise exception 'Choose a verified Ad Account.';end if;
 perform pg_advisory_xact_lock(hashtextextended('meta_ad_account:'||p_account,0));
 select * into c from public.marketing_connections where channel='ad_account' and (provider_account_id=p_account or brand_id=s.brand_id and account_slot=p_account) for update;
 if c.id is not null and (c.brand_id<>p_brand or c.credential_generation is distinct from p_expected_generation) then raise exception 'Account ownership or connection changed.';end if;
 if c.id is null and p_expected_generation is not null then raise exception 'Connection changed.';end if;
 if c.id is null then
 insert into public.marketing_connections(organization_id,brand_id,channel,account_slot,provider_account_id,account_name,status,capabilities,expires_at,connected_by,connected_at,credential_generation)
 values(s.organization_id,s.brand_id,'ad_account',p_account,p_account,a->>'name','test_authorized',jsonb_build_object('execution_enabled',false),p_expiry,s.actor_employee_id,now(),1) returning * into c;
 else
 update public.marketing_connections set provider_account_id=p_account,account_name=a->>'name',expires_at=p_expiry,status='test_authorized',capabilities=jsonb_build_object('execution_enabled',false),credential_generation=credential_generation+1,connected_by=s.actor_employee_id,connected_at=now(),error_code=null where id=c.id returning * into c;
 end if;
 insert into marketing_private.credentials(connection_id,credential_reference,sealed_token,meta_user_id,expires_at) values(c.id,'encrypted-meta:'||c.id,p_sealed,s.meta_user_id,p_expiry)
 on conflict(connection_id) do update set sealed_token=excluded.sealed_token,meta_user_id=excluded.meta_user_id,expires_at=excluded.expires_at;
 insert into marketing_private.meta_subjects(connection_id,generation,meta_user_id) values(c.id,c.credential_generation,s.meta_user_id);
 insert into marketing_private.ads_accounts(connection_id,generation,currency,timezone,account_status,tasks,read_verified,manage_verified)
 values(c.id,c.credential_generation,p_account_evidence->>'currency',p_account_evidence->>'timezone',(p_account_evidence->>'account_status')::integer,p_account_evidence->'tasks',true,coalesce((p_account_evidence->>'manage_verified')::boolean,false))
 on conflict(connection_id) do update set generation=excluded.generation,currency=excluded.currency,timezone=excluded.timezone,account_status=excluded.account_status,tasks=excluded.tasks,read_verified=excluded.read_verified,manage_verified=excluded.manage_verified,checked_at=now(),sync_error=null;
 update marketing_private.oauth_sessions set selected_at=now(),selection=jsonb_build_object('account',p_account),sealed_discovery=null where id=s.id;
 insert into public.marketing_events(organization_id,brand_id,action,actor_employee_id,details) values(c.organization_id,c.brand_id,'ad_account_connected',s.actor_employee_id,jsonb_build_object('connection_id',c.id,'generation',c.credential_generation));
 return to_jsonb(c);
end;$$;

create function public.marketing_ads_read(p_org uuid,p_brand uuid default null,p_from date default current_date-29,p_to date default current_date) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=marketing_private.require_access(p_org,p_brand,'marketing_ads.view'); accounts jsonb; reports jsonb;jobs jsonb;
begin
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>93 then raise exception 'Select up to 94 days.';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'brand_id',c.brand_id,'account_id',c.provider_account_id,'name',c.account_name,'status',c.status,'expires_at',c.expires_at,'generation',c.credential_generation,'last_synced_at',c.last_synced_at,'error_code',c.error_code,'health',case when a.generation=c.credential_generation then to_jsonb(a)-'connection_id' else null end) order by c.account_name),'[]') into accounts
 from public.marketing_connections c left join marketing_private.ads_accounts a on a.connection_id=c.id where c.channel='ad_account' and c.organization_id=p_org and (p_brand is null or c.brand_id=p_brand) and marketing_private.brand_allowed(p_org,c.brand_id);
 select coalesce(jsonb_agg(to_jsonb(s)-'generation'),'[]') into reports from marketing_private.ads_snapshots s join public.marketing_connections c on c.id=s.connection_id and c.credential_generation=s.generation
 where c.organization_id=p_org and (p_brand is null or c.brand_id=p_brand) and marketing_private.brand_allowed(p_org,c.brand_id) and s.date_from=p_from and s.date_to=p_to and c.status in ('test_authorized','production_authorized') and c.expires_at>now();
 select coalesce(jsonb_agg(to_jsonb(j)-array['lease','lease_until','actor_employee_id']),'[]') into jobs from marketing_private.ads_sync_jobs j join public.marketing_connections c on c.id=j.connection_id and c.credential_generation=j.generation
 where c.organization_id=p_org and (p_brand is null or c.brand_id=p_brand) and marketing_private.brand_allowed(p_org,c.brand_id) and j.date_from=p_from and j.date_to=p_to and j.created_at>now()-interval '1 day';
 return jsonb_build_object('accounts',accounts,'reports',reports,'jobs',jobs,'external_execution_enabled',false);
end;$$;
create function public.marketing_ads_request_sync(p_connection uuid,p_from date,p_to date) returns uuid
language plpgsql security definer set search_path=public as $$
declare c public.marketing_connections;actor uuid;job uuid;
begin
 select * into c from public.marketing_connections where id=p_connection;
 actor:=marketing_private.require_access(c.organization_id,c.brand_id,'marketing_ads.view');
 if c.channel is distinct from 'ad_account' or c.status not in ('test_authorized','production_authorized') or c.expires_at<=now() or p_from is null or p_to is null or p_to<p_from or p_to-p_from>93 then raise exception 'Ad connection or period unavailable.';end if;
 insert into marketing_private.ads_sync_jobs(connection_id,generation,actor_employee_id,date_from,date_to) values(c.id,c.credential_generation,actor,p_from,p_to) on conflict do nothing returning id into job;
 if job is null then select id into job from marketing_private.ads_sync_jobs where connection_id=c.id and generation=c.credential_generation and date_from=p_from and date_to=p_to and state in ('queued','leased','retry');end if;
 return job;
end;$$;
create function public.marketing_ads_claim() returns jsonb language plpgsql security definer set search_path=public as $$
declare j marketing_private.ads_sync_jobs;
begin
 select * into j from marketing_private.ads_sync_jobs where (state in ('queued','retry') and (retry_at is null or retry_at<=now()) or state='leased' and lease_until<now()) and attempts<4 order by created_at for update skip locked limit 1;
 if not found then return null;end if;
 update marketing_private.ads_sync_jobs set state='leased',lease=gen_random_uuid(),lease_until=now()+interval '5 minutes',attempts=attempts+1 where id=j.id returning * into j;
 return to_jsonb(j);
end;$$;
create function public.marketing_ads_material(p_job uuid,p_lease uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare j marketing_private.ads_sync_jobs;c public.marketing_connections;result jsonb;
begin
 select * into j from marketing_private.ads_sync_jobs where id=p_job and lease=p_lease and state='leased' and lease_until>now();
 select * into c from public.marketing_connections where id=j.connection_id and credential_generation=j.generation and channel='ad_account' and status in ('test_authorized','production_authorized') and expires_at>now();
 if c.id is null or not marketing_private.actor_allowed(j.actor_employee_id,c.organization_id,c.brand_id,'marketing_ads.view') then raise exception using errcode='42501',message='Ad synchronization scope changed.';end if;
 select to_jsonb(c)||jsonb_build_object('sealed_token',s.sealed_token,'meta_user_id',s.meta_user_id) into result from marketing_private.credentials s where s.connection_id=c.id and s.sealed_token is not null;
 if result is null then raise exception 'Ad authorization unavailable.';end if;return result;
end;$$;
create function public.marketing_ads_finish(p_job uuid,p_lease uuid,p_report jsonb,p_error text default null) returns void language plpgsql security definer set search_path=public as $$
declare j marketing_private.ads_sync_jobs;c public.marketing_connections;
begin
 select * into j from marketing_private.ads_sync_jobs where id=p_job and lease=p_lease and state='leased' for update;
 if j.id is null then raise exception 'Synchronization lease changed.';end if;
 begin perform public.marketing_ads_material(p_job,p_lease);exception when others then update marketing_private.ads_sync_jobs set state='cancelled',error_code='authorization_changed',lease=null,lease_until=null where id=j.id;return;end;
 select * into c from public.marketing_connections where id=j.connection_id for update;
 if p_error is not null then
 update marketing_private.ads_sync_jobs set state=case when attempts>=4 or p_error in ('meta_permission_or_token_invalid','ads_read_not_granted','ad_account_identity_mismatch','ad_authorizer_changed') then 'failed' else 'retry' end,error_code=left(p_error,100),retry_at=now()+interval '5 minutes',lease=null,lease_until=null where id=j.id;
 update marketing_private.ads_accounts set sync_error=left(p_error,100),read_verified=false,manage_verified=false where connection_id=c.id;return;
 end if;
 if p_report is null or p_report->'account'->>'id' is distinct from c.provider_account_id or length(p_report::text)>3000000 then raise exception 'Invalid advertising evidence.';end if;
 insert into marketing_private.ads_snapshots values(c.id,c.credential_generation,j.date_from,j.date_to,now(),p_report)
 on conflict(connection_id,generation,date_from,date_to) do update set observed_at=now(),payload=excluded.payload;
 update marketing_private.ads_accounts set currency=p_report->'account'->>'currency',timezone=p_report->'account'->>'timezone',account_status=(p_report->'account'->>'account_status')::integer,tasks=p_report->'account'->'tasks',read_verified=true,manage_verified=coalesce((p_report->'account'->>'manage_verified')::boolean,false),checked_at=now(),sync_error=null where connection_id=c.id;
 update public.marketing_connections set last_synced_at=now(),last_checked_at=now(),error_code=null where id=c.id;
 update marketing_private.ads_sync_jobs set state='succeeded',completed_at=now(),lease=null,lease_until=null,error_code=null where id=j.id;
end;$$;
-- Deleting/revoking a credential erases all Ads projections; replay already revokes canonical grant credentials.
create function marketing_private.ads_credential_removed() returns trigger language plpgsql security definer set search_path=public as $$ begin
 delete from marketing_private.ads_snapshots where connection_id=old.connection_id;
 delete from marketing_private.ads_accounts where connection_id=old.connection_id;
 update marketing_private.ads_sync_jobs set state='cancelled',error_code='authorization_removed',lease=null,lease_until=null where connection_id=old.connection_id;
 return old;
end;$$;
create trigger ads_credential_removed after delete on marketing_private.credentials for each row execute function marketing_private.ads_credential_removed();
-- Restore replay can encounter historical grants after a later reconnect. Erase only that generation.
do $$ declare body text; begin
 select pg_get_functiondef('public.marketing_privacy_replay(jsonb)'::regprocedure) into body;
 body:=replace(body,'delete from public.marketing_social_posts where connection_id=connection.id and connection_generation=(grant_item->>''generation'')::int;',
 'delete from public.marketing_social_posts where connection_id=connection.id and connection_generation=(grant_item->>''generation'')::int; delete from marketing_private.ads_snapshots where connection_id=connection.id and generation=(grant_item->>''generation'')::int;');
 execute body;
end $$;
revoke all on function marketing_private.ads_credential_removed() from public,anon,authenticated,service_role;
revoke all on function public.marketing_ads_begin(uuid,uuid,text),public.marketing_ads_pending(uuid,uuid),public.marketing_ads_read(uuid,uuid,date,date),public.marketing_ads_request_sync(uuid,date,date) from public,anon;
grant execute on function public.marketing_ads_begin(uuid,uuid,text),public.marketing_ads_pending(uuid,uuid),public.marketing_ads_read(uuid,uuid,date,date),public.marketing_ads_request_sync(uuid,date,date) to authenticated;
revoke all on function public.marketing_ads_stage(uuid,text,jsonb,jsonb),public.marketing_ads_session(uuid,uuid),public.marketing_ads_bind(uuid,uuid,text,uuid,jsonb,timestamptz,jsonb,integer),public.marketing_ads_claim(),public.marketing_ads_material(uuid,uuid),public.marketing_ads_finish(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.marketing_ads_stage(uuid,text,jsonb,jsonb),public.marketing_ads_session(uuid,uuid),public.marketing_ads_bind(uuid,uuid,text,uuid,jsonb,timestamptz,jsonb,integer),public.marketing_ads_claim(),public.marketing_ads_material(uuid,uuid),public.marketing_ads_finish(uuid,uuid,jsonb,text) to service_role;

-- The canonical Disconnect action uses the independent Ads permission for Ads only.
do $$ declare body text;begin
 select pg_get_functiondef('public.marketing_meta_disconnect(uuid)'::regprocedure) into body;
 body:=replace(body,'''marketing_settings.configure''','case c.channel when ''ad_account'' then ''marketing_ads.connect'' else ''marketing_settings.configure'' end');execute body;
end $$;
create function marketing_private.ads_subject_removed() returns trigger language plpgsql security definer set search_path=public as $$ begin
 delete from marketing_private.ads_snapshots where connection_id=old.connection_id and generation=old.generation;
 update marketing_private.ads_sync_jobs set state='cancelled',error_code='authorization_removed',lease=null,lease_until=null where connection_id=old.connection_id and generation=old.generation;
 return old;
end;$$;
revoke all on function marketing_private.ads_subject_removed() from public,anon,authenticated,service_role;
create trigger ads_subject_removed after delete on marketing_private.meta_subjects for each row execute function marketing_private.ads_subject_removed();
