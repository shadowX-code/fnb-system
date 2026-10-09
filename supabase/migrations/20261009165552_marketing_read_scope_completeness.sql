-- Reuse canonical employee identity/outlet resolution and explicit Marketing scope.
create function marketing_private.employee_visible(p_employee uuid) returns boolean language sql stable security definer set search_path=public as $$
 select p_employee=marketing_private.actor() or public.current_user_has_all_outlet_access()
 or public.current_user_can_access_outlet(public.crew_resolve_employee_outlet(p_employee));
$$;
create function marketing_private.all_brands_allowed(p_org uuid) returns boolean language sql stable security definer set search_path=public as $$
 select marketing_private.member(p_org) and exists(select 1 from public.employees e join public.roles r on r.id=e.role_id
 where e.id=marketing_private.actor() and (lower(r.name) in ('owner','admin') or exists(select 1 from public.marketing_role_scopes s where s.organization_id=p_org and s.role_id=e.role_id and s.all_brands)));
$$;
revoke all on function marketing_private.employee_visible(uuid),marketing_private.all_brands_allowed(uuid) from public,anon,authenticated;
create or replace function public.platform_organization_command(p_command text,p_org uuid,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
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
     if not marketing_private.employee_visible(employee) then raise exception using errcode='42501',message='Employee is outside your visibility scope.'; end if;
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

create or replace function public.marketing_setup_options(p_org uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
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
 return jsonb_build_object('outlets',coalesce(outlets,'[]'),'employees',coalesce(employees,'[]'),'roles',coalesce(roles,'[]'),'members',coalesce(members,'[]'));
end; $$;

create or replace function public.marketing_set_role_scope(p_org uuid,p_role uuid,p_all boolean,p_brands uuid[]) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=marketing_private.require_access(p_org,null,'marketing_settings.configure');
begin
 if not public.current_user_has_permission('roles.edit') then raise exception using errcode='42501',message='Role editing permission is required.'; end if;
 if p_all is null or p_brands is null or not exists(select 1 from public.roles where id=p_role and is_active and lower(name) not in ('owner','admin')) then raise exception 'Choose an active configurable role.'; end if;
 if exists(select 1 from unnest(p_brands) b where not marketing_private.brand_allowed(p_org,b)) then raise exception using errcode='42501',message='Brand access cannot exceed your own scope.'; end if;
 if p_all and not exists(select 1 from public.employees e join public.roles r on r.id=e.role_id where e.id=actor
 and (lower(r.name) in ('owner','admin') or exists(select 1 from public.marketing_role_scopes s where s.organization_id=p_org and s.role_id=e.role_id and s.all_brands))) then raise exception using errcode='42501',message='All-brand access exceeds your own scope.'; end if;
 if exists(select 1 from public.marketing_role_scopes s where s.organization_id=p_org and s.role_id=p_role and s.all_brands) and not marketing_private.all_brands_allowed(p_org)
 or exists(select 1 from public.marketing_role_brands rb where rb.organization_id=p_org and rb.role_id=p_role and not marketing_private.brand_allowed(p_org,rb.brand_id)) then
 raise exception using errcode='42501',message='Existing role scope exceeds your management scope.'; end if;
 perform 1 from public.organizations where id=p_org for update;
 insert into public.marketing_role_scopes values(p_org,p_role,p_all) on conflict(organization_id,role_id) do update set all_brands=excluded.all_brands;
 delete from public.marketing_role_brands where organization_id=p_org and role_id=p_role;
 if not p_all then insert into public.marketing_role_brands select p_org,p_role,b from (select distinct unnest(p_brands) b)x; end if;
 insert into public.marketing_events(organization_id,action,actor_employee_id,details) values(p_org,'role_scope_saved',actor,jsonb_build_object('role_id',p_role,'all_brands',p_all,'brand_ids',p_brands));
 return jsonb_build_object('all_brands',p_all,'brand_ids',case when p_all then '{}'::uuid[] else p_brands end);
end; $$;

create or replace function public.marketing_read(p_org uuid,p_brand uuid,p_surface text,p_from timestamptz default null,p_to timestamptz default null,p_page integer default 1,p_page_size integer default 20) returns jsonb language plpgsql stable security definer set search_path=public as $$
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
   if public.current_user_has_permission('roles.edit') and public.current_user_has_permission('marketing_settings.configure') then
     select coalesce(jsonb_agg(jsonb_build_object('role_id',s.role_id,'all_brands',s.all_brands,'brand_ids',(select coalesce(jsonb_agg(rb.brand_id),'[]') from public.marketing_role_brands rb where rb.organization_id=p_org and rb.role_id=s.role_id))),'[]') into scopes from public.marketing_role_scopes s where organization_id=p_org and (not s.all_brands or marketing_private.all_brands_allowed(p_org))
     and not exists(select 1 from public.marketing_role_brands hidden where hidden.organization_id=p_org and hidden.role_id=s.role_id and not marketing_private.brand_allowed(p_org,hidden.brand_id));
   end if;
 end if;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into events from (select id,brand_id,content_id,action,actor_employee_id,details,created_at from public.marketing_events where organization_id=p_org
 and (p_brand is null or brand_id=p_brand) and (brand_id is null or marketing_private.brand_allowed(p_org,brand_id)) order by created_at desc,id desc limit 20)x;
 return jsonb_build_object('rows',coalesce(rows,'[]'),'total',coalesce(total,0),'summary',summary,'assets',coalesce(assets,'[]'),'jobs',coalesce(jobs,'[]'),'knowledge',coalesce(knowledge,'[]'),'connections',coalesce(connections,'[]'),'role_scopes',coalesce(scopes,'[]'),'events',events,
 'capabilities',jsonb_build_object('oauth',false,'publishing',false,'social_insights',false,'ai',false,'inbox',false,'whatsapp',false,'ads',false),
 'evidence',jsonb_build_object('social_performance','unavailable','conversions','unavailable','ai_usage','unavailable'));
end; $$;

