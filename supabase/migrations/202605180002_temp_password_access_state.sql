-- Temporary alpha onboarding state.
-- TODO: Production onboarding will use Supabase inviteUserByEmail, SMTP,
-- branded invitation emails, and password setup links.

do $$
begin
  if to_regclass('public.employees') is not null then
    if exists (
      select 1 from pg_constraint
      where conname = 'employees_access_state_check'
        and conrelid = 'public.employees'::regclass
    ) then
      alter table public.employees drop constraint employees_access_state_check;
    end if;

    alter table public.employees
      add constraint employees_access_state_check
      check (access_state in ('no_access', 'not_sent', 'invited', 'temp_password_active', 'active', 'disabled'));
  end if;
end $$;

do $$
begin
  if to_regclass('public.user_profiles') is not null then
    if exists (
      select 1 from pg_constraint
      where conname = 'user_profiles_access_state_check'
        and conrelid = 'public.user_profiles'::regclass
    ) then
      alter table public.user_profiles drop constraint user_profiles_access_state_check;
    end if;

    alter table public.user_profiles
      add constraint user_profiles_access_state_check
      check (access_state in ('no_access', 'not_sent', 'invited', 'temp_password_active', 'active', 'disabled'));
  end if;
end $$;
