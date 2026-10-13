-- Assert migration preserves every existing active member/Brand relationship.
create temporary table member_brand_access_before on commit drop as
select m.employee_id,m.organization_id,b.id brand_id from public.organization_memberships m
join public.employees e on e.id=m.employee_id join public.roles r on r.id=e.role_id
join public.brands b on b.organization_id=m.organization_id
where e.auth_user_id is not null and e.is_active and e.enable_system_login and e.access_state='active' and r.is_active
and (lower(r.name) in ('owner','admin') or exists(select 1 from public.marketing_role_scopes s where s.organization_id=m.organization_id and s.role_id=e.role_id
and (s.all_brands or exists(select 1 from public.marketing_role_brands rb where rb.organization_id=m.organization_id and rb.role_id=e.role_id and rb.brand_id=b.id))));
-- Platform owns member Brand scope. Canonical Roles continue to own actions.
create schema if not exists platform_private;
revoke all on schema platform_private from public, anon, authenticated;
create table public.platform_member_brand_scopes (
 organization_id uuid not null, employee_id uuid not null,
 all_brands boolean not null default false, revision integer not null default 1 check(revision>0),
 updated_at timestamptz not null default now(), updated_by uuid references public.employees(id),
 primary key(organization_id,employee_id),
 foreign key(organization_id,employee_id) references public.organization_memberships(organization_id,employee_id) on delete cascade
);
create table public.platform_member_brands (
 organization_id uuid not null, employee_id uuid not null, brand_id uuid not null,
 primary key(organization_id,employee_id,brand_id),
 foreign key(organization_id,employee_id) references public.platform_member_brand_scopes(organization_id,employee_id) on delete cascade,
 foreign key(organization_id,brand_id) references public.brands(organization_id,id)
);
create index platform_member_brands_brand on public.platform_member_brands(organization_id,brand_id,employee_id);
alter table public.platform_member_brand_scopes enable row level security;
alter table public.platform_member_brands enable row level security;
-- No direct client writes or reads: scope projections/changes use trusted commands.
revoke all on public.platform_member_brand_scopes,public.platform_member_brands from public,anon,authenticated;
grant all on public.platform_member_brand_scopes,public.platform_member_brands to service_role;
insert into public.platform_member_brand_scopes(organization_id,employee_id,all_brands)
 select m.organization_id,m.employee_id,coalesce(s.all_brands,false)
 from public.organization_memberships m join public.employees e on e.id=m.employee_id
 left join public.marketing_role_scopes s on s.organization_id=m.organization_id and s.role_id=e.role_id;
insert into public.platform_member_brands(organization_id,employee_id,brand_id)
 select m.organization_id,m.employee_id,rb.brand_id from public.organization_memberships m
 join public.employees e on e.id=m.employee_id join public.marketing_role_brands rb
 on rb.organization_id=m.organization_id and rb.role_id=e.role_id;
create function platform_private.seed_member_scope() returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into public.platform_member_brand_scopes(organization_id,employee_id) values(new.organization_id,new.employee_id) on conflict do nothing;
 return new;
end;$$;
revoke all on function platform_private.seed_member_scope() from public,anon,authenticated;
create trigger platform_member_brand_scope_added after insert on public.organization_memberships for each row execute function platform_private.seed_member_scope();
create function platform_private.member_all_brands_allowed(p_actor uuid,p_org uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.employees e join public.roles r on r.id=e.role_id
 join public.organization_memberships m on m.employee_id=e.id and m.organization_id=p_org
 where e.id=p_actor and e.auth_user_id is not null and e.is_active and e.enable_system_login and e.access_state='active' and r.is_active
 and (lower(r.name) in ('owner','admin') or exists(select 1 from public.platform_member_brand_scopes s where s.organization_id=p_org and s.employee_id=e.id and s.all_brands)));
