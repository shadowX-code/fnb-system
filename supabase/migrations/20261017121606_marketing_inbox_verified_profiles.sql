-- Minimal replaceable provider projection; never customer-master identity or message authority.
create table marketing_private.inbox_profiles (
 conversation_id uuid primary key references public.marketing_conversations(id) on delete cascade,
 connection_id uuid not null references marketing_private.credentials(connection_id) on delete cascade,
 peer_hash text not null, generation integer not null, verified_generation integer,
 profile jsonb not null default '{}', observed_at timestamptz,
 attempted_at timestamptz, refresh_after timestamptz not null default now(), failures integer not null default 0,
 diagnostic jsonb not null default '{}', lease uuid, lease_until timestamptz, lease_actor uuid
);
alter table marketing_private.inbox_profiles enable row level security;
revoke all on marketing_private.inbox_profiles from public,anon,authenticated,service_role;
create index inbox_profiles_due on marketing_private.inbox_profiles(refresh_after);

-- Called only inside already authorized read models or service profile authorities.
create function marketing_private.inbox_profile(p_conversation uuid) returns jsonb
language sql stable security definer set search_path=public as $$
 select p.profile || jsonb_build_object('available',p.observed_at is not null and p.verified_generation=p.generation,'source','meta_user_profile','observed_at',p.observed_at,'attempted_at',p.attempted_at,'diagnostic',p.diagnostic)
 from marketing_private.inbox_profiles p join public.marketing_conversations c on c.id=p.conversation_id
 join public.marketing_connections conn on conn.id=c.connection_id
 where c.id=p_conversation and p.connection_id=c.connection_id and p.generation=c.connection_generation and p.generation=conn.credential_generation and (p.observed_at is null or p.verified_generation=p.generation)
 and p.peer_hash=encode(extensions.digest(c.connection_id::text||':'||c.participant_key,'sha256'),'hex')
 and coalesce((marketing_private.inbox_channel(conn.id)->>'receiving_verified')::boolean,false)
$$;
revoke all on function marketing_private.inbox_profile(uuid) from public,anon,authenticated,service_role;

