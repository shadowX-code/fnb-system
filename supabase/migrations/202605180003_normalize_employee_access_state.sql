-- Normalize employee access_state values to the production-safe enum.
-- Temporary password onboarding is represented by `invited` at the database layer.

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid()
);

alter table public.employees
  add column if not exists enable_system_login boolean not null default false,
  add column if not exists access_state text not null default 'no_access';

update public.employees
set access_state = case
  when coalesce(enable_system_login, false) = false then 'no_access'
  when access_state in ('temp_password_active', 'temporary_password_active', 'invitation_pending', 'pending') then 'invited'
  when access_state in ('inactive', 'login_disabled') then 'disabled'
  when access_state in ('draft') then 'not_sent'
  when access_state in ('no_access', 'not_sent', 'invited', 'active', 'disabled') then access_state
  else 'not_sent'
end;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'employees_access_state_check'
      and conrelid = 'public.employees'::regclass
  ) then
    alter table public.employees drop constraint employees_access_state_check;
  end if;

  alter table public.employees
    add constraint employees_access_state_check
    check (access_state in ('no_access', 'not_sent', 'invited', 'active', 'disabled'));
end $$;

comment on column public.employees.access_state is
  'System-generated access lifecycle: no_access, not_sent, invited, active, disabled.';
