-- Shared ownership is additive: legal employers and canonical outlets retain their authorities.
create table public.organizations (
 id uuid primary key default gen_random_uuid(), name text not null check(length(trim(name)) between 1 and 120),
 created_at timestamptz not null default now()
);
create table public.organization_memberships (
 organization_id uuid not null references public.organizations(id), employee_id uuid not null references public.employees(id),
 primary key(organization_id,employee_id)
);
create index organization_memberships_employee on public.organization_memberships(employee_id);
create table public.organization_outlets (
 organization_id uuid not null references public.organizations(id), outlet_id uuid not null unique references public.outlets(id),
 primary key(organization_id,outlet_id)
);
create table public.brands (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 name text not null check(length(trim(name)) between 1 and 120), timezone text not null default 'Asia/Kuala_Lumpur',
 is_active boolean not null default true, unique(organization_id,id), unique(organization_id,name)
);
create table public.brand_outlets (
 organization_id uuid not null, brand_id uuid not null, outlet_id uuid not null,
 primary key(brand_id,outlet_id), foreign key(organization_id,brand_id) references public.brands(organization_id,id),
 foreign key(organization_id,outlet_id) references public.organization_outlets(organization_id,outlet_id)
);
create index brand_outlets_organization on public.brand_outlets(organization_id);
create table public.marketing_role_scopes (
 organization_id uuid not null references public.organizations(id), role_id uuid not null references public.roles(id),
 all_brands boolean not null default false, primary key(organization_id,role_id)
);
create index marketing_role_scopes_role on public.marketing_role_scopes(role_id);
create table public.marketing_role_brands (
 organization_id uuid not null, role_id uuid not null, brand_id uuid not null,
 primary key(organization_id,role_id,brand_id), foreign key(organization_id,role_id) references public.marketing_role_scopes(organization_id,role_id),
 foreign key(organization_id,brand_id) references public.brands(organization_id,id)
);
create index marketing_role_brands_brand on public.marketing_role_brands(brand_id);
create table public.marketing_knowledge (
 brand_id uuid primary key references public.brands(id), revision integer not null default 1,
 profile jsonb not null default '{}', updated_by uuid not null references public.employees(id), updated_at timestamptz not null default now()
);
create table public.marketing_assets (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, brand_id uuid not null,
 filename text not null, mime_type text not null check(mime_type in ('image/jpeg','image/png','image/webp','video/mp4')),
 size_bytes bigint not null check(size_bytes between 1 and 104857600), object_path text not null unique,
 state text not null default 'pending' check(state in ('pending','ready')), created_by uuid not null references public.employees(id),
 created_at timestamptz not null default now(), foreign key(organization_id,brand_id) references public.brands(organization_id,id)
);
create index marketing_assets_brand on public.marketing_assets(organization_id,brand_id,created_at desc);
create table public.marketing_content (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, brand_id uuid not null,
 revision integer not null default 1, approved_revision integer,
 status text not null default 'draft' check(status in ('draft','review','approved','scheduled','published','rejected','failed','cancelled')),
 scheduled_at timestamptz, schedule_timezone text, created_by uuid not null references public.employees(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(organization_id,brand_id) references public.brands(organization_id,id), unique(id,organization_id,brand_id)
);
create index marketing_content_scope on public.marketing_content(organization_id,brand_id,updated_at desc);
create index marketing_content_schedule on public.marketing_content(scheduled_at) where status='scheduled';
create table public.marketing_content_revisions (
 content_id uuid not null references public.marketing_content(id), revision integer not null, payload jsonb not null,
 actor_employee_id uuid not null references public.employees(id), created_at timestamptz not null default now(), primary key(content_id,revision)
);
alter table public.marketing_content add constraint marketing_content_revision_fk foreign key(id,revision) references public.marketing_content_revisions(content_id,revision) deferrable initially deferred;
alter table public.marketing_content add constraint marketing_content_approval_fk foreign key(id,approved_revision) references public.marketing_content_revisions(content_id,revision);
create table public.marketing_connections (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, brand_id uuid not null,
 channel text not null check(channel in ('facebook','instagram')), provider_account_id text,
 status text not null default 'not_connected' check(status in ('not_connected','test_authorized','production_authorized','expired','error')),
 capabilities jsonb not null default '{}', expires_at timestamptz, last_synced_at timestamptz, error_code text,
 foreign key(organization_id,brand_id) references public.brands(organization_id,id), unique(brand_id,channel)
);
create index marketing_connections_scope on public.marketing_connections(organization_id);
-- Credentials never share the exposed metadata table. No credentials or fake connections are seeded.
create schema if not exists marketing_private;
revoke all on schema marketing_private from public,anon,authenticated;
create table marketing_private.credentials (
 connection_id uuid primary key references public.marketing_connections(id), credential_reference text not null
);
alter table marketing_private.credentials enable row level security;
create table public.marketing_jobs (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, brand_id uuid not null, content_id uuid not null,
 revision integer not null, channel text not null check(channel in ('facebook','instagram')),
 state text not null check(state in ('queued','blocked','leased','reconciling','retry','succeeded','failed','cancelled')),
 due_at timestamptz not null, authorized_by uuid not null references public.employees(id), attempts integer not null default 0, lease_token uuid, lease_expires_at timestamptz,
 provider_post_id text, error_code text, updated_at timestamptz not null default now(),
 foreign key(content_id,organization_id,brand_id) references public.marketing_content(id,organization_id,brand_id),
 foreign key(content_id,revision) references public.marketing_content_revisions(content_id,revision),
 unique(content_id,revision,channel), check(state<>'succeeded' or provider_post_id is not null)
);
create index marketing_jobs_due on public.marketing_jobs(state,due_at);
create index marketing_jobs_brand on public.marketing_jobs(organization_id,brand_id);
create index marketing_jobs_authorizer on public.marketing_jobs(authorized_by);
create table public.marketing_events (
 id bigint generated always as identity primary key, organization_id uuid not null references public.organizations(id),
 brand_id uuid references public.brands(id), content_id uuid references public.marketing_content(id),
 action text not null, actor_employee_id uuid references public.employees(id), details jsonb not null default '{}', created_at timestamptz not null default now()
);
create index marketing_events_scope on public.marketing_events(organization_id,brand_id,created_at desc);
create index marketing_events_content on public.marketing_events(content_id);
create table public.marketing_requests (
 request_id uuid primary key, actor_employee_id uuid not null references public.employees(id), fingerprint text not null, result jsonb not null
);
create index marketing_requests_actor on public.marketing_requests(actor_employee_id);

insert into public.permissions(code,module,description,requires_restaurant_outlet_scope)
select code, module, description, false from (values
 ('marketing_workspace.access','Marketing Workspace','Enter the Marketing workspace.'),
 ('platform_organizations.manage','Organization & Brand Structure','Manage shared organization membership, brands and outlet relationships.'),
 ('marketing_overview.view','Marketing Overview','View publishing activity and action center.'),
 ('marketing_content.view','Marketing Content','View content and assets.'),
 ('marketing_content.create','Marketing Content','Create content drafts.'),
 ('marketing_content.edit','Marketing Content','Revise content; invalidate approval.'),
 ('marketing_content.review','Marketing Content','Submit content for review.'),
 ('marketing_content.approve','Marketing Content','Approve or reject a saved revision.'),
 ('marketing_content.publish','Marketing Content','Schedule approved content; retry authorized publishing.'),
 ('marketing_content.cancel','Marketing Content','Cancel content execution.'),
 ('marketing_content.upload','Marketing Content','Upload private brand media.'),
 ('marketing_calendar.view','Marketing Calendar','View multi-brand content calendar.'),
 ('marketing_analytics.view','Marketing Analytics','View verified publishing outcomes.'),
 ('marketing_settings.view','Marketing Settings','View brand knowledge and connection readiness.'),
 ('marketing_settings.manage','Marketing Settings','Manage brand knowledge.'),
 ('marketing_settings.configure','Marketing Settings','Configure brand-scoped access and integrations.')
) v(code,module,description) on conflict(code) do nothing;

create function marketing_private.actor() returns uuid language plpgsql stable security definer set search_path=public as $$
declare actor uuid;
begin
 select e.id into actor from public.employees e join public.roles r on r.id=e.role_id
 where e.auth_user_id=auth.uid() and e.enable_system_login and e.access_state='active' and e.is_active and r.is_active;
 if actor is null then raise exception using errcode='42501',message='Active FeedX employee access is required.'; end if;
 return actor;
end; $$;
create function marketing_private.member(p_org uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.organization_memberships m join public.employees e on e.id=m.employee_id
 join public.roles r on r.id=e.role_id where m.organization_id=p_org and e.auth_user_id=auth.uid()
 and e.enable_system_login and e.access_state='active' and e.is_active and r.is_active);
$$;
create function marketing_private.brand_allowed(p_org uuid,p_brand uuid) returns boolean language sql stable security definer set search_path=public as $$
 select marketing_private.member(p_org) and exists(select 1 from public.brands b where b.id=p_brand and b.organization_id=p_org)
 and exists(select 1 from public.employees e join public.roles r on r.id=e.role_id
 where e.auth_user_id=auth.uid() and (lower(r.name) in ('owner','admin') or exists(
 select 1 from public.marketing_role_scopes s where s.organization_id=p_org and s.role_id=e.role_id
 and (s.all_brands or exists(select 1 from public.marketing_role_brands rb where rb.organization_id=p_org and rb.role_id=e.role_id and rb.brand_id=p_brand)))));
$$;
create function marketing_private.require_access(p_org uuid,p_brand uuid,p_permission text) returns uuid language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=marketing_private.actor();
begin
 if not public.current_user_has_permission('marketing_workspace.access') or not public.current_user_has_permission(p_permission)
 or not marketing_private.member(p_org) or (p_brand is not null and not marketing_private.brand_allowed(p_org,p_brand)) then
 raise exception using errcode='42501',message='Marketing permission or brand access is unavailable.'; end if;
 return actor;
end; $$;
revoke all on all functions in schema marketing_private from public,anon,authenticated;

-- Shared setup, explicit membership and brand targeting; never infer from outlet names.
create function public.platform_organization_command(p_command text,p_org uuid,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=marketing_private.actor(); org uuid:=p_org; brand uuid; outlet uuid; employee uuid; target_role uuid; timezone_name text;
begin
 if not public.current_user_has_permission('platform_organizations.manage') then raise exception using errcode='42501',message='Organization management permission is required.'; end if;
 if p_command='create_organization' then
   insert into public.organizations(name) values(trim(p_payload->>'name')) returning id into org;
   insert into public.organization_memberships values(org,actor);
 else
   if not marketing_private.member(org) then raise exception using errcode='42501',message='Organization access is unavailable.'; end if;
   perform 1 from public.organizations where id=org for update;
   if p_command='save_brand' then
     timezone_name:=coalesce(p_payload->>'timezone','Asia/Kuala_Lumpur');
     if not exists(select 1 from pg_timezone_names where name=timezone_name) then raise exception 'Choose a valid timezone.'; end if;
     brand:=nullif(p_payload->>'id','')::uuid;
     if brand is null then insert into public.brands(organization_id,name,timezone) values(org,trim(p_payload->>'name'),timezone_name) returning id into brand;
     else update public.brands set name=trim(p_payload->>'name'),timezone=timezone_name where id=brand and organization_id=org;
       if not found then raise exception 'Brand is unavailable.'; end if;
     end if;
     for outlet in select value::uuid from jsonb_array_elements_text(coalesce(p_payload->'outlet_ids','[]')) loop
       if not public.current_user_can_access_outlet(outlet) or not exists(select 1 from public.outlets where id=outlet and is_active)
       or exists(select 1 from public.organization_outlets where outlet_id=outlet and organization_id<>org) then raise exception using errcode='42501',message='Outlet cannot be assigned to this organization.'; end if;
       insert into public.organization_outlets values(org,outlet) on conflict do nothing;
     end loop;
     delete from public.brand_outlets where brand_id=brand;
     insert into public.brand_outlets select org,brand,value::uuid from jsonb_array_elements_text(coalesce(p_payload->'outlet_ids','[]'));
   elsif p_command='add_member' then
     if not public.current_user_has_permission('employees.view') then raise exception using errcode='42501',message='Employee visibility is required.'; end if;
     employee:=(p_payload->>'employee_id')::uuid;
     if not exists(select 1 from public.employees where id=employee and auth_user_id is not null and enable_system_login and access_state='active' and is_active) then raise exception 'Choose an active FeedX employee.'; end if;
     insert into public.organization_memberships values(org,employee) on conflict do nothing;
   elsif p_command='remove_member' then
     employee:=(p_payload->>'employee_id')::uuid;
     if employee=actor then raise exception 'You cannot remove your own organization access.'; end if;
     delete from public.organization_memberships where organization_id=org and employee_id=employee;
   else raise exception 'Unknown organization action.';
   end if;
 end if;
 insert into public.marketing_events(organization_id,brand_id,action,actor_employee_id,details) values(org,brand,'platform_'||p_command,actor,jsonb_build_object('employee_id',employee));
 return jsonb_build_object('organization_id',org,'brand_id',brand);
end; $$;

create function public.marketing_set_role_scope(p_org uuid,p_role uuid,p_all boolean,p_brands uuid[]) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=marketing_private.require_access(p_org,null,'marketing_settings.configure');
begin
 if not public.current_user_has_permission('roles.edit') then raise exception using errcode='42501',message='Role editing permission is required.'; end if;
 if p_all is null or p_brands is null or not exists(select 1 from public.roles where id=p_role and is_active and lower(name) not in ('owner','admin')) then raise exception 'Choose an active configurable role.'; end if;
 if exists(select 1 from unnest(p_brands) b where not marketing_private.brand_allowed(p_org,b)) then raise exception using errcode='42501',message='Brand access cannot exceed your own scope.'; end if;
 if p_all and not exists(select 1 from public.employees e join public.roles r on r.id=e.role_id where e.id=actor
 and (lower(r.name) in ('owner','admin') or exists(select 1 from public.marketing_role_scopes s where s.organization_id=p_org and s.role_id=e.role_id and s.all_brands))) then raise exception using errcode='42501',message='All-brand access exceeds your own scope.'; end if;
 perform 1 from public.organizations where id=p_org for update;
 insert into public.marketing_role_scopes values(p_org,p_role,p_all) on conflict(organization_id,role_id) do update set all_brands=excluded.all_brands;
 delete from public.marketing_role_brands where organization_id=p_org and role_id=p_role;
 if not p_all then insert into public.marketing_role_brands select p_org,p_role,b from (select distinct unnest(p_brands) b)x; end if;
 insert into public.marketing_events(organization_id,action,actor_employee_id,details) values(p_org,'role_scope_saved',actor,jsonb_build_object('role_id',p_role,'all_brands',p_all,'brand_ids',p_brands));
 return jsonb_build_object('all_brands',p_all,'brand_ids',case when p_all then '{}'::uuid[] else p_brands end);
end; $$;

create function public.marketing_context() returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=marketing_private.actor(); orgs jsonb; brands jsonb;
begin
 if not public.current_user_has_permission('marketing_workspace.access') then raise exception using errcode='42501',message='Marketing workspace access is required.'; end if;
 select coalesce(jsonb_agg(to_jsonb(o) order by o.name),'[]') into orgs from public.organizations o where marketing_private.member(o.id);
 select coalesce(jsonb_agg(to_jsonb(b)||jsonb_build_object('outlet_ids',(select coalesce(jsonb_agg(outlet_id),'[]') from public.brand_outlets where brand_id=b.id)) order by b.name),'[]') into brands from public.brands b where marketing_private.brand_allowed(b.organization_id,b.id);
 return jsonb_build_object('organizations',orgs,'brands',brands,'actor_employee_id',actor);
end; $$;

create function public.marketing_setup_options(p_org uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=marketing_private.require_access(p_org,null,'marketing_settings.view'); outlets jsonb; employees jsonb; roles jsonb; members jsonb;
begin
 if public.current_user_has_permission('platform_organizations.manage') then
   select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'name',o.name) order by o.name),'[]') into outlets from public.outlets o
   where o.is_active and public.current_user_can_access_outlet(o.id) and not exists(select 1 from public.organization_outlets m where m.outlet_id=o.id and m.organization_id<>p_org);
   if public.current_user_has_permission('employees.view') then
     select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',e.full_name) order by e.full_name),'[]') into employees from public.employees e
     where e.auth_user_id is not null and e.enable_system_login and e.access_state='active' and e.is_active
     and not exists(select 1 from public.organization_memberships m where m.employee_id=e.id and m.organization_id<>p_org);
   end if;
   select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',e.full_name,'role_id',e.role_id) order by e.full_name),'[]') into members
   from public.organization_memberships m join public.employees e on e.id=m.employee_id where m.organization_id=p_org;
 end if;
 if public.current_user_has_permission('roles.view') and public.current_user_has_permission('roles.edit') and public.current_user_has_permission('marketing_settings.configure') then
   select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'name',r.name) order by r.name),'[]') into roles from public.roles r where r.is_active and lower(r.name) not in ('owner','admin');
 end if;
 return jsonb_build_object('outlets',coalesce(outlets,'[]'),'employees',coalesce(employees,'[]'),'roles',coalesce(roles,'[]'),'members',coalesce(members,'[]'));
