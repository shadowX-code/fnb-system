-- Factory Owner/Admin RLS fix.
-- Keep custom roles permission-driven, but make protected Owner/Admin roles
-- resolve consistently across employees and legacy user_profiles identities.

create or replace function public.current_user_has_permission(permission_code text)
returns boolean
language sql
security definer
set search_path = public
as $$
  with current_identity as (
    select auth.uid() as user_id, lower(coalesce(auth.jwt() ->> 'email', '')) as email
  ),
  current_subject_roles as (
    select e.role_id
    from current_identity ci
    join public.employees e on (
      e.auth_user_id = ci.user_id
      or e.id = ci.user_id
      or (ci.email <> '' and lower(e.email) = ci.email)
    )
    where e.enable_system_login = true
      and e.access_state = 'active'
      and coalesce(e.is_active, true) = true

    union

    select up.role_id
    from current_identity ci
    join public.user_profiles up on up.id = ci.user_id
    where coalesce(up.is_active, true) = true
      and coalesce(up.access_state, 'active') <> 'disabled'
  )
  select exists (
    select 1
    from current_subject_roles csr
    join public.roles r on r.id = csr.role_id
    where lower(r.name) in ('owner', 'admin')
  )
  or exists (
    select 1
    from current_subject_roles csr
    join public.role_permissions rp on rp.role_id = csr.role_id
    join public.permissions p on p.id = rp.permission_id
    where p.code = permission_code
  );
$$;

grant execute on function public.current_user_has_permission(text) to authenticated;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where lower(r.name) in ('owner', 'admin')
  and p.code like 'factory_%'
on conflict do nothing;
