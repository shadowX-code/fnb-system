alter table public.employees
add column if not exists employment_type text;

create table if not exists public.employee_employment_structure_migration_report (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  old_employment_status text,
  mapped_employment_type text,
  mapped_employment_status text,
  requires_manual_review boolean not null default false,
  created_at timestamptz not null default now()
);

insert into public.employee_employment_structure_migration_report (
  employee_id,
  old_employment_status,
  mapped_employment_type,
  mapped_employment_status,
  requires_manual_review
)
select
  id,
  employment_status,
  case
    when employment_status in ('full_time', 'full-time') then 'full_time'
    when employment_status in ('part_time', 'part-time') then 'part_time'
    when employment_status = 'intern' then 'intern'
    when employment_status = 'contract' then 'contract'
    when employment_status = 'probation' then 'probation'
    else coalesce(employment_type, 'probation')
  end,
  case
    when employment_status = 'resigned' then 'resigned'
    when employment_status = 'terminated' then 'terminated'
    when employment_status = 'active' then 'active'
    else 'active'
  end,
  employment_status not in ('full_time', 'full-time', 'part_time', 'part-time', 'probation', 'intern', 'contract', 'active', 'resigned', 'terminated')
from public.employees
where employment_status is not null
on conflict (employee_id) do nothing;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'employees_employment_status_check'
      and conrelid = 'public.employees'::regclass
  ) then
    alter table public.employees drop constraint employees_employment_status_check;
  end if;
end $$;

update public.employees
set employment_type = case
    when employment_status in ('full_time', 'full-time') then 'full_time'
    when employment_status in ('part_time', 'part-time') then 'part_time'
    when employment_status = 'intern' then 'intern'
    when employment_status = 'contract' then 'contract'
    when employment_status = 'probation' then 'probation'
    else coalesce(employment_type, 'probation')
  end
where employment_type is null
  or employment_status in ('full_time', 'full-time', 'part_time', 'part-time', 'probation', 'intern', 'contract');

update public.employees
set employment_status = case
    when employment_status = 'resigned' then 'resigned'
    when employment_status = 'terminated' then 'terminated'
    else 'active'
  end
where employment_status is distinct from case
    when employment_status = 'resigned' then 'resigned'
    when employment_status = 'terminated' then 'terminated'
    else 'active'
  end;

update public.employees
set employment_type = coalesce(employment_type, 'probation'),
    employment_status = coalesce(employment_status, 'active');

alter table public.employees
alter column employment_type set default 'probation',
alter column employment_type set not null,
alter column employment_status set default 'active',
alter column employment_status set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'employees_employment_type_check'
      and conrelid = 'public.employees'::regclass
  ) then
    alter table public.employees
    add constraint employees_employment_type_check
    check (employment_type in ('probation', 'full_time', 'part_time', 'intern', 'contract'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'employees_employment_status_check'
      and conrelid = 'public.employees'::regclass
  ) then
    alter table public.employees
    add constraint employees_employment_status_check
    check (employment_status in ('active', 'resigned', 'terminated'));
  end if;
end $$;

grant select on table public.employee_employment_structure_migration_report to authenticated;