$$;
create function platform_private.member_brand_allowed(p_actor uuid,p_org uuid,p_brand uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.brands b where b.id=p_brand and b.organization_id=p_org)
 and (platform_private.member_all_brands_allowed(p_actor,p_org) or exists(
 select 1 from public.employees e join public.roles r on r.id=e.role_id
 join public.organization_memberships m on m.employee_id=e.id and m.organization_id=p_org
 join public.platform_member_brands mb on mb.employee_id=e.id and mb.organization_id=p_org and mb.brand_id=p_brand
 where e.id=p_actor and e.auth_user_id is not null and e.is_active and e.enable_system_login and e.access_state='active' and r.is_active));
$$;
revoke all on function platform_private.member_brand_allowed(uuid,uuid,uuid),platform_private.member_all_brands_allowed(uuid,uuid) from public,anon,authenticated;
create or replace function marketing_private.brand_allowed(p_org uuid,p_brand uuid) returns boolean language sql stable security definer set search_path=public as $$
 select platform_private.member_brand_allowed(marketing_private.actor(),p_org,p_brand);
$$;
create or replace function marketing_private.all_brands_allowed(p_org uuid) returns boolean language sql stable security definer set search_path=public as $$
 select platform_private.member_all_brands_allowed(marketing_private.actor(),p_org);
$$;
create or replace function marketing_private.actor_allowed(p_actor uuid,p_org uuid,p_brand uuid,p_permission text) returns boolean language sql stable security definer set search_path=public as $$
 select platform_private.member_brand_allowed(p_actor,p_org,p_brand) and exists(
 select 1 from public.employees e join public.roles r on r.id=e.role_id where e.id=p_actor
 and (lower(r.name) in ('owner','admin') or
 not exists(select 1 from unnest(array['marketing_workspace.access',p_permission]) required(code)
 where not exists(select 1 from public.role_permissions rp join public.permissions p on p.id=rp.permission_id where rp.role_id=r.id and p.code=required.code))));
$$;
create or replace function marketing_private.ads_org_allowed(p_actor uuid,p_org uuid,p_permission text) returns boolean language sql stable security definer set search_path=public as $$
 select platform_private.member_all_brands_allowed(p_actor,p_org) and exists(
 select 1 from public.employees e join public.roles r on r.id=e.role_id where e.id=p_actor
 and (lower(r.name) in ('owner','admin') or
 not exists(select 1 from unnest(array['marketing_workspace.access',p_permission]) required(code)
 where not exists(select 1 from public.role_permissions rp join public.permissions p on p.id=rp.permission_id where rp.role_id=r.id and p.code=required.code))));
$$;
create or replace function marketing_private.creative_assignee_allowed(p_org uuid,p_brand uuid,p_employee uuid) returns boolean language sql stable security definer set search_path=public as $$
 select p_employee is null or platform_private.member_brand_allowed(p_employee,p_org,p_brand);
