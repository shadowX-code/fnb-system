-- Duty Roster setup guard
-- Idempotent repair migration for staging projects that missed the initial
-- Duty Roster table setup.

create extension if not exists pgcrypto;

insert into public.permissions (code, module, description)
values
  ('duty_roster.view', 'Duty Roster', 'View Duty Roster.'),
  ('duty_roster.create', 'Duty Roster', 'Create Duty Roster shifts.'),
  ('duty_roster.edit', 'Duty Roster', 'Edit Duty Roster shifts.'),
  ('duty_roster.delete', 'Duty Roster', 'Delete Duty Roster shifts.'),
  ('duty_roster.export', 'Duty Roster', 'Export Duty Roster.'),
  ('duty_roster.manage', 'Duty Roster', 'Publish, lock, and unlock Duty Roster.')
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
      )';
  end if;
end $$;

create table if not exists public.shift_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text unique not null,
  start_time time,
  end_time time,
  break_minutes integer not null default 0,
  shift_type text not null default 'working',
  color text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.roster_periods (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  week_start_date date not null,
  week_end_date date not null,
  status text not null default 'draft' check (status in ('draft', 'published', 'locked')),
  published_by uuid references auth.users(id),
  published_at timestamptz,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (outlet_id, week_start_date)
);

create table if not exists public.duty_rosters (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  roster_date date not null,
  shift_template_id uuid references public.shift_templates(id) on delete set null,
  start_time time,
  end_time time,
  break_minutes integer not null default 0,
  status text not null default 'draft' check (status in ('draft', 'published', 'locked')),
  remark text,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (outlet_id, employee_id, roster_date)
);

insert into public.shift_templates (name, code, start_time, end_time, break_minutes, shift_type, color, is_active)
values
  ('Morning', 'MORNING', '10:00', '18:00', 60, 'working', 'green', true),
  ('Mid', 'MID', '12:00', '20:00', 60, 'working', 'amber', true),
  ('Closing', 'CLOSING', '14:00', '22:00', 60, 'working', 'red', true),
  ('Full', 'FULL', '10:00', '22:00', 90, 'working', 'blue', true),
  ('OFF', 'OFF', null, null, 0, 'off', 'gray', true),
  ('AL', 'AL', null, null, 0, 'leave', 'purple', true),
  ('MC', 'MC', null, null, 0, 'medical', 'purple', true)
on conflict (code) do update
set name = excluded.name,
    start_time = excluded.start_time,
    end_time = excluded.end_time,
    break_minutes = excluded.break_minutes,
    shift_type = excluded.shift_type,
    color = excluded.color,
    is_active = excluded.is_active,
    updated_at = now();

create index if not exists duty_rosters_outlet_date_idx on public.duty_rosters (outlet_id, roster_date);
create index if not exists duty_rosters_employee_date_idx on public.duty_rosters (employee_id, roster_date);
create index if not exists roster_periods_outlet_week_idx on public.roster_periods (outlet_id, week_start_date);

grant select, insert, update, delete on table public.shift_templates to authenticated;
grant select, insert, update, delete on table public.duty_rosters to authenticated;
grant select, insert, update, delete on table public.roster_periods to authenticated;

revoke all on table public.shift_templates from anon;
revoke all on table public.duty_rosters from anon;
revoke all on table public.roster_periods from anon;

alter table public.shift_templates enable row level security;
alter table public.duty_rosters enable row level security;
alter table public.roster_periods enable row level security;

drop policy if exists "duty roster viewers can view shift templates" on public.shift_templates;
create policy "duty roster viewers can view shift templates"
on public.shift_templates for select to authenticated
using (public.current_user_has_permission('duty_roster.view'));

drop policy if exists "duty roster managers can manage shift templates" on public.shift_templates;
create policy "duty roster managers can manage shift templates"
on public.shift_templates for all to authenticated
using (public.current_user_has_permission('duty_roster.manage'))
with check (public.current_user_has_permission('duty_roster.manage'));

drop policy if exists "duty roster viewers can view rosters" on public.duty_rosters;
create policy "duty roster viewers can view rosters"
on public.duty_rosters for select to authenticated
using (public.current_user_has_permission('duty_roster.view'));

drop policy if exists "duty roster creators can insert rosters" on public.duty_rosters;
create policy "duty roster creators can insert rosters"
on public.duty_rosters for insert to authenticated
with check (public.current_user_has_permission('duty_roster.create'));

drop policy if exists "duty roster editors can update rosters" on public.duty_rosters;
create policy "duty roster editors can update rosters"
on public.duty_rosters for update to authenticated
using (public.current_user_has_permission('duty_roster.edit') or public.current_user_has_permission('duty_roster.manage'))
with check (public.current_user_has_permission('duty_roster.edit') or public.current_user_has_permission('duty_roster.manage'));

drop policy if exists "duty roster deleters can delete rosters" on public.duty_rosters;
create policy "duty roster deleters can delete rosters"
on public.duty_rosters for delete to authenticated
using (public.current_user_has_permission('duty_roster.delete'));

drop policy if exists "duty roster viewers can view periods" on public.roster_periods;
create policy "duty roster viewers can view periods"
on public.roster_periods for select to authenticated
using (public.current_user_has_permission('duty_roster.view'));

drop policy if exists "duty roster managers can create periods" on public.roster_periods;
create policy "duty roster managers can create periods"
on public.roster_periods for insert to authenticated
with check (
  public.current_user_has_permission('duty_roster.create')
  or public.current_user_has_permission('duty_roster.manage')
);

drop policy if exists "duty roster managers can update periods" on public.roster_periods;
create policy "duty roster managers can update periods"
on public.roster_periods for update to authenticated
using (public.current_user_has_permission('duty_roster.manage'))
with check (public.current_user_has_permission('duty_roster.manage'));

drop policy if exists "duty roster managers can delete periods" on public.roster_periods;
create policy "duty roster managers can delete periods"
on public.roster_periods for delete to authenticated
using (public.current_user_has_permission('duty_roster.manage'));
