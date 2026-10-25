-- Reporting observations retain their original generation; continuity proves access, not freshness.
create table marketing_private.ads_grant_continuity (
 connection_id uuid not null references public.marketing_connections(id) on delete cascade,
 generation integer not null, source_generation integer not null,
 organization_id uuid not null, account_id text not null, meta_user_id text not null,
 verified_at timestamptz not null default now(),
 primary key(connection_id,generation,source_generation),
 foreign key(connection_id,generation) references marketing_private.meta_subjects(connection_id,generation) on delete cascade,
 foreign key(connection_id,source_generation) references marketing_private.meta_subjects(connection_id,generation) on delete cascade,
 check(source_generation>0 and generation>source_generation)
);
alter table marketing_private.ads_grant_continuity enable row level security;
revoke all on marketing_private.ads_grant_continuity from public,anon,authenticated,service_role;

create function marketing_private.ads_visible_snapshots(p_connection uuid)
returns setof marketing_private.ads_snapshots language sql stable security definer set search_path=public as $$
 select distinct on(s.date_from,s.date_to) s.*
 from marketing_private.ads_snapshots s
 join marketing_connections c on c.id=s.connection_id
 join marketing_private.ads_accounts a on a.connection_id=c.id and a.generation=c.credential_generation and a.read_verified
 join marketing_private.credentials k on k.connection_id=c.id and k.sealed_token is not null
 join marketing_private.meta_subjects subject on subject.connection_id=c.id and subject.generation=c.credential_generation and subject.meta_user_id=k.meta_user_id
 where c.id=p_connection and c.channel='ad_account' and c.status in ('test_authorized','production_authorized') and c.expires_at>now()
 and s.payload#>>'{account,id}'=c.provider_account_id
 and (s.generation=c.credential_generation or exists(
  select 1 from marketing_private.ads_grant_continuity g where g.connection_id=c.id and g.generation=c.credential_generation and g.source_generation=s.generation
   and g.organization_id=c.organization_id and g.account_id=c.provider_account_id and g.meta_user_id=k.meta_user_id))
 order by s.date_from,s.date_to,s.observed_at desc,s.generation desc;
$$;
revoke all on function marketing_private.ads_visible_snapshots(uuid) from public,anon,authenticated,service_role;

-- The wrapper records only the dedicated management configuration; it reuses canonical OAuth state/authority.
alter table marketing_private.oauth_sessions add column ads_management_config_id text check(ads_management_config_id ~ '^[0-9]{1,30}$');
create function public.marketing_ads_management_begin(p_org uuid,p_state_hash text,p_config_id text)
returns uuid language plpgsql security definer set search_path=public as $$
declare session_id uuid;
begin
 if coalesce(p_config_id,'') !~ '^[0-9]{1,30}$' then raise exception 'Dedicated Ads Management login is not configured.';end if;
 session_id:=public.marketing_ads_begin(p_org,null,p_state_hash);
 update marketing_private.oauth_sessions set ads_management_config_id=p_config_id where id=session_id;
 return session_id;
end;$$;
revoke all on function public.marketing_ads_management_begin(uuid,text,text) from public,anon;
grant execute on function public.marketing_ads_management_begin(uuid,text,text) to authenticated;