$$;
-- Retain legacy evidence, but prevent old clients from changing every member through a Role.
create or replace function public.marketing_set_role_scope(p_org uuid,p_role uuid,p_all boolean,p_brands uuid[]) returns jsonb language plpgsql security definer set search_path=public as $$
begin raise exception using errcode='42501',message='Brand access is managed per member in Team & Brand Access. Reload before editing.';end;$$;
create function public.platform_member_brand_access(p_org uuid,p_employee uuid,p_brands uuid[],p_expected_revision integer,p_request uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=marketing_private.require_access(p_org,null,'marketing_settings.configure'); s public.platform_member_brand_scopes; target_role text;ids uuid[];before_ids uuid[]; previous_all boolean; fp text;prior public.marketing_requests;result jsonb;
begin
 if not public.current_user_has_permission('platform_organizations.manage') then raise exception using errcode='42501',message='Team access management permission is required.';end if;
 if p_employee=actor then raise exception using errcode='42501',message='You cannot change your own Brand access.';end if;
 if p_request is null or p_brands is null or cardinality(p_brands)>500 or array_position(p_brands,null) is not null then raise exception 'Choose valid Brands and a save request.';end if;
 select coalesce(array_agg(distinct id order by id),'{}') into ids from unnest(p_brands) id;
 fp:=md5(jsonb_build_array(p_org,p_employee,ids,p_expected_revision)::text);
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 select * into prior from public.marketing_requests where request_id=p_request;
 if found then
  if prior.actor_employee_id<>actor or prior.fingerprint<>fp then raise exception 'Save request changed. Reload and try again.';end if;
  return prior.result;
 end if;
 perform 1 from public.organizations where id=p_org for update;
 perform marketing_private.require_access(p_org,null,'marketing_settings.configure');
 -- Serialize membership removal, role reassignment and access editing.
 perform 1 from public.organization_memberships where organization_id=p_org and employee_id=p_employee for update;
 if not found then raise exception using errcode='42501',message='Team member is unavailable.';end if;
 select r.name into target_role from public.employees e join public.roles r on r.id=e.role_id where e.id=p_employee for update of e;
 if lower(target_role) in ('owner','admin') then raise exception using errcode='42501',message='Owner/Admin Brand access is inherited and cannot be restricted here.';end if;
 select * into s from public.platform_member_brand_scopes where organization_id=p_org and employee_id=p_employee for update;
 if s.revision is distinct from p_expected_revision then raise exception using errcode='40001',message='Member access changed. Reload and review before saving.';end if;
 if s.all_brands and not marketing_private.all_brands_allowed(p_org) or exists(select 1 from public.platform_member_brands mb where mb.organization_id=p_org and mb.employee_id=p_employee and not marketing_private.brand_allowed(p_org,mb.brand_id))
 or exists(select 1 from unnest(ids) id where not marketing_private.brand_allowed(p_org,id)) then raise exception using errcode='42501',message='Member assignment exceeds your Brand access.';end if;
 if exists(select 1 from unnest(ids) id join public.brands b on b.id=id where not b.is_active and not(s.all_brands or exists(select 1 from public.platform_member_brands mb where mb.organization_id=p_org and mb.employee_id=p_employee and mb.brand_id=id))) then raise exception 'Inactive Brands cannot be assigned for new operations.';end if;
 select coalesce(array_agg(brand_id order by brand_id),'{}') into before_ids from public.platform_member_brands where organization_id=p_org and employee_id=p_employee;
 previous_all:=s.all_brands;
 if not s.all_brands and ids=before_ids then return jsonb_build_object('revision',s.revision,'brand_ids',ids,'unchanged',true);end if;
 update public.platform_member_brand_scopes set all_brands=false,revision=revision+1,updated_at=now(),updated_by=actor where organization_id=p_org and employee_id=p_employee returning * into s;
 delete from public.platform_member_brands where organization_id=p_org and employee_id=p_employee and not(brand_id=any(ids));
 insert into public.platform_member_brands select p_org,p_employee,unnest(ids) on conflict do nothing;
 insert into public.marketing_events(organization_id,action,actor_employee_id,details) values(p_org,'platform_member_brand_access_saved',actor,jsonb_build_object('employee_id',p_employee,'previous_all_brands',previous_all,'before',before_ids,'after',ids,'revision',s.revision,'request_id',p_request));
 result:=jsonb_build_object('revision',s.revision,'brand_ids',ids);
 insert into public.marketing_requests values(p_request,actor,fp,result);
 return result;
end;$$;
revoke all on function public.platform_member_brand_access(uuid,uuid,uuid[],integer,uuid) from public,anon;
grant execute on function public.platform_member_brand_access(uuid,uuid,uuid[],integer,uuid) to authenticated;
create function public.platform_team_brand_access(p_org uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=marketing_private.require_access(p_org,null,'marketing_settings.view');members jsonb;options jsonb;
begin
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',e.full_name,'role_id',r.id,'role_name',r.name,
 'all_brands',platform_private.member_all_brands_allowed(e.id,p_org),'revision',s.revision,
 'brand_ids',coalesce((select jsonb_agg(b.id order by b.name) from public.brands b where b.organization_id=p_org and platform_private.member_brand_allowed(e.id,p_org,b.id) and marketing_private.brand_allowed(p_org,b.id)),'[]'),
 'restricted_scope',exists(select 1 from public.brands b where b.organization_id=p_org and platform_private.member_brand_allowed(e.id,p_org,b.id) and not marketing_private.brand_allowed(p_org,b.id)),
 'editable',e.id<>actor and lower(r.name) not in ('owner','admin') and public.current_user_has_permission('platform_organizations.manage') and public.current_user_has_permission('marketing_settings.configure')
 and not(s.all_brands and not marketing_private.all_brands_allowed(p_org)) and not exists(select 1 from public.platform_member_brands mb where mb.organization_id=p_org and mb.employee_id=e.id and not marketing_private.brand_allowed(p_org,mb.brand_id)),
 'permission_codes',coalesce((select jsonb_agg(p.code order by p.code) from public.role_permissions rp join public.permissions p on p.id=rp.permission_id where rp.role_id=r.id and p.code like 'marketing_%'),'[]')) order by e.full_name),'[]') into members
 from public.organization_memberships m join public.employees e on e.id=m.employee_id join public.roles r on r.id=e.role_id
 join public.platform_member_brand_scopes s on s.organization_id=m.organization_id and s.employee_id=m.employee_id
 where m.organization_id=p_org and (e.id=actor or public.current_user_has_permission('platform_organizations.manage') and (marketing_private.all_brands_allowed(p_org) or exists(select 1 from public.brands b where b.organization_id=p_org and marketing_private.brand_allowed(p_org,b.id) and platform_private.member_brand_allowed(e.id,p_org,b.id))));
 if public.current_user_has_permission('platform_organizations.manage') and public.current_user_has_permission('employees.view') then
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',e.full_name) order by e.full_name),'[]') into options from public.employees e
 where marketing_private.employee_visible(e.id) and e.auth_user_id is not null and e.enable_system_login and e.access_state='active' and e.is_active
 and not exists(select 1 from public.organization_memberships m where m.employee_id=e.id);
 end if;
 return jsonb_build_object('members',members,'employees',coalesce(options,'[]'));
