-- Read-only inventory before a separately authorized environment rollout.
-- Nonzero conflicts require review; do not copy Profile roles onto Employees.
select
 (select count(*) from public.user_profiles) as legacy_profiles,
 (select count(*) from public.user_profiles p where coalesce(p.is_active,true)
  and coalesce(p.access_state,'active')<>'disabled'
  and exists(select 1 from public.employees e where
   (e.auth_user_id=p.id or e.id=p.id or (e.auth_user_id is null and lower(e.email)=lower(p.email)))
   and (e.role_id is distinct from p.role_id or not e.enable_system_login
    or e.access_state<>'active' or not coalesce(e.is_active,true)))) as conflicting_profile_authority,
 (select count(*) from public.employees where enable_system_login and access_state='active'
  and auth_user_id is null) as active_employees_awaiting_auth_link,
 (select count(*) from (select lower(email) from public.employees
  where auth_user_id is null and email is not null group by lower(email) having count(*)>1)x) as ambiguous_legacy_emails;