-- UI and worker share the same material authority, identity key, lease and backoff.
create function public.marketing_inbox_profile_claim(p_conversation uuid,p_auth_user uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare m jsonb; p marketing_private.inbox_profiles; fingerprint text; ticket uuid;
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='Service only.';end if;
 m:=public.marketing_inbox_profile_material(p_conversation,p_auth_user);
 if not coalesce((marketing_private.inbox_channel((m#>>'{connection,id}')::uuid)->>'receiving_verified')::boolean,false) then raise exception 'Profile authorization unavailable.';end if;
 fingerprint:=encode(extensions.digest((m#>>'{connection,id}')||':'||(m->>'peer'),'sha256'),'hex');
 insert into marketing_private.inbox_profiles(conversation_id,connection_id,peer_hash,generation)
 values(p_conversation,(m#>>'{connection,id}')::uuid,fingerprint,(m->>'generation')::integer) on conflict do nothing;
 select * into p from marketing_private.inbox_profiles where conversation_id=p_conversation for update;
 if p.connection_id is distinct from (m#>>'{connection,id}')::uuid or p.peer_hash<>fingerprint then
  -- Same record with a changed provider identity must never inherit the previous person's name.
  update marketing_private.inbox_profiles set connection_id=(m#>>'{connection,id}')::uuid,peer_hash=fingerprint,profile='{}',observed_at=null,verified_generation=null,generation=(m->>'generation')::integer,refresh_after=now(),lease=null,lease_until=null,failures=0 where conversation_id=p_conversation;
 elsif p.generation<>(m->>'generation')::integer then
  -- Preserve previous verified fields privately, but suppress until the current grant verifies them.
  update marketing_private.inbox_profiles set generation=(m->>'generation')::integer,refresh_after=now(),lease=null,lease_until=null where conversation_id=p_conversation;
 end if;
 select * into p from marketing_private.inbox_profiles where conversation_id=p_conversation;
 if p.refresh_after>now() or p.lease_until>now() then return jsonb_build_object('profile',marketing_private.inbox_profile(p_conversation));end if;
 ticket:=gen_random_uuid();
 update marketing_private.inbox_profiles set lease=ticket,lease_until=now()+interval '30 seconds',lease_actor=p_auth_user,refresh_after=now()+interval '5 minutes' where conversation_id=p_conversation;
 return jsonb_build_object('material',m,'lease',ticket);
end;$$;
revoke all on function public.marketing_inbox_profile_claim(uuid,uuid) from public,anon,authenticated;
grant execute on function public.marketing_inbox_profile_claim(uuid,uuid) to service_role;

create function public.marketing_inbox_profile_next() returns jsonb
language plpgsql security definer set search_path=public as $$
declare candidate record; result jsonb;
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='Service only.';end if;
 for candidate in
  select c.id,e.auth_user_id from public.marketing_conversations c
  left join marketing_private.inbox_profiles p on p.conversation_id=c.id
  join lateral (select e.auth_user_id from public.organization_memberships om join public.employees e on e.id=om.employee_id
   where om.organization_id=c.organization_id and e.auth_user_id is not null and marketing_private.actor_allowed(e.id,c.organization_id,c.brand_id,'marketing_inbox.view') order by e.id limit 1) e on true
  where c.channel in ('facebook','instagram') and c.medium='dm' and c.last_inbound_at is not null
  and coalesce(p.refresh_after,'-infinity')<=now() and coalesce(p.lease_until,'-infinity')<=now()
  order by p.attempted_at nulls first,c.last_inbound_at desc limit 20
 loop
  begin result:=public.marketing_inbox_profile_claim(candidate.id,candidate.auth_user_id);
   if result ? 'lease' then return result||jsonb_build_object('conversation_id',candidate.id);end if;
  exception when others then null; -- One revoked/ineligible peer must not block other Brands.
  end;
 end loop;
 return null;
end;$$;
revoke all on function public.marketing_inbox_profile_next() from public,anon,authenticated;
grant execute on function public.marketing_inbox_profile_next() to service_role;

create function public.marketing_inbox_profile_finish(p_conversation uuid,p_lease uuid,p_generation integer,p_profile jsonb,p_diagnostic jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare p marketing_private.inbox_profiles; m jsonb; verified boolean;
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='Service only.';end if;
 if p_profile is null or p_diagnostic is null or jsonb_typeof(p_profile)<>'object' or jsonb_typeof(p_diagnostic)<>'object' or length(p_profile::text)>5000 or length(p_diagnostic::text)>2200 then raise exception 'Invalid profile projection.';end if;
 if exists(select 1 from jsonb_object_keys(p_profile) k where k not in ('display_name','handle','avatar_url','source','available')) then raise exception 'Invalid profile fields.';end if;
 if exists(select 1 from jsonb_object_keys(p_diagnostic) k where k not in ('status','reason','http_status','graph_code','graph_subcode','message','fbtrace_id','graph_version')) then raise exception 'Invalid diagnostic fields.';end if;
 if exists(select 1 from jsonb_each(p_profile) x where x.key in ('display_name','handle') and x.value<>'null'::jsonb and (jsonb_typeof(x.value)<>'string' or length(x.value#>>'{}')>160)) then raise exception 'Invalid profile text.';end if;
 if p_profile->>'avatar_url' is not null and (length(p_profile->>'avatar_url')>2048 or p_profile->>'avatar_url' !~ '^https://([A-Za-z0-9-]+\.)*(fbcdn\.net|cdninstagram\.com|fbsbx\.com)/' or p_profile->>'avatar_url' ~* '(access_token|appsecret_proof|#|@)') then raise exception 'Invalid profile avatar.';end if;
 select * into p from marketing_private.inbox_profiles where conversation_id=p_conversation for update;
 if p.lease is distinct from p_lease or p.lease_until<=now() then raise exception 'Profile lease expired.';end if;
 m:=public.marketing_inbox_profile_material(p_conversation,p.lease_actor);
 if (m->>'generation')::integer<>p_generation or p.connection_id<>(m#>>'{connection,id}')::uuid or p.peer_hash<>encode(extensions.digest((m#>>'{connection,id}')||':'||(m->>'peer'),'sha256'),'hex') or not coalesce((marketing_private.inbox_channel(p.connection_id)->>'receiving_verified')::boolean,false) then raise exception 'Profile identity changed.';end if;
 verified:=p_diagnostic->>'status'='resolved' and (nullif(p_profile->>'display_name','') is not null or nullif(p_profile->>'handle','') is not null or nullif(p_profile->>'avatar_url','') is not null);
 update marketing_private.inbox_profiles set
  profile=case when verified then profile||jsonb_strip_nulls(p_profile-'available'-'source') else profile end,
  observed_at=case when verified then now() else observed_at end,
  verified_generation=case when verified then p_generation else verified_generation end,
  attempted_at=now(),diagnostic=p_diagnostic,
  failures=case when verified then 0 else least(failures+1,5) end,
  refresh_after=now()+case when verified then interval '1 day' when p_diagnostic->>'status'='denied' then interval '1 day' else interval '1 hour'*least(power(2,failures)::integer,24) end,
  lease=null,lease_until=null,lease_actor=null where conversation_id=p_conversation;
 return marketing_private.inbox_profile(p_conversation);
end;$$;
revoke all on function public.marketing_inbox_profile_finish(uuid,uuid,integer,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.marketing_inbox_profile_finish(uuid,uuid,integer,jsonb,jsonb) to service_role;

-- Extend the existing authorized projections without replacing their filters, timeline or send authority.
do $migration$
declare d text; needle text;
begin
 d:=pg_get_functiondef('public.marketing_inbox_read(uuid,uuid,text,text,text,integer,integer,text,boolean)'::regprocedure);
 needle:='c.id,c.organization_id,c.brand_id,b.name brand_name';
 if position(needle in d)=0 then raise exception 'Unexpected Inbox list definition.';end if;
 execute replace(d,needle,'c.id,marketing_private.inbox_profile(c.id) customer_profile,c.organization_id,c.brand_id,b.name brand_name');
 d:=pg_get_functiondef('public.marketing_inbox_detail(uuid,integer,integer)'::regprocedure);
 needle:=$needle$'conversation',to_jsonb(c)-'participant_key'$needle$;
 if position(needle in d)=0 then raise exception 'Unexpected Inbox detail definition.';end if;
 execute replace(d,needle,$needle$'conversation',(to_jsonb(c)-'participant_key')||jsonb_build_object('customer_profile',marketing_private.inbox_profile(c.id))$needle$);
end;$migration$;