end;$$;
revoke all on function public.platform_team_brand_access(uuid) from public,anon;
grant execute on function public.platform_team_brand_access(uuid) to authenticated;
create function public.marketing_access_fingerprint() returns text language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=marketing_private.actor();result text;
begin
 if not public.current_user_has_permission('marketing_workspace.access') then raise exception using errcode='42501',message='Marketing access is unavailable.';end if;
 select md5(jsonb_build_array(e.role_id,r.name,r.is_active,(select jsonb_agg(p.code order by p.code) from public.role_permissions rp join public.permissions p on p.id=rp.permission_id where rp.role_id=e.role_id),
 (select jsonb_agg(jsonb_build_array(m.organization_id,s.revision,s.all_brands) order by m.organization_id) from public.organization_memberships m join public.platform_member_brand_scopes s using(organization_id,employee_id) where m.employee_id=actor),
 (select jsonb_agg(jsonb_build_array(b.id,b.revision,b.is_active) order by b.id) from public.brands b where platform_private.member_brand_allowed(actor,b.organization_id,b.id)))::text) into result from public.employees e join public.roles r on r.id=e.role_id where e.id=actor;
 return result;
end;$$;
revoke all on function public.marketing_access_fingerprint() from public,anon;
grant execute on function public.marketing_access_fingerprint() to authenticated;

do $$begin
 if exists((select * from member_brand_access_before except select m.employee_id,m.organization_id,b.id from public.organization_memberships m join public.brands b on b.organization_id=m.organization_id where platform_private.member_brand_allowed(m.employee_id,m.organization_id,b.id))
 union all (select m.employee_id,m.organization_id,b.id from public.organization_memberships m join public.brands b on b.organization_id=m.organization_id where platform_private.member_brand_allowed(m.employee_id,m.organization_id,b.id) except select * from member_brand_access_before)) then raise exception 'Member Brand migration changed effective access.';end if;
