-- Organization-wide Ads authority is narrower than generic null-brand access.
create function marketing_private.ads_org_allowed(p_actor uuid,p_org uuid,p_permission text) returns boolean
language sql stable security definer set search_path=public as $$
select exists(select 1 from employees e join roles r on r.id=e.role_id
join organization_memberships m on m.employee_id=e.id and m.organization_id=p_org
where e.id=p_actor and e.is_active and e.enable_system_login and e.access_state='active' and r.is_active
and (lower(r.name) in ('owner','admin') or (
(select count(distinct p.code) from role_permissions rp join permissions p on p.id=rp.permission_id where rp.role_id=r.id and p.code in ('marketing_workspace.access',p_permission))=2
and exists(select 1 from marketing_role_scopes s where s.organization_id=p_org and s.role_id=r.id and s.all_brands)))); $$;
revoke all on function marketing_private.ads_org_allowed(uuid,uuid,text) from public,anon,authenticated;
create table marketing_private.ads_discovery_reports (
session_id uuid not null references marketing_private.oauth_sessions(id) on delete cascade,
account_id text not null check(account_id ~ '^[0-9]{1,30}$'), organization_id uuid not null references public.organizations(id),
actor_employee_id uuid not null references public.employees(id), observed_at timestamptz not null default now(), payload jsonb not null,
primary key(session_id,account_id));
alter table marketing_private.ads_discovery_reports enable row level security;
create function public.marketing_ads_preview_session(p_session uuid,p_auth_user uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare s jsonb;
begin
s:=public.marketing_ads_session(p_session,p_auth_user);
if not marketing_private.ads_org_allowed((s->>'actor_employee_id')::uuid,(s->>'organization_id')::uuid,'marketing_ads.connect') then raise exception using errcode='42501',message='Organization advertising access required.';end if;
return s;end;$$;
create function public.marketing_ads_preview_finish(p_session uuid,p_auth_user uuid,p_account text,p_report jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare s jsonb;
begin
s:=public.marketing_ads_preview_session(p_session,p_auth_user);
if not exists(select 1 from jsonb_array_elements(s->'accounts') a where a->>'id'=p_account) or p_report#>>'{account,id}'<>p_account or octet_length(p_report::text)>3000000 then raise exception 'Invalid discovery report';end if;
insert into marketing_private.ads_discovery_reports(session_id,account_id,organization_id,actor_employee_id,payload)
values(p_session,p_account,(s->>'organization_id')::uuid,(s->>'actor_employee_id')::uuid,p_report)
on conflict(session_id,account_id) do update set payload=excluded.payload,observed_at=now();
end;$$;
create function public.marketing_ads_discovery_read(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=marketing_private.require_access(p_org,null,'marketing_ads.view');result jsonb;
begin
if not marketing_private.ads_org_allowed(actor,p_org,'marketing_ads.view') then raise exception using errcode='42501',message='Organization advertising access required.';end if;
select coalesce(jsonb_agg(jsonb_build_object('account_id',account_id,'observed_at',observed_at,'payload',payload)),'[]') into result from marketing_private.ads_discovery_reports where organization_id=p_org and actor_employee_id=actor;
return result;end;$$;
revoke all on function public.marketing_ads_preview_session(uuid,uuid),public.marketing_ads_preview_finish(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.marketing_ads_preview_session(uuid,uuid),public.marketing_ads_preview_finish(uuid,uuid,text,jsonb) to service_role;
revoke all on function public.marketing_ads_discovery_read(uuid) from public,anon;
grant execute on function public.marketing_ads_discovery_read(uuid) to authenticated;
-- Block the superseded brand-owned binding path immediately; organization ownership follows separately.
create or replace function public.marketing_ads_bind(p_session uuid,p_auth_user uuid,p_account text,p_brand uuid,p_sealed jsonb,p_expiry timestamptz,p_account_evidence jsonb,p_expected_generation integer) returns jsonb
language plpgsql security definer set search_path=public as $$begin raise exception using errcode='42501',message='Brand-owned Ad Account binding is unavailable. Shared accounts require organization ownership.';end;$$;
