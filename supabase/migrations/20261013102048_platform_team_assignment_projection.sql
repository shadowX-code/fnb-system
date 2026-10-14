create or replace function public.platform_team_brand_access(p_org uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=marketing_private.require_access(p_org,null,'marketing_settings.view');members jsonb;options jsonb;
begin
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',e.full_name,'role_id',e.role_id,'role_name',coalesce(r.name,'Role unavailable'),'access_active',coalesce(e.is_active and e.enable_system_login and e.access_state='active' and r.is_active,false),
 'all_brands',s.all_brands or coalesce(lower(r.name) in ('owner','admin'),false),'revision',s.revision,
 'brand_ids',coalesce((select jsonb_agg(b.id order by b.name) from public.brands b where b.organization_id=p_org and (s.all_brands or coalesce(lower(r.name) in ('owner','admin'),false) or exists(select 1 from public.platform_member_brands assigned where assigned.organization_id=p_org and assigned.employee_id=e.id and assigned.brand_id=b.id)) and marketing_private.brand_allowed(p_org,b.id)),'[]'),
 'restricted_scope',exists(select 1 from public.brands b where b.organization_id=p_org and (s.all_brands or coalesce(lower(r.name) in ('owner','admin'),false) or exists(select 1 from public.platform_member_brands assigned where assigned.organization_id=p_org and assigned.employee_id=e.id and assigned.brand_id=b.id)) and not marketing_private.brand_allowed(p_org,b.id)),
 'editable',e.id<>actor and coalesce(lower(r.name),'') not in ('owner','admin') and public.current_user_has_permission('platform_organizations.manage') and public.current_user_has_permission('marketing_settings.configure')
 and not(s.all_brands and not marketing_private.all_brands_allowed(p_org)) and not exists(select 1 from public.platform_member_brands mb where mb.organization_id=p_org and mb.employee_id=e.id and not marketing_private.brand_allowed(p_org,mb.brand_id)),
 'permission_codes',coalesce((select jsonb_agg(p.code order by p.code) from public.role_permissions rp join public.permissions p on p.id=rp.permission_id where rp.role_id=r.id and p.code like 'marketing_%'),'[]')) order by e.full_name),'[]') into members
 from public.organization_memberships m join public.employees e on e.id=m.employee_id left join public.roles r on r.id=e.role_id
 join public.platform_member_brand_scopes s on s.organization_id=m.organization_id and s.employee_id=m.employee_id
 where m.organization_id=p_org and (e.id=actor or public.current_user_has_permission('platform_organizations.manage') and (marketing_private.all_brands_allowed(p_org) or exists(select 1 from public.brands b where b.organization_id=p_org and marketing_private.brand_allowed(p_org,b.id) and (s.all_brands or coalesce(lower(r.name) in ('owner','admin'),false) or exists(select 1 from public.platform_member_brands assigned where assigned.organization_id=p_org and assigned.employee_id=e.id and assigned.brand_id=b.id)))));
 if public.current_user_has_permission('platform_organizations.manage') and public.current_user_has_permission('employees.view') then
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',e.full_name) order by e.full_name),'[]') into options from public.employees e
 where marketing_private.employee_visible(e.id) and e.auth_user_id is not null and e.enable_system_login and e.access_state='active' and e.is_active
 and not exists(select 1 from public.organization_memberships m where m.employee_id=e.id);
 end if;
 return jsonb_build_object('members',members,'employees',coalesce(options,'[]'));
end;$$;
