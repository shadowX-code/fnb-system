-- Meta OAuth state and credentials remain private; browsers receive account metadata only.
alter table public.marketing_connections add column account_name text,
 add column connected_by uuid references public.employees(id),
 add column credential_generation integer not null default 0,
 add column connected_at timestamptz, add column last_checked_at timestamptz;
create unique index marketing_connection_account on public.marketing_connections(channel,provider_account_id) where provider_account_id is not null;
alter table marketing_private.credentials add column sealed_token jsonb,
 add column meta_user_id text, add column expires_at timestamptz;
alter table public.marketing_jobs add column connection_id uuid references public.marketing_connections(id),
 add column connection_generation integer, add column external_authorized_at timestamptz,
 add column provider_state jsonb not null default '{}';
create table marketing_private.oauth_sessions (
 id uuid primary key default gen_random_uuid(), state_hash text not null unique,
 organization_id uuid not null, brand_id uuid not null, actor_employee_id uuid not null references public.employees(id),
 redirect_uri text not null, expires_at timestamptz not null default now()+interval '10 minutes',
 consumed_at timestamptz, meta_user_id text, sealed_discovery jsonb, accounts jsonb not null default '[]',
 foreign key(organization_id,brand_id) references public.brands(organization_id,id)
);
create table marketing_private.meta_subjects (
 connection_id uuid references public.marketing_connections(id), generation integer not null,
 meta_user_id text not null, connected_at timestamptz not null default now(), primary key(connection_id,generation)
);
alter table marketing_private.meta_subjects enable row level security;
revoke all on marketing_private.meta_subjects from public,anon,authenticated;
create table marketing_private.meta_deletions (
 confirmation_hash text primary key, completed_at timestamptz not null default now()
);
alter table marketing_private.oauth_sessions enable row level security;
alter table marketing_private.meta_deletions enable row level security;
revoke all on marketing_private.oauth_sessions,marketing_private.meta_deletions from public,anon,authenticated;

create function marketing_private.actor_allowed(p_actor uuid,p_org uuid,p_brand uuid,p_permission text) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.employees e join public.roles r on r.id=e.role_id
 join public.organization_memberships m on m.employee_id=e.id and m.organization_id=p_org
 where e.id=p_actor and e.is_active and e.enable_system_login and e.access_state='active' and r.is_active
 and exists(select 1 from public.brands b where b.id=p_brand and b.organization_id=p_org)
 and (lower(r.name) in ('owner','admin') or (
 (select count(distinct p.code) from public.role_permissions rp join public.permissions p on p.id=rp.permission_id
 where rp.role_id=r.id and p.code in ('marketing_workspace.access',p_permission))=2
 and exists(select 1 from public.marketing_role_scopes s where s.organization_id=p_org and s.role_id=r.id
 and (s.all_brands or exists(select 1 from public.marketing_role_brands rb where rb.organization_id=p_org and rb.role_id=r.id and rb.brand_id=p_brand))))));
$$;
revoke all on function marketing_private.actor_allowed(uuid,uuid,uuid,text) from public,anon,authenticated;

