-- Outlet Duty Roster overview
-- Read-focused monthly outlet duty coverage module.

insert into public.permissions (code, module, description)
values
  ('outlet_duty_roster.view', 'Outlet Duty Roster', 'View Outlet Duty Roster.'),
  ('outlet_duty_roster.export', 'Outlet Duty Roster', 'Export Outlet Duty Roster.')
on conflict (code) do update
set module = excluded.module,
    description = excluded.description;

do $$
begin
  if to_regclass('public.outlets') is not null then
    execute 'drop policy if exists "outlet viewers can view outlets" on public.outlets';
    execute '
      create policy "outlet viewers can view outlets"
      on public.outlets for select to authenticated
      using (
        public.current_user_has_permission(''outlets.view'')
        or public.current_user_has_permission(''dashboard.view'')
        or public.current_user_has_permission(''sales_input.view'')
        or public.current_user_has_permission(''purchase_input.view'')
        or public.current_user_has_permission(''data_import.view'')
        or public.current_user_has_permission(''outlet_pnl.view'')
        or public.current_user_has_permission(''outlet_duty_roster.view'')
        or public.current_user_has_permission(''operating_expenses.view'')
        or public.current_user_has_permission(''duty_roster.view'')
      )';
  end if;

  if to_regclass('public.employees') is not null then
    execute 'drop policy if exists "employees can view own profile or permitted users can view employees" on public.employees';
    execute 'drop policy if exists "employee viewers can view employees" on public.employees';
    execute '
      create policy "employees can view own profile or permitted users can view employees"
      on public.employees for select to authenticated
      using (
        auth_user_id = auth.uid()
        or id = auth.uid()
        or lower(email) = lower(coalesce(auth.jwt() ->> ''email'', ''''))
        or public.current_user_has_permission(''employees.view'')
        or public.current_user_has_permission(''duty_roster.view'')
        or public.current_user_has_permission(''outlet_duty_roster.view'')
      )';
  end if;

  if to_regclass('public.job_positions') is not null then
    execute 'drop policy if exists "job position viewers can view job positions" on public.job_positions';
    execute 'create policy "job position viewers can view job positions"
      on public.job_positions for select to authenticated
      using (
        public.current_user_has_permission(''job_positions.view'')
        or public.current_user_has_permission(''employees.view'')
        or public.current_user_has_permission(''duty_roster.view'')
        or public.current_user_has_permission(''outlet_duty_roster.view'')
      )';
  end if;

  if to_regclass('public.duty_rosters') is not null then
    execute 'drop policy if exists "duty roster viewers can view rosters" on public.duty_rosters';
    execute 'create policy "duty roster viewers can view rosters"
      on public.duty_rosters for select to authenticated
      using (
        public.current_user_has_permission(''duty_roster.view'')
        or public.current_user_has_permission(''outlet_duty_roster.view'')
      )';
  end if;

  if to_regclass('public.shift_templates') is not null then
    execute 'drop policy if exists "duty roster viewers can view shift templates" on public.shift_templates';
    execute 'create policy "duty roster viewers can view shift templates"
      on public.shift_templates for select to authenticated
      using (
        public.current_user_has_permission(''duty_roster.view'')
        or public.current_user_has_permission(''outlet_duty_roster.view'')
      )';
  end if;

  if to_regclass('public.roster_position_groups') is not null then
    execute 'drop policy if exists "duty roster viewers can view position group mappings" on public.roster_position_groups';
    execute 'create policy "duty roster viewers can view position group mappings"
      on public.roster_position_groups for select to authenticated
      using (
        public.current_user_has_permission(''duty_roster.view'')
        or public.current_user_has_permission(''outlet_duty_roster.view'')
      )';
  end if;
end $$;