end;$$;
-- Tenant-wide Drive management cannot bypass a restricted member Brand scope.
create or replace function marketing_private.drive_admin(p_actor uuid,p_org uuid) returns boolean language sql stable security definer set search_path=public as $$
 select platform_private.member_all_brands_allowed(p_actor,p_org) and exists(select 1 from public.employees e join public.roles r on r.id=e.role_id where e.id=p_actor
 and (lower(r.name) in ('owner','admin') or (select count(distinct p.code) from public.role_permissions rp join public.permissions p on p.id=rp.permission_id where rp.role_id=r.id and p.code in ('marketing_workspace.access','marketing_settings.configure','platform_organizations.manage'))=3));
$$;
CREATE OR REPLACE FUNCTION public.marketing_setup_options(p_org uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare actor uuid:=marketing_private.require_access(p_org,null,'marketing_settings.view'); outlets jsonb; employees jsonb; roles jsonb; members jsonb;
begin
 if public.current_user_has_permission('platform_organizations.manage') then
   select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'name',o.name) order by o.name),'[]') into outlets from public.outlets o
   where o.is_active and public.current_user_can_access_outlet(o.id) and not exists(select 1 from public.organization_outlets m where m.outlet_id=o.id and m.organization_id<>p_org);
   if public.current_user_has_permission('employees.view') then
     select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',e.full_name) order by e.full_name),'[]') into employees from public.employees e
     where marketing_private.employee_visible(e.id) and e.auth_user_id is not null and e.enable_system_login and e.access_state='active' and e.is_active
     and not exists(select 1 from public.organization_memberships m where m.employee_id=e.id and m.organization_id<>p_org);
   end if;
   select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',e.full_name,'role_id',e.role_id) order by e.full_name),'[]') into members
   from public.organization_memberships m join public.employees e on e.id=m.employee_id where m.organization_id=p_org;
 end if;
 if public.current_user_has_permission('roles.view') and public.current_user_has_permission('roles.edit') and public.current_user_has_permission('marketing_settings.configure') then
   select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'name',r.name) order by r.name),'[]') into roles from public.roles r where r.is_active and lower(r.name) not in ('owner','admin');
 end if;
 members:=public.platform_team_brand_access(p_org)->'members';
 return jsonb_build_object('outlets',coalesce(outlets,'[]'),'employees',coalesce(employees,'[]'),'roles',coalesce(roles,'[]'),'members',coalesce(members,'[]'));
end; $function$;

