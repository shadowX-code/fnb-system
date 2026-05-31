-- Keep setup-link auth sessions out of the app until password setup is complete.
-- Supabase recovery links create an authenticated session before the user enters a
-- password. FeedX treats that as a temporary setup session and only activates the
-- employee record through this narrow RPC after updateUser({ password }) succeeds.

alter table public.employees
  add column if not exists setup_completed_at timestamptz;

comment on column public.employees.setup_completed_at is
  'Set when an invited employee successfully creates their password. Pending setup sessions must not enter the app before this timestamp is set.';

drop policy if exists "employees can activate own login by email" on public.employees;

create or replace function public.complete_employee_password_setup()
returns public.employees
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_employee public.employees;
begin
  update public.employees
  set
    auth_user_id = auth.uid(),
    access_state = 'active',
    email_verified = true,
    is_active = true,
    setup_completed_at = now(),
    last_login_at = now(),
    updated_at = now()
  where enable_system_login = true
    and access_state in ('not_sent', 'invited')
    and (
      auth_user_id = auth.uid()
      or id = auth.uid()
      or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
  returning * into updated_employee;

  if updated_employee.id is null then
    raise exception 'No pending employee setup is linked to this login.';
  end if;

  return updated_employee;
end;
$$;

revoke all on function public.complete_employee_password_setup() from public;
grant execute on function public.complete_employee_password_setup() to authenticated;