end; $$;

create function public.marketing_save_knowledge(p_brand uuid,p_expected_revision integer,p_profile jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare org uuid; actor uuid; current_revision integer; result jsonb;
begin
 select organization_id into org from public.brands where id=p_brand;
 actor:=marketing_private.require_access(org,p_brand,'marketing_settings.manage');
 perform 1 from public.brands where id=p_brand for update;
 select revision into current_revision from public.marketing_knowledge where brand_id=p_brand;
 if coalesce(current_revision,0) is distinct from p_expected_revision then raise exception using errcode='40001',message='Brand knowledge changed. Reload before saving.'; end if;
 if p_profile is null or jsonb_typeof(p_profile)<>'object' or octet_length(p_profile::text)>65536 or exists(
 select 1 from jsonb_each(p_profile) x where x.key not in ('positioning','audience','voice','identity','menu','products','pricing','rules','references')
 or jsonb_typeof(x.value)<>'object' or coalesce(x.value->>'provenance','') not in ('verified_brand_fact','external_research','ai_suggestion')
 or length(coalesce(x.value->>'text',''))>8000 or (x.value->>'provenance'='external_research' and coalesce(x.value->>'source_url','') !~ '^https://')) then raise exception 'Provide bounded brand knowledge with evidence provenance.'; end if;
 insert into public.marketing_knowledge values(p_brand,1,p_profile,actor,now()) on conflict(brand_id) do update set revision=marketing_knowledge.revision+1,profile=excluded.profile,updated_by=actor,updated_at=now() returning to_jsonb(marketing_knowledge) into result;
 insert into public.marketing_events(organization_id,brand_id,action,actor_employee_id,details) values(org,p_brand,'knowledge_saved',actor,jsonb_build_object('revision',result->'revision','profile',p_profile));
 return result;
end; $$;

create function marketing_private.validate_content(p_org uuid,p_brand uuid,p_payload jsonb,p_complete boolean) returns void language plpgsql stable security definer set search_path=public as $$
declare variant jsonb; media uuid; outlets uuid[];
begin
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or length(trim(coalesce(p_payload->>'title',''))) not between 1 and 200 or octet_length(p_payload::text)>65536
 or coalesce(jsonb_typeof(p_payload->'variants'),'')<>'array' or coalesce(jsonb_typeof(p_payload->'outlet_ids'),'')<>'array' then raise exception 'A title, outlet targets and channel variants are required.'; end if;
 if jsonb_array_length(p_payload->'variants') not between 1 and 2 then raise exception 'Choose one or two channel variants.'; end if;
 if (select count(distinct x->>'channel') from jsonb_array_elements(p_payload->'variants') x)<>jsonb_array_length(p_payload->'variants') then raise exception 'Use one variant per channel.'; end if;
 for media in select value::uuid from jsonb_array_elements_text(p_payload->'outlet_ids') loop
 if not exists(select 1 from public.brand_outlets where organization_id=p_org and brand_id=p_brand and outlet_id=media) then raise exception 'Outlet target does not belong to this brand.'; end if;
 end loop;
 for variant in select value from jsonb_array_elements(p_payload->'variants') loop
   if coalesce(variant->>'channel','') not in ('facebook','instagram') or coalesce(variant->>'format','') not in ('text','image','carousel','reel')
   or length(coalesce(variant->>'caption',''))>(case when variant->>'channel'='instagram' then 2200 else 63206 end)
   or coalesce(jsonb_typeof(variant->'asset_ids'),'')<>'array'
   or (variant->>'channel'='instagram' and variant->>'format'='text') then raise exception 'Channel format, caption or media is invalid.'; end if;
   if jsonb_array_length(variant->'asset_ids')>10 then raise exception 'Use at most ten media assets per variant.'; end if;
   for media in select value::uuid from jsonb_array_elements_text(variant->'asset_ids') loop
     if not exists(select 1 from public.marketing_assets where id=media and organization_id=p_org and brand_id=p_brand and state='ready') then raise exception 'Use ready media belonging to this brand.'; end if;
     if variant->>'format' in ('image','carousel') and exists(select 1 from public.marketing_assets where id=media and mime_type not like 'image/%')
     or variant->>'format'='reel' and exists(select 1 from public.marketing_assets where id=media and mime_type<>'video/mp4') then raise exception 'Media type does not match the publishing format.'; end if;
   end loop;
   if p_complete and (length(trim(coalesce(variant->>'caption','')))=0
   or (variant->>'format' in ('image','reel') and jsonb_array_length(variant->'asset_ids')<>1)
   or (variant->>'format'='carousel' and jsonb_array_length(variant->'asset_ids') not between 2 and 10)
   or (variant->>'format'='text' and jsonb_array_length(variant->'asset_ids')<>0)) then raise exception 'Complete the caption and required media before review.'; end if;
 end loop;
end; $$;

create function public.marketing_content_command(p_request_id uuid,p_command text,p_org uuid,p_brand uuid,p_content_id uuid,p_expected_revision integer,p_payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid; permission text; c public.marketing_content; prior public.marketing_requests; fp text; result jsonb; body jsonb; variant jsonb; connection public.marketing_connections; scheduled timestamptz; tz text; new_revision integer;
begin
 permission:=case p_command when 'save' then case when p_content_id is null then 'marketing_content.create' else 'marketing_content.edit' end
 when 'review' then 'marketing_content.review' when 'approve' then 'marketing_content.approve' when 'reject' then 'marketing_content.approve'
 when 'schedule' then 'marketing_content.publish' when 'retry' then 'marketing_content.publish' when 'cancel' then 'marketing_content.cancel' end;
 if permission is null or p_request_id is null or p_expected_revision is null then raise exception 'A valid content action and revision are required.'; end if;
 actor:=marketing_private.require_access(p_org,p_brand,permission);
 if p_brand is null then raise exception 'Choose a brand.'; end if;
 fp:=md5(jsonb_build_array(p_command,p_org,p_brand,p_content_id,p_expected_revision,p_payload)::text);
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 select * into prior from public.marketing_requests where request_id=p_request_id;
 if found then if prior.actor_employee_id<>actor or prior.fingerprint<>fp then raise exception 'Retry payload changed. Use a new request.'; end if; return prior.result; end if;
 if p_content_id is not null then
   select * into c from public.marketing_content where id=p_content_id and organization_id=p_org and brand_id=p_brand for update;
   if not found then raise exception using errcode='42501',message='Content is unavailable.'; end if;
   if c.revision<>p_expected_revision then raise exception using errcode='40001',message='Content changed. Reload before continuing.'; end if;
   select payload into body from public.marketing_content_revisions where content_id=c.id and revision=c.revision;
 elsif p_command<>'save' or p_expected_revision<>0 then raise exception 'Save a draft first.';
 end if;
 if p_command='save' then
   if c.status='published' then raise exception 'Published content is immutable. Create a new draft.'; end if;
   perform marketing_private.validate_content(p_org,p_brand,p_payload,false);
   if c.id is null then
     insert into public.marketing_content(organization_id,brand_id,created_by) values(p_org,p_brand,actor) returning * into c;
     insert into public.marketing_content_revisions values(c.id,c.revision,p_payload,actor,now());
   elsif body is distinct from p_payload then
     if exists(select 1 from public.marketing_jobs where content_id=c.id and state in ('leased','reconciling','succeeded')) then raise exception 'Publishing is in progress or partially completed. Reconcile before changing content.'; end if;
     new_revision:=c.revision+1;
     insert into public.marketing_content_revisions values(c.id,new_revision,p_payload,actor,now());
     update public.marketing_content set revision=new_revision,approved_revision=null,status='draft',scheduled_at=null,schedule_timezone=null,updated_at=now() where id=c.id returning * into c;
     update public.marketing_jobs set state='cancelled',updated_at=now() where content_id=c.id and state not in ('succeeded','cancelled');
   end if;
 elsif p_command='review' then
   if c.status not in ('draft','rejected') then raise exception 'Only drafts or rejected content can enter review.'; end if;
   perform marketing_private.validate_content(p_org,p_brand,body,true);
   update public.marketing_content set status='review',updated_at=now() where id=c.id returning * into c;
 elsif p_command in ('approve','reject') then
   if c.status<>'review' then raise exception 'Review the current saved revision first.'; end if;
   if p_command='reject' and length(trim(coalesce(p_payload->>'reason','')))=0 then raise exception 'A rejection reason is required.'; end if;
   update public.marketing_content set status=case when p_command='approve' then 'approved' else 'rejected' end,
   approved_revision=case when p_command='approve' then revision else null end,updated_at=now() where id=c.id returning * into c;
 elsif p_command='schedule' then
   if c.status<>'approved' or c.approved_revision is distinct from c.revision then raise exception 'The current revision must be approved before scheduling.'; end if;
   scheduled:=(p_payload->>'scheduled_at')::timestamptz; tz:=p_payload->>'timezone';
   if scheduled is null or scheduled<=now() or not exists(select 1 from pg_timezone_names where name=tz) then raise exception 'Choose a future publishing time and valid timezone.'; end if;
   perform marketing_private.validate_content(p_org,p_brand,body,true);
   for variant in select value from jsonb_array_elements(body->'variants') loop
     select * into connection from public.marketing_connections where brand_id=p_brand and channel=variant->>'channel';
     insert into public.marketing_jobs(organization_id,brand_id,content_id,revision,channel,state,due_at,authorized_by,error_code)
     values(p_org,p_brand,c.id,c.revision,variant->>'channel','blocked',scheduled,actor,'provider_not_authorized');
   end loop;
   update public.marketing_content set status='scheduled',scheduled_at=scheduled,schedule_timezone=tz,updated_at=now() where id=c.id returning * into c;
 elsif p_command='retry' then
   -- A worker/provider deployment is required before an operational retry is offered.
   raise exception 'Publishing is unavailable until the Meta connection and worker are authorized.';
 elsif p_command='cancel' then
   if c.status in ('published','cancelled') or exists(select 1 from public.marketing_jobs where content_id=c.id and state in ('leased','reconciling','succeeded')) then raise exception 'Content cannot be cancelled while delivery is uncertain or complete.'; end if;
   update public.marketing_jobs set state='cancelled',updated_at=now() where content_id=c.id and state<>'succeeded';
   update public.marketing_content set status='cancelled',updated_at=now() where id=c.id returning * into c;
 end if;
 result:=to_jsonb(c);
 insert into public.marketing_requests values(p_request_id,actor,fp,result);
 insert into public.marketing_events(organization_id,brand_id,content_id,action,actor_employee_id,details)
 values(p_org,p_brand,c.id,p_command,actor,jsonb_build_object('revision',c.revision,'request_id',p_request_id,'reason',left(p_payload->>'reason',2000)));
 return result;
end; $$;

create function public.marketing_content_detail(p_content uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare c public.marketing_content; actor uuid; assets jsonb; events jsonb;
begin
 select * into c from public.marketing_content where id=p_content;
 if not found then raise exception using errcode='42501',message='Content is unavailable.'; end if;
 actor:=marketing_private.require_access(c.organization_id,c.brand_id,'marketing_content.view');
 select coalesce(jsonb_agg(to_jsonb(a)),'[]') into assets from public.marketing_assets a where a.id in (
 select ids.asset_id::uuid from public.marketing_content_revisions r cross join lateral jsonb_array_elements(r.payload->'variants') v(variant)
 cross join lateral jsonb_array_elements_text(v.variant->'asset_ids') ids(asset_id) where r.content_id=c.id and r.revision=c.revision);
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into events from (select action,actor_employee_id,details,created_at from public.marketing_events where content_id=c.id order by id desc limit 50)x;
 return jsonb_build_object('assets',assets,'events',events);
end; $$;
revoke all on function public.marketing_content_detail(uuid) from public,anon;
grant execute on function public.marketing_content_detail(uuid) to authenticated;

-- Durable worker boundaries remain server-only. No worker is deployed or provider enabled in this phase.
create function marketing_private.job_authorized(j public.marketing_jobs) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.employees e join public.roles r on r.id=e.role_id
 join public.organization_memberships m on m.employee_id=e.id and m.organization_id=j.organization_id
 where e.id=j.authorized_by and e.enable_system_login and e.access_state='active' and e.is_active and r.is_active
 and (lower(r.name) in ('owner','admin') or (
 (select count(distinct p.code) from public.role_permissions rp join public.permissions p on p.id=rp.permission_id where rp.role_id=r.id and p.code in ('marketing_workspace.access','marketing_content.publish'))=2
 and exists(select 1 from public.marketing_role_scopes s where s.organization_id=j.organization_id and s.role_id=r.id and (s.all_brands or exists(select 1 from public.marketing_role_brands rb where rb.organization_id=j.organization_id and rb.role_id=r.id and rb.brand_id=j.brand_id))))));
$$;
create function public.marketing_claim_job() returns jsonb language plpgsql security definer set search_path=public as $$
declare j public.marketing_jobs; connection public.marketing_connections;
begin
 -- An expired external request is uncertain. Reconciliation must precede any resend.
 update public.marketing_jobs set state='reconciling',error_code='lease_expired',updated_at=now() where state='leased' and lease_expires_at<now();
 select x.* into j from public.marketing_jobs x join public.marketing_content c on c.id=x.content_id
 join public.marketing_connections connection on connection.brand_id=x.brand_id and connection.channel=x.channel
 where x.state in ('queued','retry','blocked') and x.due_at<=now() and x.attempts<5
 and c.status='scheduled' and c.revision=x.revision and c.approved_revision=x.revision
 and connection.status='production_authorized' and connection.expires_at>now() and connection.capabilities->>'publishing'='true'
 and exists(select 1 from marketing_private.credentials where connection_id=connection.id)
 and marketing_private.job_authorized(x) order by x.due_at,x.id for update of c skip locked limit 1;
 if not found then return null; end if;
 select * into j from public.marketing_jobs where id=j.id for update;
 update public.marketing_jobs set state='leased',attempts=attempts+1,lease_token=gen_random_uuid(),lease_expires_at=now()+interval '2 minutes',error_code=null,updated_at=now() where id=j.id returning * into j;
 return to_jsonb(j)||jsonb_build_object('payload',(select payload from public.marketing_content_revisions where content_id=j.content_id and revision=j.revision));
end; $$;
create function public.marketing_finish_job(p_job uuid,p_lease uuid,p_outcome text,p_provider_post_id text default null,p_error_code text default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare j public.marketing_jobs; c public.marketing_content; next_state text;
begin
 -- Lock content before job, matching authoring/cancellation order to avoid deadlocks.
 select c0.* into c from public.marketing_content c0 join public.marketing_jobs j0 on j0.content_id=c0.id where j0.id=p_job for update of c0;
 select * into j from public.marketing_jobs where id=p_job for update;
 if found and j.lease_token=p_lease and j.state='succeeded' and p_outcome='published' and j.provider_post_id=p_provider_post_id then return to_jsonb(j); end if;
 if not found or j.lease_token is distinct from p_lease or p_lease is null or j.state not in ('leased','reconciling') then raise exception 'Publishing lease is unavailable.'; end if;
 if c.revision<>j.revision or c.approved_revision is distinct from j.revision then raise exception 'Approved publishing revision changed.'; end if;
 next_state:=case p_outcome when 'published' then 'succeeded' when 'uncertain' then 'reconciling' when 'retryable_failure' then case when j.attempts>=5 then 'failed' else 'retry' end when 'permanent_failure' then 'failed' end;
 if next_state is null or (next_state='succeeded' and length(trim(coalesce(p_provider_post_id,'')))=0) then raise exception 'Verified provider receipt or failure outcome is required.'; end if;
 update public.marketing_jobs set state=next_state,provider_post_id=case when next_state='succeeded' then p_provider_post_id else null end,
 error_code=case when next_state='succeeded' then null else left(coalesce(p_error_code,'provider_failure'),100) end,
 due_at=case when next_state='retry' then now()+make_interval(secs=>least(3600,30*(2^least(j.attempts,7))::integer)) else due_at end,
 lease_expires_at=null,updated_at=now() where id=p_job returning * into j;
 if not exists(select 1 from public.marketing_jobs where content_id=c.id and revision=c.revision and state<>'succeeded') then
   update public.marketing_content set status='published',updated_at=now() where id=c.id;
 elsif exists(select 1 from public.marketing_jobs where content_id=c.id and revision=c.revision and state='failed') then
   update public.marketing_content set status='failed',updated_at=now() where id=c.id;
 end if;
 insert into public.marketing_events(organization_id,brand_id,content_id,action,details) values(j.organization_id,j.brand_id,j.content_id,'publishing_'||next_state,jsonb_build_object('job_id',j.id,'revision',j.revision,'channel',j.channel,'provider_post_id',j.provider_post_id,'error_code',j.error_code));
 return to_jsonb(j);
end; $$;
revoke all on function public.marketing_claim_job(),public.marketing_finish_job(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.marketing_claim_job(),public.marketing_finish_job(uuid,uuid,text,text,text) to service_role;

create function public.marketing_prepare_asset(p_org uuid,p_brand uuid,p_filename text,p_mime text,p_size bigint) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=marketing_private.require_access(p_org,p_brand,'marketing_content.upload'); asset uuid:=gen_random_uuid(); path text; result jsonb;
begin
 if p_brand is null or length(trim(coalesce(p_filename,''))) not between 1 and 200 or p_size is null or p_size not between 1 and 104857600
 or coalesce(p_mime,'') not in ('image/jpeg','image/png','image/webp','video/mp4') then raise exception 'Use a JPG, PNG, WebP or MP4 file up to 100 MB.'; end if;
 path:=p_org::text||'/'||p_brand::text||'/'||asset::text;
 insert into public.marketing_assets(id,organization_id,brand_id,filename,mime_type,size_bytes,object_path,created_by)
 values(asset,p_org,p_brand,p_filename,p_mime,p_size,path,actor) returning to_jsonb(marketing_assets) into result;
 return result||jsonb_build_object('bucket','marketing-media');
end; $$;
create function public.marketing_finalize_asset(p_asset uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.marketing_assets; metadata jsonb; actor uuid;
begin
 select * into a from public.marketing_assets where id=p_asset for update;
 if not found then raise exception 'Media is unavailable.'; end if;
 actor:=marketing_private.require_access(a.organization_id,a.brand_id,'marketing_content.upload');
 if a.created_by<>actor then raise exception using errcode='42501',message='Only the uploader can finish this upload.'; end if;
 if a.state='ready' then return to_jsonb(a); end if;
 select o.metadata into metadata from storage.objects o where o.bucket_id='marketing-media' and o.name=a.object_path;
 if metadata is null or (metadata->>'size')::bigint is distinct from a.size_bytes or metadata->>'mimetype' is distinct from a.mime_type then raise exception 'The uploaded media does not match its registered file.'; end if;
 update public.marketing_assets set state='ready' where id=a.id returning * into a;
 insert into public.marketing_events(organization_id,brand_id,action,actor_employee_id,details) values(a.organization_id,a.brand_id,'asset_uploaded',actor,jsonb_build_object('asset_id',a.id));
 return to_jsonb(a);
end; $$;

create function public.marketing_read(p_org uuid,p_brand uuid,p_surface text,p_from timestamptz default null,p_to timestamptz default null,p_page integer default 1,p_page_size integer default 20) returns jsonb language plpgsql stable security definer set search_path=public as $$
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
   order by j.updated_at desc,j.id limit 100)x;
 end if;
 if p_surface='settings' then
   select coalesce(jsonb_agg(to_jsonb(k)),'[]') into knowledge from public.marketing_knowledge k join public.brands b on b.id=k.brand_id where b.organization_id=p_org and (p_brand is null or b.id=p_brand) and marketing_private.brand_allowed(p_org,b.id);
   select coalesce(jsonb_agg(jsonb_build_object('brand_id',b.id,'channel',ch,'status',coalesce(c.status,'not_connected'),'capabilities',coalesce(c.capabilities,'{}'),'expires_at',c.expires_at,'last_synced_at',c.last_synced_at,'error_code',c.error_code)),'[]') into connections
   from public.brands b cross join unnest(array['facebook','instagram']) ch left join public.marketing_connections c on c.brand_id=b.id and c.channel=ch
   where b.organization_id=p_org and (p_brand is null or b.id=p_brand) and marketing_private.brand_allowed(p_org,b.id);
   if public.current_user_has_permission('roles.edit') and public.current_user_has_permission('marketing_settings.configure') then
     select coalesce(jsonb_agg(jsonb_build_object('role_id',s.role_id,'all_brands',s.all_brands,'brand_ids',(select coalesce(jsonb_agg(rb.brand_id),'[]') from public.marketing_role_brands rb where rb.organization_id=p_org and rb.role_id=s.role_id))),'[]') into scopes from public.marketing_role_scopes s where organization_id=p_org;
   end if;
 end if;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into events from (select id,brand_id,content_id,action,actor_employee_id,details,created_at from public.marketing_events where organization_id=p_org
 and (p_brand is null or brand_id=p_brand) and (brand_id is null or marketing_private.brand_allowed(p_org,brand_id)) order by created_at desc,id desc limit 20)x;
 return jsonb_build_object('rows',coalesce(rows,'[]'),'total',coalesce(total,0),'summary',summary,'assets',coalesce(assets,'[]'),'jobs',coalesce(jobs,'[]'),'knowledge',coalesce(knowledge,'[]'),'connections',coalesce(connections,'[]'),'role_scopes',coalesce(scopes,'[]'),'events',events,
 'capabilities',jsonb_build_object('oauth',false,'publishing',false,'social_insights',false,'ai',false,'inbox',false,'whatsapp',false,'ads',false),
 'evidence',jsonb_build_object('social_performance','unavailable','conversions','unavailable','ai_usage','unavailable'));
end; $$;

-- RLS plus explicit grants: the browser submits intent exclusively through RPCs.
do $$ declare t text; begin
 foreach t in array array['organizations','organization_memberships','organization_outlets','brands','brand_outlets','marketing_role_scopes','marketing_role_brands','marketing_knowledge','marketing_assets','marketing_content','marketing_content_revisions','marketing_connections','marketing_jobs','marketing_events','marketing_requests'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 end loop;
end $$;
revoke all on sequence public.marketing_events_id_seq from public,anon,authenticated;
revoke all on all tables in schema marketing_private from public,anon,authenticated;
revoke all on all functions in schema marketing_private from public,anon,authenticated;
revoke all on function public.platform_organization_command(text,uuid,jsonb),public.marketing_set_role_scope(uuid,uuid,boolean,uuid[]),public.marketing_context(),public.marketing_save_knowledge(uuid,integer,jsonb),public.marketing_content_command(uuid,text,uuid,uuid,uuid,integer,jsonb),public.marketing_prepare_asset(uuid,uuid,text,text,bigint),public.marketing_finalize_asset(uuid),public.marketing_read(uuid,uuid,text,timestamptz,timestamptz,integer,integer) from public,anon,authenticated;
grant execute on function public.platform_organization_command(text,uuid,jsonb),public.marketing_set_role_scope(uuid,uuid,boolean,uuid[]),public.marketing_context(),public.marketing_save_knowledge(uuid,integer,jsonb),public.marketing_content_command(uuid,text,uuid,uuid,uuid,integer,jsonb),public.marketing_prepare_asset(uuid,uuid,text,text,bigint),public.marketing_finalize_asset(uuid),public.marketing_read(uuid,uuid,text,timestamptz,timestamptz,integer,integer) to authenticated;
revoke all on function public.marketing_setup_options(uuid) from public,anon;
grant execute on function public.marketing_setup_options(uuid) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('marketing-media','marketing-media',false,104857600,array['image/jpeg','image/png','image/webp','video/mp4']);
create function public.marketing_storage_access(p_path text,p_upload boolean) returns boolean language sql stable security definer set search_path=public as $$
 select public.current_user_has_permission('marketing_workspace.access') and exists(select 1 from public.marketing_assets a
 where a.object_path=p_path and marketing_private.brand_allowed(a.organization_id,a.brand_id)
 and (case when p_upload then a.state='pending' and a.created_by=marketing_private.actor() and public.current_user_has_permission('marketing_content.upload')
 else a.state='ready' and public.current_user_has_permission('marketing_content.view') end));
$$;
revoke all on function public.marketing_storage_access(text,boolean) from public,anon;
grant execute on function public.marketing_storage_access(text,boolean) to authenticated;
create policy marketing_media_insert on storage.objects for insert to authenticated with check(bucket_id='marketing-media' and public.marketing_storage_access(name,true));
create policy marketing_media_select on storage.objects for select to authenticated using(bucket_id='marketing-media' and public.marketing_storage_access(name,false));
-- No update/delete policy: approved assets and historical revisions retain immutable bytes.