CREATE OR REPLACE FUNCTION public.marketing_read(p_org uuid, p_brand uuid, p_surface text, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_page integer DEFAULT 1, p_page_size integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare actor uuid; permission text; rows jsonb; total integer; summary jsonb; assets jsonb; jobs jsonb; knowledge jsonb; connections jsonb; events jsonb; scopes jsonb;
begin
 permission:=case p_surface when 'overview' then 'marketing_overview.view' when 'content' then 'marketing_content.view' when 'calendar' then 'marketing_calendar.view' when 'analytics' then 'marketing_analytics.view' when 'settings' then 'marketing_settings.view' end;
 if permission is null or p_page<1 or p_page_size not in (20,50,100) or p_page is null or p_page_size is null then raise exception 'Choose a valid view and page.'; end if;
 actor:=marketing_private.require_access(p_org,p_brand,permission);
 if p_surface='calendar' and (p_from is null or p_to is null or p_to<=p_from or p_to-p_from>interval '42 days') then raise exception 'Choose a calendar range up to 42 days.'; end if;
 if p_surface in ('overview','analytics') then
   select jsonb_build_object('draft',count(*) filter(where status='draft'),'review',count(*) filter(where status='review'),
    'approved',count(*) filter(where status='approved'),'scheduled',count(*) filter(where status='scheduled'),'published',count(*) filter(where status='published'),
    'failed',count(*) filter(where status='failed'),'cancelled',count(*) filter(where status='cancelled'),'rejected',count(*) filter(where status='rejected')) into summary
   from public.marketing_content where organization_id=p_org and (p_brand is null or brand_id=p_brand) and marketing_private.brand_allowed(p_org,brand_id);
 end if;
 if p_surface in ('overview','content','calendar') then
   select count(*) into total from public.marketing_content c where c.organization_id=p_org and (p_brand is null or c.brand_id=p_brand) and marketing_private.brand_allowed(p_org,c.brand_id)
   and (p_surface<>'calendar' or (c.scheduled_at>=p_from and c.scheduled_at<p_to));
   select coalesce(jsonb_agg(row),'[]') into rows from (
     select to_jsonb(c)||jsonb_build_object('payload',r.payload,'brand_name',b.name) row from public.marketing_content c
     join public.marketing_content_revisions r on r.content_id=c.id and r.revision=c.revision join public.brands b on b.id=c.brand_id
     where c.organization_id=p_org and (p_brand is null or c.brand_id=p_brand) and marketing_private.brand_allowed(p_org,c.brand_id)
     and (p_surface<>'calendar' or (c.scheduled_at>=p_from and c.scheduled_at<p_to))
     order by case when p_surface='calendar' then c.scheduled_at end,c.updated_at desc,c.id limit p_page_size offset (p_page-1)*p_page_size
   )x;
 end if;
 if p_surface='content' and public.current_user_has_permission('marketing_content.view') then
   select coalesce(jsonb_agg(to_jsonb(x)),'[]') into assets from (select a.* from public.marketing_assets a where organization_id=p_org and (p_brand is null or brand_id=p_brand) and state='ready' and marketing_private.brand_allowed(p_org,brand_id) order by created_at desc,id limit p_page_size offset (p_page-1)*p_page_size)x;
 end if;
 if p_surface in ('overview','content','calendar','analytics') then
   select coalesce(jsonb_agg(to_jsonb(x)),'[]') into jobs from (select j.id,j.content_id,j.revision,j.brand_id,j.channel,j.state,j.due_at,j.attempts,j.provider_post_id,j.error_code,j.updated_at
   from public.marketing_jobs j where j.organization_id=p_org and (p_brand is null or j.brand_id=p_brand) and marketing_private.brand_allowed(p_org,j.brand_id)
   and (p_surface in ('overview','analytics') or j.content_id in (select (r->>'id')::uuid from jsonb_array_elements(coalesce(rows,'[]')) r))
   order by j.updated_at desc,j.id limit case when p_surface in ('content','calendar') then p_page_size*2 else 100 end)x;
 end if;
 if p_surface='settings' then
   select coalesce(jsonb_agg(to_jsonb(k)),'[]') into knowledge from public.marketing_knowledge k join public.brands b on b.id=k.brand_id where b.organization_id=p_org and (p_brand is null or b.id=p_brand) and marketing_private.brand_allowed(p_org,b.id);
   select coalesce(jsonb_agg(jsonb_build_object('brand_id',b.id,'channel',ch,'status',coalesce(c.status,'not_connected'),'capabilities',coalesce(c.capabilities,'{}'),'expires_at',c.expires_at,'last_synced_at',c.last_synced_at,'error_code',c.error_code)),'[]') into connections
   from public.brands b cross join unnest(array['facebook','instagram']) ch left join public.marketing_connections c on c.brand_id=b.id and c.channel=ch
   where b.organization_id=p_org and (p_brand is null or b.id=p_brand) and marketing_private.brand_allowed(p_org,b.id);

 end if;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into events from (select id,brand_id,content_id,action,actor_employee_id,details,created_at from public.marketing_events where organization_id=p_org
 and (p_brand is null or brand_id=p_brand) and (brand_id is not null and marketing_private.brand_allowed(p_org,brand_id) or brand_id is null and marketing_private.all_brands_allowed(p_org)) order by created_at desc,id desc limit 20)x;
 return jsonb_build_object('rows',coalesce(rows,'[]'),'total',coalesce(total,0),'summary',summary,'assets',coalesce(assets,'[]'),'jobs',coalesce(jobs,'[]'),'knowledge',coalesce(knowledge,'[]'),'connections',coalesce(connections,'[]'),'role_scopes',coalesce(scopes,'[]'),'events',events,
 'capabilities',jsonb_build_object('oauth',false,'publishing',false,'social_insights',false,'ai',false,'inbox',false,'whatsapp',false,'ads',false),
 'evidence',jsonb_build_object('social_performance','unavailable','conversions','unavailable','ai_usage','unavailable'));
end; $function$;


CREATE OR REPLACE FUNCTION public.platform_organization_command(p_command text, p_org uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare actor uuid:=marketing_private.actor(); org uuid:=p_org; brand uuid; outlet uuid; employee uuid; target_role uuid; timezone_name text;before_state jsonb;after_state jsonb;current_brand public.brands;request uuid;prior public.marketing_requests;fp text;result jsonb;selected_outlets uuid[];
begin
 if not public.current_user_has_permission('platform_organizations.manage') then raise exception using errcode='42501',message='Organization management permission is required.'; end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>65536 then raise exception 'Invalid organization request.';end if;
 if p_command<>'create_organization' and not marketing_private.member(org) then raise exception using errcode='42501',message='Organization access is unavailable.';end if;
 if p_command in ('save_brand','set_brand_status') then
 request:=nullif(p_payload->>'request_id','')::uuid;fp:=md5(jsonb_build_array(p_command,p_org,p_payload)::text);
 if request is not null then
 perform pg_advisory_xact_lock(hashtextextended(request::text,0));select * into prior from public.marketing_requests where request_id=request;
 if found then if prior.actor_employee_id<>actor or prior.fingerprint<>fp then raise exception 'Retry changed. Use a new request.';end if;return prior.result;end if;end if;
 end if;
 if p_command='create_organization' then
   insert into public.organizations(name) values(trim(p_payload->>'name')) returning id into org;
   insert into public.organization_memberships values(org,actor);
 else
   if not marketing_private.member(org) then raise exception using errcode='42501',message='Organization access is unavailable.'; end if;
   perform 1 from public.organizations where id=org for update;
   if p_command in ('save_brand','set_brand_status') then
     brand:=nullif(p_payload->>'id','')::uuid;
     if brand is not null then
       select * into current_brand from public.brands where id=brand and organization_id=org for update;
       if not found then raise exception using errcode='42501',message='Brand is unavailable in this organization.';end if;
       if current_brand.revision is distinct from (p_payload->>'expected_revision')::integer then raise exception using errcode='40001',message='Brand changed. Reload and review before saving.';end if;
       before_state:=to_jsonb(current_brand)||jsonb_build_object('outlet_ids',(select coalesce(jsonb_agg(outlet_id order by outlet_id),'[]') from public.brand_outlets where brand_id=brand));
     end if;
     if p_command='set_brand_status' then
       if brand is null or jsonb_typeof(p_payload->'is_active')<>'boolean' or coalesce((p_payload->>'confirmed')::boolean,false)<>true then raise exception 'Confirm the Brand status impact before saving.';end if;
       update public.brands set is_active=(p_payload->>'is_active')::boolean,revision=revision+1,updated_at=now() where id=brand;
     else
       timezone_name:=coalesce(p_payload->>'timezone','Asia/Kuala_Lumpur');
       if not exists(select 1 from pg_timezone_names where name=timezone_name) then raise exception 'Choose a valid timezone.';end if;
       if jsonb_typeof(coalesce(p_payload->'outlet_ids','[]'))<>'array' then raise exception 'Choose valid outlet targets.';end if;
       select coalesce(array_agg(distinct value::uuid order by value::uuid),'{}') into selected_outlets from jsonb_array_elements_text(coalesce(p_payload->'outlet_ids','[]'));
       if (brand is null and cardinality(selected_outlets)>0 or brand is not null and selected_outlets is distinct from array(select outlet_id from public.brand_outlets where brand_id=brand order by outlet_id)) and coalesce((p_payload->>'mapping_confirmed')::boolean,false)<>true then raise exception 'Review and confirm added and removed outlets.';end if;
       if exists(select 1 from public.brand_outlets bo where bo.brand_id=brand and not(bo.outlet_id=any(selected_outlets)) and not public.current_user_can_access_outlet(bo.outlet_id)) then raise exception using errcode='42501',message='Outlet removal exceeds your outlet access.';end if;
       for outlet in select unnest(selected_outlets) loop
         if not public.current_user_can_access_outlet(outlet) or not exists(select 1 from public.outlets where id=outlet)
         or (not exists(select 1 from public.brand_outlets bo where bo.brand_id=brand and bo.outlet_id=outlet) and not exists(select 1 from public.outlets where id=outlet and is_active))
         or exists(select 1 from public.organization_outlets where outlet_id=outlet and organization_id<>org) then raise exception using errcode='42501',message='Outlet is unavailable or belongs to another organization.';end if;
       end loop;
       if brand is null then insert into public.brands(organization_id,name,timezone) values(org,trim(p_payload->>'name'),timezone_name) returning id into brand;
       else update public.brands set name=trim(p_payload->>'name'),timezone=timezone_name,revision=revision+1,updated_at=now() where id=brand;end if;
       insert into public.organization_outlets select org,unnest(selected_outlets) on conflict do nothing;
       if exists(select 1 from unnest(selected_outlets) oid where not exists(select 1 from public.organization_outlets where organization_id=org and outlet_id=oid)) then raise exception 'Outlet ownership changed. Reload and review.';end if;
       delete from public.brand_outlets where brand_id=brand and not (outlet_id=any(selected_outlets));
       insert into public.brand_outlets select org,brand,unnest(selected_outlets) on conflict do nothing;
     end if;
     select to_jsonb(b)||jsonb_build_object('outlet_ids',(select coalesce(jsonb_agg(outlet_id order by outlet_id),'[]') from public.brand_outlets where brand_id=brand)) into after_state from public.brands b where b.id=brand;
   elsif p_command='add_member' then
     if not marketing_private.all_brands_allowed(org) then raise exception using errcode='42501',message='Adding team members requires full managed Brand scope.';end if;
     if not public.current_user_has_permission('employees.view') then raise exception using errcode='42501',message='Employee visibility is required.'; end if;
     employee:=(p_payload->>'employee_id')::uuid;
     if not marketing_private.employee_visible(employee) then raise exception using errcode='42501',message='Employee is outside your visibility scope.'; end if;
     if not exists(select 1 from public.employees where id=employee and auth_user_id is not null and enable_system_login and access_state='active' and is_active) then raise exception 'Choose an active FeedX employee.'; end if;
     insert into public.organization_memberships values(org,employee) on conflict do nothing;
   elsif p_command='remove_member' then
     if not marketing_private.all_brands_allowed(org) then raise exception using errcode='42501',message='Removing team access requires full managed Brand scope.';end if;
     employee:=(p_payload->>'employee_id')::uuid;
     if employee=actor then raise exception 'You cannot remove your own organization access.'; end if;
     delete from public.organization_memberships where organization_id=org and employee_id=employee;
   else raise exception 'Unknown organization action.';
   end if;
 end if;
 insert into public.marketing_events(organization_id,brand_id,action,actor_employee_id,details) values(org,brand,'platform_'||p_command,actor,jsonb_build_object('employee_id',employee,'before',before_state,'after',after_state,'request_id',request));
 result:=jsonb_build_object('organization_id',org,'brand_id',brand,'brand',after_state);
 if request is not null then insert into public.marketing_requests values(request,actor,fp,result);end if;
 return result;
 exception when unique_violation then raise exception using errcode='23505',message='A Brand with this name already exists in this organization.';
end; $function$;

