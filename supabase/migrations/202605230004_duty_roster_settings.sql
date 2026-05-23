-- Duty Roster settings
-- Position grouping and outlet-specific shift templates.

alter table public.shift_templates
  add column if not exists outlet_id uuid references public.outlets(id) on delete cascade;

do $$
begin
  alter table public.shift_templates drop constraint if exists shift_templates_code_key;
exception when undefined_object then
  null;
end $$;

drop index if exists shift_templates_code_key;
create unique index if not exists shift_templates_outlet_code_unique_idx
on public.shift_templates (outlet_id, code)
where outlet_id is not null;

insert into public.shift_templates (outlet_id, name, code, start_time, end_time, break_minutes, shift_type, color, is_active)
select outlet.id, defaults.name, defaults.code, defaults.start_time::time, defaults.end_time::time, defaults.break_minutes, defaults.shift_type, defaults.color, true
from public.outlets outlet
cross join (
  values
    ('Morning', 'MORNING', '10:00', '18:00', 60, 'working', 'green'),
    ('Mid', 'MID', '12:00', '20:00', 60, 'working', 'amber'),
    ('Closing', 'CLOSING', '14:00', '22:00', 60, 'working', 'red'),
    ('Full', 'FULL', '10:00', '22:00', 90, 'working', 'blue'),
    ('OFF', 'OFF', null, null, 0, 'off', 'gray'),
    ('AL', 'AL', null, null, 0, 'leave', 'purple'),
    ('MC', 'MC', null, null, 0, 'medical', 'purple')
) as defaults(name, code, start_time, end_time, break_minutes, shift_type, color)
on conflict do nothing;

create table if not exists public.roster_position_groups (
  id uuid primary key default gen_random_uuid(),
  position_id uuid not null references public.job_positions(id) on delete cascade,
  group_name text not null default 'other' check (group_name in ('floor', 'kitchen', 'other')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (position_id)
);

do $$
begin
  if to_regclass('public.job_positions') is not null then
    execute 'drop policy if exists "job position viewers can view job positions" on public.job_positions';
    execute 'create policy "job position viewers can view job positions"
      on public.job_positions for select to authenticated
      using (
        public.current_user_has_permission(''job_positions.view'')
        or public.current_user_has_permission(''employees.view'')
        or public.current_user_has_permission(''duty_roster.view'')
      )';
  end if;
end $$;

grant select, insert, update, delete on table public.roster_position_groups to authenticated;
revoke all on table public.roster_position_groups from anon;
alter table public.roster_position_groups enable row level security;

drop policy if exists "duty roster viewers can view position group mappings" on public.roster_position_groups;
create policy "duty roster viewers can view position group mappings"
on public.roster_position_groups for select to authenticated
using (public.current_user_has_permission('duty_roster.view'));

drop policy if exists "duty roster managers can manage position group mappings" on public.roster_position_groups;
create policy "duty roster managers can manage position group mappings"
on public.roster_position_groups for all to authenticated
using (public.current_user_has_permission('duty_roster.manage'))
with check (public.current_user_has_permission('duty_roster.manage'));
