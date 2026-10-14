-- Shared account ownership; social connections keep their mandatory brand scope.
alter table public.marketing_connections alter column brand_id drop not null;
alter table public.marketing_connections add constraint marketing_connection_owner check ((channel='ad_account' and brand_id is null) or (channel<>'ad_account' and brand_id is not null));
alter table public.marketing_connections add constraint marketing_connection_org foreign key(organization_id) references public.organizations(id);
create unique index marketing_ads_org_slot on public.marketing_connections(organization_id,account_slot) where channel='ad_account';
alter table marketing_private.oauth_sessions alter column brand_id drop not null;
alter table marketing_private.oauth_sessions add constraint marketing_oauth_social_brand check(purpose='ads' or brand_id is not null);
create table marketing_private.ads_campaign_brands (
organization_id uuid not null references public.organizations(id), account_id text not null check(account_id ~ '^[0-9]{1,30}$'),
campaign_id text not null check(campaign_id ~ '^[0-9]{1,30}$'),brand_id uuid,revision integer not null default 1 check(revision>0),
assigned_by uuid not null references public.employees(id),assigned_at timestamptz not null default now(),
primary key(organization_id,account_id,campaign_id),foreign key(organization_id,brand_id) references public.brands(organization_id,id));
alter table marketing_private.ads_campaign_brands enable row level security;
create table marketing_private.ads_attribution_events (
id uuid primary key, organization_id uuid not null references public.organizations(id),account_id text not null,campaign_id text not null,
previous_brand uuid,brand_id uuid,revision integer not null,actor_employee_id uuid not null references public.employees(id),created_at timestamptz not null default now());
alter table marketing_private.ads_attribution_events enable row level security;
create function public.marketing_ads_attribute(p_org uuid,p_account text,p_campaign text,p_brand uuid,p_expected_revision integer,p_request uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare actor uuid:=marketing_private.require_access(p_org,null,'marketing_ads.manage'); m marketing_private.ads_campaign_brands;e marketing_private.ads_attribution_events;
begin
if not marketing_private.ads_org_allowed(actor,p_org,'marketing_ads.manage') then raise exception using errcode='42501',message='Organization advertising management required.';end if;
if p_request is null or p_expected_revision is null or p_expected_revision<0 or (p_brand is not null and not exists(select 1 from brands where id=p_brand and organization_id=p_org)) then raise exception 'Invalid attribution intent';end if;
perform pg_advisory_xact_lock(hashtextextended('ads_attribution:'||p_request::text,0));
select * into e from marketing_private.ads_attribution_events where id=p_request;
if found then
 if e.organization_id<>p_org or e.account_id<>p_account or e.campaign_id<>p_campaign or e.brand_id is distinct from p_brand or e.actor_employee_id<>actor or e.revision<>p_expected_revision+1 then raise exception 'Attribution request changed';end if;
 return to_jsonb(e);
end if;
-- Only reconciled provider campaign identities are eligible; names/AI are not evidence.
if not exists(select 1 from marketing_private.ads_discovery_reports d cross join lateral jsonb_array_elements(d.payload#>'{configs,campaigns}') a where d.organization_id=p_org and d.account_id=p_account and a->>'id'=p_campaign)
and not exists(select 1 from marketing_private.ads_snapshots d join marketing_connections c on c.id=d.connection_id and c.credential_generation=d.generation cross join lateral jsonb_array_elements(d.payload#>'{configs,campaigns}') a where c.organization_id=p_org and c.provider_account_id=p_account and a->>'id'=p_campaign) then raise exception 'Campaign identity not verified';end if;
perform pg_advisory_xact_lock(hashtextextended(p_org::text||':'||p_account||':'||p_campaign,0));
select * into m from marketing_private.ads_campaign_brands where organization_id=p_org and account_id=p_account and campaign_id=p_campaign for update;
if coalesce(m.revision,0)<>p_expected_revision then raise exception 'Attribution changed. Review again.';end if;
insert into marketing_private.ads_attribution_events values(p_request,p_org,p_account,p_campaign,m.brand_id,p_brand,p_expected_revision+1,actor,now()) returning * into e;
insert into marketing_private.ads_campaign_brands values(p_org,p_account,p_campaign,p_brand,p_expected_revision+1,actor,now()) on conflict(organization_id,account_id,campaign_id) do update set brand_id=excluded.brand_id,revision=excluded.revision,assigned_by=excluded.assigned_by,assigned_at=excluded.assigned_at;
return to_jsonb(e);end;$$;
-- Null-brand Ads sessions require organization-wide authority; social checks are unchanged.
create or replace function public.marketing_ads_begin(p_org uuid,p_brand uuid,p_state_hash text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare actor uuid:=marketing_private.require_access(p_org,null,'marketing_ads.connect');s marketing_private.oauth_sessions;
begin
if not marketing_private.ads_org_allowed(actor,p_org,'marketing_ads.connect') or p_brand is not null then raise exception using errcode='42501',message='Choose organization-owned account access.';end if;
if coalesce(p_state_hash,'') !~ '^[a-f0-9]{64}$' then raise exception 'Invalid authorization intent';end if;
if (select count(*) from marketing_private.oauth_sessions where actor_employee_id=actor and expires_at>now())>=10 then raise exception 'Too many pending connections';end if;
insert into marketing_private.oauth_sessions(state_hash,organization_id,brand_id,actor_employee_id,redirect_uri,purpose) values(p_state_hash,p_org,null,actor,'https://ujkzdaaadnvcfayuldmh.supabase.co/functions/v1/marketing-meta/callback','ads') returning * into s;
return jsonb_build_object('id',s.id,'expires_at',s.expires_at);end;$$;
do $$ declare f text;begin
select pg_get_functiondef('public.marketing_meta_consume(text)'::regprocedure) into f;
f:=replace(f, 'not marketing_private.actor_allowed(s.actor_employee_id,s.organization_id,s.brand_id,case s.purpose when ''ads'' then ''marketing_ads.connect'' else ''marketing_settings.configure'' end)', 'not (case when s.purpose=''ads'' then marketing_private.ads_org_allowed(s.actor_employee_id,s.organization_id,''marketing_ads.connect'') else marketing_private.actor_allowed(s.actor_employee_id,s.organization_id,s.brand_id,''marketing_settings.configure'') end)');execute f;
select pg_get_functiondef('public.marketing_ads_stage(uuid,text,jsonb,jsonb)'::regprocedure) into f;
f:=replace(f,'marketing_private.actor_allowed(s.actor_employee_id,s.organization_id,s.brand_id,''marketing_ads.connect'')','marketing_private.ads_org_allowed(s.actor_employee_id,s.organization_id,''marketing_ads.connect'')');execute f;
select pg_get_functiondef('public.marketing_ads_session(uuid,uuid)'::regprocedure) into f;
f:=replace(f,'marketing_private.actor_allowed(actor,s.organization_id,s.brand_id,''marketing_ads.connect'')','marketing_private.ads_org_allowed(actor,s.organization_id,''marketing_ads.connect'')');execute f;
select pg_get_functiondef('public.marketing_ads_material(uuid,uuid)'::regprocedure) into f;
f:=replace(f,'marketing_private.actor_allowed(j.actor_employee_id,c.organization_id,c.brand_id,''marketing_ads.view'')','marketing_private.ads_org_allowed(j.actor_employee_id,c.organization_id,''marketing_ads.view'')');execute f;
select pg_get_functiondef('public.marketing_ads_request_sync(uuid,date,date)'::regprocedure) into f;
f:=replace(f,'actor:=marketing_private.require_access(c.organization_id,c.brand_id,''marketing_ads.view'');','actor:=marketing_private.require_access(c.organization_id,null,''marketing_ads.view''); if not marketing_private.ads_org_allowed(actor,c.organization_id,''marketing_ads.view'') then raise exception using errcode=''42501'',message=''Organization advertising access required.'';end if;');execute f;
select pg_get_functiondef('public.marketing_meta_disconnect(uuid)'::regprocedure) into f;
f:=replace(f,'actor:=marketing_private.require_access(', 'if c.channel=''ad_account'' and not marketing_private.ads_org_allowed(marketing_private.actor(),c.organization_id,''marketing_ads.connect'') then raise exception using errcode=''42501'',message=''Organization advertising access required.'';end if; actor:=marketing_private.require_access(');execute f;
end $$;
create or replace function public.marketing_ads_pending(p_org uuid,p_brand uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=marketing_private.require_access(p_org,null,'marketing_ads.connect');result jsonb;
begin
if not marketing_private.ads_org_allowed(actor,p_org,'marketing_ads.connect') then return '[]';end if;
select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'expires_at',s.expires_at,'accounts',(select coalesce(jsonb_agg(a||jsonb_build_object('available',not exists(select 1 from marketing_connections c where c.channel='ad_account' and c.provider_account_id=a->>'id' and c.organization_id<>p_org))),'[]') from jsonb_array_elements(s.accounts) a))),'[]') into result from marketing_private.oauth_sessions s where purpose='ads' and organization_id=p_org and actor_employee_id=actor and expires_at>now() and sealed_discovery is not null and selected_at is null;
return result;end;$$;
create or replace function public.marketing_ads_bind(p_session uuid,p_auth_user uuid,p_account text,p_brand uuid,p_sealed jsonb,p_expiry timestamptz,p_account_evidence jsonb,p_expected_generation integer) returns jsonb
language plpgsql security definer set search_path=public as $$
declare s marketing_private.oauth_sessions;c public.marketing_connections;a jsonb;
begin
 perform public.marketing_ads_preview_session(p_session,p_auth_user);
 select * into s from marketing_private.oauth_sessions where id=p_session for update;
 if s.selected_at is not null or p_brand is not null or p_sealed is null or p_expiry<=now() or p_expiry is null then raise exception 'Selection changed or expired.';end if;
 select value into a from jsonb_array_elements(s.accounts) where value->>'id'=p_account;
 if a is null or p_account_evidence->>'id' is distinct from p_account or p_account_evidence->>'read_verified' is distinct from 'true' then raise exception 'Choose a verified Ad Account.';end if;
 perform pg_advisory_xact_lock(hashtextextended('meta_ad_account:'||p_account,0));
 select * into c from public.marketing_connections where channel='ad_account' and (provider_account_id=p_account) for update;
 if c.id is not null and (c.organization_id<>s.organization_id or c.credential_generation is distinct from p_expected_generation) then raise exception 'Account ownership or connection changed.';end if;
 if c.id is null and p_expected_generation is not null then raise exception 'Connection changed.';end if;
 if c.id is null then
 insert into public.marketing_connections(organization_id,brand_id,channel,account_slot,provider_account_id,account_name,status,capabilities,expires_at,connected_by,connected_at,credential_generation)
 values(s.organization_id,null,'ad_account',p_account,p_account,a->>'name','test_authorized',jsonb_build_object('execution_enabled',false),p_expiry,s.actor_employee_id,now(),1) returning * into c;
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

create function marketing_private.ads_project(p_org uuid,p_account text,p_payload jsonb,p_brand uuid,p_org_access boolean) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare campaigns jsonb;adsets jsonb;ads jsonb;insights jsonb:='{}';k text;v jsonb; attribution jsonb;
begin
select coalesce(jsonb_agg(a||jsonb_build_object('feedx_brand_id',m.brand_id,'feedx_attribution_revision',coalesce(m.revision,0))),'[]') into campaigns from jsonb_array_elements(p_payload#>'{configs,campaigns}') a left join marketing_private.ads_campaign_brands m on m.organization_id=p_org and m.account_id=p_account and m.campaign_id=a->>'id' where (p_org_access and p_brand is null) or (m.brand_id is not null and (p_brand is null or m.brand_id=p_brand) and marketing_private.brand_allowed(p_org,m.brand_id));
select coalesce(jsonb_agg(a),'[]') into adsets from jsonb_array_elements(p_payload#>'{configs,adsets}') a where exists(select 1 from jsonb_array_elements(campaigns) c where c->>'id'=a->>'campaign_id');
select coalesce(jsonb_agg(a),'[]') into ads from jsonb_array_elements(p_payload#>'{configs,ads}') a where exists(select 1 from jsonb_array_elements(campaigns) c where c->>'id'=a->>'campaign_id');
for k,v in select * from jsonb_each(p_payload->'insights') loop
if k in ('account','daily') then insights:=insights||jsonb_build_object(k,case when p_org_access and p_brand is null then v else '[]'::jsonb end);
else insights:=insights||jsonb_build_object(k,(select coalesce(jsonb_agg(a),'[]') from jsonb_array_elements(v) a where exists(select 1 from jsonb_array_elements(campaigns) c where c->>'id'=a->>'campaign_id')));end if;
end loop;
return p_payload||jsonb_build_object('configs',jsonb_build_object('campaigns',campaigns,'adsets',adsets,'ads',ads),'insights',insights,'scope',case when p_org_access and p_brand is null then 'organization' else 'attributed_campaigns' end);
end;$$;
create or replace function public.marketing_ads_read(p_org uuid,p_brand uuid default null,p_from date default current_date-29,p_to date default current_date) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=marketing_private.require_access(p_org,p_brand,'marketing_ads.view');org_access boolean:=marketing_private.ads_org_allowed(actor,p_org,'marketing_ads.view');accounts jsonb;reports jsonb;jobs jsonb;
begin
if p_from is null or p_to is null or p_to<p_from or p_to-p_from>93 then raise exception 'Select up to 94 days';end if;
select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'brand_id',null,'account_id',c.provider_account_id,'name',c.account_name,'status',c.status,'expires_at',c.expires_at,'generation',c.credential_generation,'last_synced_at',c.last_synced_at,'error_code',c.error_code,'health',case when a.generation=c.credential_generation then to_jsonb(a)-'connection_id' else null end)),'[]') into accounts from marketing_connections c left join marketing_private.ads_accounts a on a.connection_id=c.id where c.organization_id=p_org and c.channel='ad_account' and (org_access or exists(select 1 from marketing_private.ads_campaign_brands m where m.organization_id=p_org and m.account_id=c.provider_account_id and m.brand_id is not null and (p_brand is null or m.brand_id=p_brand) and marketing_private.brand_allowed(p_org,m.brand_id)));
select coalesce(jsonb_agg(jsonb_build_object('connection_id',s.connection_id,'date_from',s.date_from,'date_to',s.date_to,'observed_at',s.observed_at,'payload',marketing_private.ads_project(p_org,c.provider_account_id,s.payload,p_brand,org_access))),'[]') into reports from marketing_private.ads_snapshots s join marketing_connections c on c.id=s.connection_id and c.credential_generation=s.generation where c.organization_id=p_org and s.date_from=p_from and s.date_to=p_to and c.status in ('test_authorized','production_authorized') and c.expires_at>now() and exists(select 1 from jsonb_array_elements(accounts) a where a->>'id'=c.id::text);
select case when org_access then coalesce(jsonb_agg(to_jsonb(j)-array['lease','lease_until','actor_employee_id']),'[]') else '[]' end into jobs from marketing_private.ads_sync_jobs j join marketing_connections c on c.id=j.connection_id and c.credential_generation=j.generation where c.organization_id=p_org and j.date_from=p_from and j.date_to=p_to and j.created_at>now()-interval '1 day';
return jsonb_build_object('accounts',accounts,'reports',reports,'jobs',jobs,'organization_access',org_access,'external_execution_enabled',false);end;$$;
revoke all on function marketing_private.ads_project(uuid,text,jsonb,uuid,boolean) from public,anon,authenticated;
revoke all on function public.marketing_ads_attribute(uuid,text,text,uuid,integer,uuid) from public,anon;
grant execute on function public.marketing_ads_attribute(uuid,text,text,uuid,integer,uuid) to authenticated;
-- Discovery reviews apply the current internal attribution revision, without changing Meta evidence.
create or replace function public.marketing_ads_discovery_read(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=marketing_private.require_access(p_org,null,'marketing_ads.view');result jsonb;
begin
if not marketing_private.ads_org_allowed(actor,p_org,'marketing_ads.view') then raise exception using errcode='42501',message='Organization advertising access required.';end if;
select coalesce(jsonb_agg(jsonb_build_object('account_id',account_id,'observed_at',observed_at,'payload',marketing_private.ads_project(p_org,account_id,payload,null,true))),'[]') into result from marketing_private.ads_discovery_reports where organization_id=p_org and actor_employee_id=actor;
return result;end;$$;
