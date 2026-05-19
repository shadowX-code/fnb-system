-- Allow a real Supabase Auth user to activate their employee profile on first login.
-- This supports employees that were invited/created by email before auth_user_id
-- was linked.

do $$
begin
  if to_regclass('public.employees') is not null then
    execute 'alter table public.employees enable row level security';
    execute 'grant select, update on table public.employees to authenticated';

    execute 'drop policy if exists "employees can activate own login by email" on public.employees';
    execute 'create policy "employees can activate own login by email"
      on public.employees for update to authenticated
      using (
        auth_user_id = auth.uid()
        or id = auth.uid()
        or lower(email) = lower(coalesce(auth.jwt() ->> ''email'', ''''))
        or public.current_user_has_permission(''employees.edit'')
        or public.current_user_has_permission(''employees.enable_login'')
        or public.current_user_has_permission(''employees.deactivate'')
        or public.current_user_has_permission(''employees.reset_password'')
      )
      with check (
        auth_user_id = auth.uid()
        or id = auth.uid()
        or lower(email) = lower(coalesce(auth.jwt() ->> ''email'', ''''))
        or public.current_user_has_permission(''employees.edit'')
        or public.current_user_has_permission(''employees.enable_login'')
        or public.current_user_has_permission(''employees.deactivate'')
        or public.current_user_has_permission(''employees.reset_password'')
      )';
  end if;
end $$;
