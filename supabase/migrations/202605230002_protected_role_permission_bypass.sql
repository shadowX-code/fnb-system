-- Protected role permission bypass
-- Owner and admin are reserved system roles and must automatically receive
-- every current and future permission without relying on role_permissions rows.

create or replace function public.current_user_has_permission(permission_code text)
returns boolean
language sql
security definer
set search_path = public
as $$
  with current_identity as (
    select auth.uid() as user_id, lower(coalesce(auth.jwt() ->> 'email', '')) as email
  ),
  current_employee as (
    select e.id, e.role_id
    from current_identity ci
    join public.employees e on (
      e.auth_user_id = ci.user_id
      or e.id = ci.user_id
      or (ci.email <> '' and lower(e.email) = ci.email)
    )
    where e.enable_system_login = true
      and e.access_state = 'active'
      and coalesce(e.is_active, true) = true
    limit 1
  )
  select exists (
    select 1
    from current_employee ce
    join public.roles r on r.id = ce.role_id
    where lower(r.name) in ('owner', 'admin')
  )
  or exists (
    select 1
    from current_employee ce
    join public.role_permissions rp on rp.role_id = ce.role_id
    join public.permissions p on p.id = rp.permission_id
    where p.code = permission_code
  );
$$;

grant execute on function public.current_user_has_permission(text) to authenticated;