-- No automatic activation and no client-facing permit action. Existing runtime/fingerprint gates still apply.
alter table marketing_private.ads_changes add column paused_create_expires_at timestamptz;
create function public.marketing_ads_execution_preflight(p_request uuid,p_auth_user uuid,p_fingerprint text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare r marketing_private.ads_changes; actor uuid;
begin
 select id into actor from employees where auth_user_id=p_auth_user;
 select * into r from marketing_private.ads_changes where id=p_request and fingerprint=p_fingerprint;
 if r.id is null or not marketing_private.actor_allowed(actor,r.organization_id,r.brand_id,'marketing_ads.execute') or not marketing_private.ads_change_current(r) then
  raise exception using errcode='42501',message='Current advertising execution authority required.';end if;
 return jsonb_build_object('fingerprint',r.fingerprint,'operation',r.operation,'maximum_budget',r.maximum_budget,'paused_create_expires_at',r.paused_create_expires_at,'configuration',r.configuration);
end;$$;
create function public.marketing_ads_paused_create_permit(p_request uuid,p_auth_user uuid,p_fingerprint text,p_generation integer,p_expires_at timestamptz)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r marketing_private.ads_changes; actor uuid;
begin
 select id into actor from employees where auth_user_id=p_auth_user;
 select * into r from marketing_private.ads_changes where id=p_request for update;
 if r.id is null or r.fingerprint is distinct from p_fingerprint or r.generation<>p_generation
  or not marketing_private.actor_allowed(actor,r.organization_id,r.brand_id,'marketing_ads.execute') then
  raise exception using errcode='42501',message='Exact reviewed advertising authority required.';end if;
 if p_expires_at is not null and (r.state<>'approved' or r.operation<>'create' or r.configuration->>'create_contract_version' is distinct from '3'
  or r.configuration?'recovery_source' or r.provider_state<>'{}'::jsonb or exists(select 1 from marketing_private.ads_change_events e where e.change_id=r.id and e.event='paused_create_permit' and e.evidence->>'expires_at' is not null)
  or r.approval_expires_at<=now() or not marketing_private.ads_change_current(r)
  or p_expires_at<=now() or p_expires_at>now()+interval '30 minutes' or p_expires_at>r.approval_expires_at) then
  raise exception 'A fresh approved paused creation requires one non-renewable window up to 30 minutes.';end if;
 update marketing_private.ads_changes set paused_create_expires_at=p_expires_at where id=r.id;
 insert into marketing_private.ads_change_events(change_id,revision,event,actor,evidence) values(r.id,r.revision,'paused_create_permit',actor,
  jsonb_build_object('fingerprint',r.fingerprint,'generation',r.generation,'expires_at',p_expires_at,'scope','create_paused_only'));
 return jsonb_build_object('request',r.id,'expires_at',p_expires_at,'activation_authorized',false);
end;$$;
revoke all on function public.marketing_ads_execution_preflight(uuid,uuid,text),public.marketing_ads_paused_create_permit(uuid,uuid,text,integer,timestamptz) from public,anon,authenticated;
grant execute on function public.marketing_ads_execution_preflight(uuid,uuid,text),public.marketing_ads_paused_create_permit(uuid,uuid,text,integer,timestamptz) to service_role;

-- A pure-read packet: no readiness reservation/event, OAuth state, proposal, or provider mutation.
create function public.marketing_ads_preflight_material(p_auth_user uuid,p_org uuid,p_brand uuid,p_connection uuid,p_page_id text,p_source_job uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor uuid;c marketing_connections;p marketing_connections;source jsonb;credential marketing_private.credentials;
begin
 select id into actor from employees where auth_user_id=p_auth_user;
 if p_brand is null or not marketing_private.actor_allowed(actor,p_org,p_brand,'marketing_ads.manage') then
  raise exception using errcode='42501',message='Brand advertising management required.';end if;
 select * into c from marketing_connections where id=p_connection and organization_id=p_org and brand_id is null and channel='ad_account' and status in ('test_authorized','production_authorized') and expires_at>now();
 select * into p from marketing_connections where organization_id=p_org and brand_id=p_brand and channel='facebook' and provider_account_id=p_page_id and status in ('test_authorized','production_authorized') and expires_at>now();
 select * into credential from marketing_private.credentials where connection_id=c.id and sealed_token is not null;
 if c.id is null or p.id is null or credential.connection_id is null then raise exception 'Current shared Ad Account and Brand Page required.';end if;
 if p_source_job is not null then
  source:=marketing_private.ads_source_post(p_org,p_brand,p_source_job);
  if source is null or source->>'page_id' is distinct from p.provider_account_id then raise exception 'Current Brand source post required.';end if;
 end if;
 return jsonb_build_object('connection',jsonb_build_object('id',c.id,'organization_id',c.organization_id,'brand_id',null,'channel',c.channel,'provider_account_id',c.provider_account_id,'credential_generation',c.credential_generation,'meta_user_id',credential.meta_user_id,'sealed_token',credential.sealed_token),
  'page',jsonb_build_object('id',p.id,'provider_account_id',p.provider_account_id,'credential_generation',p.credential_generation),'source_post',source);
end;$$;
revoke all on function public.marketing_ads_preflight_material(uuid,uuid,uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.marketing_ads_preflight_material(uuid,uuid,uuid,uuid,text,uuid) to service_role;

do $migration$
declare f text;old text;
begin
 select pg_get_functiondef('public.marketing_ads_bind(uuid,uuid,text,uuid,jsonb,timestamptz,jsonb,integer)'::regprocedure) into f;
 old:='declare s marketing_private.oauth_sessions;c public.marketing_connections;a jsonb;';
 if position(old in f)=0 then raise exception 'Ads bind declaration changed';end if;
 f:=replace(f,old,old||'previous_generation integer; continuity boolean:=false;');
 old:=' if c.id is null then'||chr(10)||' insert into public.marketing_connections';
 if position(old in f)=0 then raise exception 'Ads bind authority changed';end if;
 f:=replace(f,old,$new$
 if s.ads_management_config_id is not null and not (coalesce(p_account_evidence->'granted_scopes','[]'::jsonb) ? 'ads_management') then raise exception 'Meta did not grant ads_management.';end if;
 previous_generation:=c.credential_generation;
 continuity:=c.id is not null and c.status in ('test_authorized','production_authorized')
  and exists(select 1 from marketing_private.credentials k join marketing_private.ads_accounts h on h.connection_id=k.connection_id
   join marketing_private.meta_subjects subject on subject.connection_id=k.connection_id and subject.generation=h.generation and subject.meta_user_id=k.meta_user_id
   where k.connection_id=c.id and k.meta_user_id=s.meta_user_id and h.generation=c.credential_generation and h.read_verified);
 if c.id is null then
 insert into public.marketing_connections$new$);
 old:=' insert into marketing_private.meta_subjects(connection_id,generation,meta_user_id) values(c.id,c.credential_generation,s.meta_user_id);';
 if position(old in f)=0 then raise exception 'Ads grant subject contract changed';end if;
 f:=replace(f,old,old||$new$
 if continuity then
  insert into marketing_private.ads_grant_continuity(connection_id,generation,source_generation,organization_id,account_id,meta_user_id)
  select c.id,c.credential_generation,source_generation,c.organization_id,c.provider_account_id,s.meta_user_id from(
   select previous_generation source_generation union
   select g.source_generation from marketing_private.ads_grant_continuity g where g.connection_id=c.id and g.generation=previous_generation
    and g.meta_user_id=s.meta_user_id and g.organization_id=c.organization_id and g.account_id=c.provider_account_id
  )sources;
 end if;
$new$);
 execute f;

 select pg_get_functiondef('public.marketing_ads_read(uuid,uuid,date,date)'::regprocedure) into f;
 old:='from marketing_private.ads_snapshots s join marketing_connections c on c.id=s.connection_id and c.credential_generation=s.generation';
 if position(old in f)=0 then raise exception 'Ads reporting source changed';end if;
 f:=replace(f,old,'from marketing_connections c cross join lateral marketing_private.ads_visible_snapshots(c.id) s');
 f:=replace(f,'''observed_at'',s.observed_at,''payload'',marketing_private.ads_project',
  '''observed_at'',s.observed_at,''observation_generation'',s.generation,''authorization_generation'',c.credential_generation,''payload'',marketing_private.ads_project');
 old:='from marketing_private.ads_snapshots x'||chr(10)||'   where x.connection_id=c.id and x.generation=c.credential_generation';
 if position(old in f)=0 then raise exception 'Ads catalog source changed';end if;
 f:=replace(f,old,'from marketing_private.ads_visible_snapshots(c.id) x where true');
 old:='from marketing_private.ads_snapshots s where s.connection_id=c.id and s.generation=c.credential_generation';
 if position(old in f)=0 then raise exception 'Ads coverage source changed';end if;
 f:=replace(f,old,'from marketing_private.ads_visible_snapshots(c.id) s');
 execute f;

 -- Coalesce completed history after rotation; jobs/checkpoints themselves remain generation-bound.
 select pg_get_functiondef('marketing_private.ads_queue_period(uuid,uuid,date,date,boolean)'::regprocedure) into f;
 old:='from marketing_private.ads_snapshots where connection_id=c.id and generation=c.credential_generation and date_from=p_from and date_to=p_to';
 if position(old in f)=0 then raise exception 'Ads deduplication source changed';end if;
 f:=replace(f,old,'from marketing_private.ads_visible_snapshots(c.id) where date_from=p_from and date_to=p_to');execute f;
 select pg_get_functiondef('public.marketing_ads_schedule(uuid)'::regprocedure) into f;
 old:='from marketing_private.ads_snapshots where connection_id=c.id and generation=c.credential_generation order by observed_at desc limit 1';
 if position(old in f)=0 then raise exception 'Ads historical catalog scheduler changed';end if;
 f:=replace(f,old,'from marketing_private.ads_visible_snapshots(c.id) order by observed_at desc limit 1');execute f;
end;$migration$;