create function public.marketing_meta_begin(p_org uuid,p_brand uuid,p_state_hash text,p_redirect_uri text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare actor uuid:=marketing_private.require_access(p_org,p_brand,'marketing_settings.configure'); s marketing_private.oauth_sessions;
begin
 if p_brand is null or coalesce(p_state_hash,'') !~ '^[a-f0-9]{64}$'
 or p_redirect_uri<>'https://ujkzdaaadnvcfayuldmh.supabase.co/functions/v1/marketing-meta/callback' then raise exception 'Invalid Meta authorization request.';end if;
 if (select count(*) from marketing_private.oauth_sessions where actor_employee_id=actor and expires_at>now())>=10 then raise exception 'Too many pending connections. Try again later.';end if;
 insert into marketing_private.oauth_sessions(state_hash,organization_id,brand_id,actor_employee_id,redirect_uri)
 values(p_state_hash,p_org,p_brand,actor,p_redirect_uri) returning * into s;
 return jsonb_build_object('id',s.id,'expires_at',s.expires_at);
end;$$;
create function public.marketing_meta_consume(p_state_hash text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare s marketing_private.oauth_sessions;
begin
 select * into s from marketing_private.oauth_sessions where state_hash=p_state_hash for update;
 if not found or s.consumed_at is not null or s.expires_at<=now() then raise exception using errcode='42501',message='Meta authorization expired or was already used.';end if;
 if not marketing_private.actor_allowed(s.actor_employee_id,s.organization_id,s.brand_id,'marketing_settings.configure') then raise exception using errcode='42501',message='Meta authorization scope was revoked.';end if;
 update marketing_private.oauth_sessions set consumed_at=now() where id=s.id;
 return jsonb_build_object('id',s.id,'organization_id',s.organization_id,'brand_id',s.brand_id,'actor_employee_id',s.actor_employee_id,'redirect_uri',s.redirect_uri);
end;$$;
create function public.marketing_meta_stage(p_session uuid,p_user_id text,p_sealed jsonb,p_accounts jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare s marketing_private.oauth_sessions;
begin
 select * into s from marketing_private.oauth_sessions where id=p_session for update;
 if not found or s.consumed_at is null or s.expires_at<=now() or s.sealed_discovery is not null
 or not marketing_private.actor_allowed(s.actor_employee_id,s.organization_id,s.brand_id,'marketing_settings.configure')
 or coalesce(p_user_id,'') !~ '^[0-9]+$' or p_sealed is null or jsonb_typeof(p_accounts)<>'array' or jsonb_array_length(p_accounts)>500 then raise exception 'Meta discovery is unavailable.';end if;
 update marketing_private.oauth_sessions set meta_user_id=p_user_id,sealed_discovery=p_sealed,accounts=p_accounts,expires_at=now()+interval '15 minutes' where id=s.id;
end;$$;
create function public.marketing_meta_pending(p_org uuid,p_brand uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=marketing_private.require_access(p_org,p_brand,'marketing_settings.configure'); result jsonb;
begin
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'accounts',accounts,'expires_at',expires_at) order by consumed_at desc),'[]') into result
 from marketing_private.oauth_sessions where organization_id=p_org and brand_id=p_brand and actor_employee_id=actor and expires_at>now() and sealed_discovery is not null;
 return result;
end;$$;
create function public.marketing_meta_session_material(p_session uuid,p_auth_user uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare s marketing_private.oauth_sessions; actor uuid;
begin
 select id into actor from public.employees where auth_user_id=p_auth_user;
 select * into s from marketing_private.oauth_sessions where id=p_session and actor_employee_id=actor;
 if not found or s.expires_at<=now() or s.sealed_discovery is null or not marketing_private.actor_allowed(actor,s.organization_id,s.brand_id,'marketing_settings.configure') then raise exception using errcode='42501',message='Meta account selection is unavailable.';end if;
 return to_jsonb(s)-'state_hash';
end;$$;
create function public.marketing_meta_bind(p_session uuid,p_auth_user uuid,p_account_id text,p_channel text,p_sealed jsonb,p_expiry timestamptz,p_mode text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare s marketing_private.oauth_sessions; a jsonb; c public.marketing_connections; prior public.marketing_connections;
begin
 perform public.marketing_meta_session_material(p_session,p_auth_user);
 select * into s from marketing_private.oauth_sessions where id=p_session for update;
 select value into a from jsonb_array_elements(s.accounts) where value->>'id'=p_account_id and value->>'channel'=p_channel;
 if a is null or p_sealed is null or p_expiry is null or p_expiry<=now() or p_mode not in ('test','production') then raise exception 'Choose a verified Meta account.';end if;
 select * into prior from public.marketing_connections where brand_id=s.brand_id and channel=p_channel for update;
 if prior.id is not null and exists(select 1 from public.marketing_jobs where connection_id=prior.id and state in ('leased','reconciling')) then raise exception 'Resolve pending delivery before replacing this connection.';end if;
 insert into public.marketing_connections(organization_id,brand_id,channel,provider_account_id,account_name,status,capabilities,expires_at,connected_by,connected_at,last_checked_at,credential_generation)
 values(s.organization_id,s.brand_id,p_channel,p_account_id,a->>'name',case p_mode when 'test' then 'test_authorized' else 'production_authorized' end,a->'capabilities',p_expiry,s.actor_employee_id,now(),now(),1)
 on conflict(brand_id,channel) do update set provider_account_id=excluded.provider_account_id,account_name=excluded.account_name,status=excluded.status,capabilities=excluded.capabilities,
 expires_at=excluded.expires_at,connected_by=excluded.connected_by,connected_at=now(),last_checked_at=now(),error_code=null,credential_generation=marketing_connections.credential_generation+1 returning * into c;
 insert into marketing_private.credentials(connection_id,credential_reference,sealed_token,meta_user_id,expires_at)
 values(c.id,'encrypted-meta:'||c.id,p_sealed,s.meta_user_id,p_expiry)
 on conflict(connection_id) do update set credential_reference=excluded.credential_reference,sealed_token=excluded.sealed_token,meta_user_id=excluded.meta_user_id,expires_at=excluded.expires_at;
 update public.marketing_jobs set state='blocked',external_authorized_at=null,error_code='connection_changed',updated_at=now() where connection_id=c.id and state in ('queued','retry','blocked');
 insert into public.marketing_events(organization_id,brand_id,action,actor_employee_id,details) values(c.organization_id,c.brand_id,'meta_connected',s.actor_employee_id,jsonb_build_object('connection_id',c.id,'channel',c.channel,'mode',p_mode,'generation',c.credential_generation));
 insert into marketing_private.meta_subjects(connection_id,generation,meta_user_id) values(c.id,c.credential_generation,s.meta_user_id);
 -- Permit selecting the other channel from the same short-lived discovery, never return tokens.
 return to_jsonb(c);
end;$$;
create function public.marketing_meta_disconnect(p_connection uuid) returns void
language plpgsql security definer set search_path=public as $$
declare c public.marketing_connections; actor uuid;
begin
 select * into c from public.marketing_connections where id=p_connection for update;
 if not found then raise exception 'Connection unavailable.';end if;
 actor:=marketing_private.require_access(c.organization_id,c.brand_id,'marketing_settings.configure');
 delete from marketing_private.credentials where connection_id=c.id;
 update public.marketing_connections set status='not_connected',capabilities='{}',expires_at=null,error_code='disconnected',credential_generation=credential_generation+1 where id=c.id;
 update public.marketing_jobs set state=case when state='leased' then 'reconciling' else state end,error_code='connection_disconnected',updated_at=now() where connection_id=c.id and state not in ('succeeded','failed','cancelled');
 insert into public.marketing_events(organization_id,brand_id,action,actor_employee_id,details) values(c.organization_id,c.brand_id,'meta_disconnected',actor,jsonb_build_object('connection_id',c.id));
end;$$;
create function public.marketing_meta_revoke(p_user_id text,p_deletion boolean,p_confirmation_hash text,p_issued_at timestamptz) returns void
language plpgsql security definer set search_path=public as $$
declare item record;
begin
 if coalesce(p_user_id,'') !~ '^[0-9]+$' or p_issued_at is null or p_issued_at>now()+interval '5 minutes'
 or (p_deletion and coalesce(p_confirmation_hash,'') !~ '^[a-f0-9]{64}$') then raise exception 'Invalid Meta removal request.';end if;
 for item in select x.*,subject.generation subject_generation from public.marketing_connections x join marketing_private.meta_subjects subject on subject.connection_id=x.id
 where subject.meta_user_id=p_user_id and subject.connected_at<=p_issued_at+interval '1 second' for update of x loop
  -- A controlled privacy erasure removes Meta data, preserving FeedX-owned creative revisions.
  update public.marketing_events set details=details-'provider_post_id' where details->>'job_id' in(select id::text from public.marketing_jobs where connection_id=item.id and connection_generation=item.subject_generation);
  update public.marketing_jobs set provider_post_id=null,provider_state='{}',state='cancelled',error_code='meta_data_erased',external_authorized_at=null
  where connection_id=item.id and connection_generation=item.subject_generation;
  if to_regclass('public.marketing_social_posts') is not null then
   execute 'delete from public.marketing_social_posts where connection_id=$1 and connection_generation=$2' using item.id,item.subject_generation;
  end if;
  if item.credential_generation=item.subject_generation then
   delete from marketing_private.credentials where connection_id=item.id;
   update public.marketing_connections set provider_account_id=null,account_name=null,status='not_connected',capabilities='{}',expires_at=null,error_code='meta_authorization_removed',credential_generation=credential_generation+1 where id=item.id;
  end if;
  insert into public.marketing_events(organization_id,brand_id,action,details) values(item.organization_id,item.brand_id,case when p_deletion then 'meta_data_erased' else 'meta_deauthorized' end,jsonb_build_object('connection_id',item.id,'generation',item.subject_generation));
 end loop;
 delete from marketing_private.meta_subjects where meta_user_id=p_user_id and connected_at<=p_issued_at+interval '1 second';
 delete from marketing_private.oauth_sessions where meta_user_id=p_user_id and consumed_at<=p_issued_at+interval '1 second';
 if p_deletion then insert into marketing_private.meta_deletions values(p_confirmation_hash,now()) on conflict do nothing;end if;
end;$$;
create function public.marketing_meta_deletion_status(p_hash text) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('status','completed','completed_at',completed_at) from marketing_private.meta_deletions where confirmation_hash=p_hash;
$$;
create function public.marketing_meta_connection_material(p_connection uuid) returns jsonb
language sql stable security definer set search_path=public as $$
 select to_jsonb(c)||jsonb_build_object('sealed_token',secret.sealed_token,'meta_user_id',secret.meta_user_id)
 from public.marketing_connections c join marketing_private.credentials secret on secret.connection_id=c.id
 where c.id=p_connection and c.status in ('test_authorized','production_authorized') and c.expires_at>now();
$$;
create function public.marketing_meta_housekeeping() returns void language plpgsql security definer set search_path=public as $$
begin
 delete from marketing_private.oauth_sessions where expires_at<now();
 update public.marketing_connections set status='expired',error_code='token_expired',last_checked_at=now() where status in ('test_authorized','production_authorized') and expires_at<=now();
 delete from marketing_private.credentials where expires_at<now()-interval '1 day';
end;$$;
select cron.schedule('feedx_marketing_meta_housekeeping','*/10 * * * *','select public.marketing_meta_housekeeping()');
revoke all on function public.marketing_meta_begin(uuid,uuid,text,text),public.marketing_meta_pending(uuid,uuid),public.marketing_meta_disconnect(uuid) from public,anon,authenticated;
grant execute on function public.marketing_meta_begin(uuid,uuid,text,text),public.marketing_meta_pending(uuid,uuid),public.marketing_meta_disconnect(uuid) to authenticated;
revoke all on function public.marketing_meta_consume(text),public.marketing_meta_stage(uuid,text,jsonb,jsonb),public.marketing_meta_session_material(uuid,uuid),public.marketing_meta_bind(uuid,uuid,text,text,jsonb,timestamptz,text),public.marketing_meta_revoke(text,boolean,text,timestamptz),public.marketing_meta_deletion_status(text),public.marketing_meta_connection_material(uuid),public.marketing_meta_housekeeping() from public,anon,authenticated;
grant execute on function public.marketing_meta_consume(text),public.marketing_meta_stage(uuid,text,jsonb,jsonb),public.marketing_meta_session_material(uuid,uuid),public.marketing_meta_bind(uuid,uuid,text,text,jsonb,timestamptz,text),public.marketing_meta_revoke(text,boolean,text,timestamptz),public.marketing_meta_deletion_status(text),public.marketing_meta_connection_material(uuid),public.marketing_meta_housekeeping() to service_role;
