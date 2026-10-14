create or replace function public.platform_member_brand_access(p_org uuid,p_employee uuid,p_brands uuid[],p_expected_revision integer,p_request uuid) returns jsonb language plpgsql security definer set search_path=public as $$
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
  if exists(select 1 from unnest(ids) selected where not marketing_private.brand_allowed(p_org,selected)) then raise exception using errcode='42501',message='Saved request exceeds your current Brand access.';end if;
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
 if exists(select 1 from unnest(ids) as chosen(brand_id) join public.brands b on b.id=chosen.brand_id where not b.is_active and not(s.all_brands or exists(select 1 from public.platform_member_brands mb where mb.organization_id=p_org and mb.employee_id=p_employee and mb.brand_id=chosen.brand_id))) then raise exception 'Inactive Brands cannot be assigned for new operations.';end if;
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

