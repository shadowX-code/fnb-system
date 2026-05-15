-- Production Sprint 3A
-- Core persistence tables for employee-first people modules and purchase input.

create extension if not exists pgcrypto;

create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  description text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.job_positions (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  department text,
  description text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  full_name text not null,
  nickname text,
  gender text,
  nationality text not null default 'Malaysia',
  ic_no text,
  birthday date,
  contact text,
  email text,
  employment_status text not null default 'full_time' check (employment_status in ('full_time', 'part_time', 'resigned')),
  department text,
  position text,
  workplace text,
  employee_code text,
  joined_date date,
  resigned_date date,
  bank_name text,
  bank_account_number text,
  bank_account_name text,
  enable_system_login boolean not null default false,
  role_id uuid references public.roles(id),
  access_state text not null default 'no_access' check (access_state in ('no_access', 'not_sent', 'invited', 'active', 'disabled')),
  is_active boolean not null default true,
  email_verified boolean not null default false,
  verification_sent_at timestamptz,
  access_disabled_at timestamptz,
  last_login_at timestamptz,
  audit_summary text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.role_outlets (
  role_id uuid not null references public.roles(id) on delete cascade,
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  primary key (role_id, outlet_id)
);

create table if not exists public.purchase_records (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  year integer not null,
  month integer not null check (month between 1 and 12),
  supplier_id uuid references public.suppliers(id) on delete restrict,
  category_id uuid references public.purchase_categories(id) on delete restrict,
  amount numeric(14,2) not null default 0,
  remark text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists purchase_records_period_idx
  on public.purchase_records (outlet_id, year, month);

insert into public.departments (name, description, status)
values
  ('Leadership', 'Company leadership and ownership.', 'active'),
  ('Administration', 'Administrative operations and internal support.', 'active'),
  ('Operations', 'Outlet operations and management.', 'active'),
  ('Frontline', 'Service floor and customer-facing outlet team.', 'active'),
  ('Kitchen', 'Kitchen production and preparation team.', 'active'),
  ('Procurement', 'Purchasing and supplier coordination.', 'active'),
  ('Finance', 'Finance, reporting and approval workflows.', 'active'),
  ('HR', 'Human resources and employee administration.', 'active')
on conflict (name) do nothing;

insert into public.job_positions (name, department, description, status)
values
  ('Owner', 'Leadership', 'Company owner or director.', 'active'),
  ('Admin', 'Administration', 'Company administrator.', 'active'),
  ('Outlet Manager', 'Operations', 'Responsible for outlet operations.', 'active'),
  ('Supervisor', 'Operations', 'Shift and floor supervision.', 'active'),
  ('Cashier', 'Frontline', 'Counter and payment operations.', 'active'),
  ('Kitchen Crew', 'Kitchen', 'Kitchen preparation and production.', 'active'),
  ('Service Crew', 'Frontline', 'Dining floor service.', 'active'),
  ('Purchaser', 'Procurement', 'Supplier purchase coordination.', 'active'),
  ('Finance Officer', 'Finance', 'Finance and reporting operations.', 'active'),
  ('HR Officer', 'HR', 'HR administration.', 'active'),
  ('Part Time Crew', 'Frontline', 'Part-time outlet crew.', 'active')
on conflict (name) do nothing;

alter table public.departments enable row level security;
alter table public.job_positions enable row level security;
alter table public.employees enable row level security;
alter table public.role_outlets enable row level security;
alter table public.purchase_records enable row level security;

drop policy if exists "department viewers can view departments" on public.departments;
create policy "department viewers can view departments"
on public.departments for select to authenticated
using (public.current_user_has_permission('departments.view'));

drop policy if exists "department managers can insert departments" on public.departments;
create policy "department managers can insert departments"
on public.departments for insert to authenticated
with check (public.current_user_has_permission('departments.create'));

drop policy if exists "department editors can update departments" on public.departments;
create policy "department editors can update departments"
on public.departments for update to authenticated
using (public.current_user_has_permission('departments.edit'))
with check (public.current_user_has_permission('departments.edit'));

drop policy if exists "department deleters can delete departments" on public.departments;
create policy "department deleters can delete departments"
on public.departments for delete to authenticated
using (public.current_user_has_permission('departments.delete'));

drop policy if exists "job position viewers can view job positions" on public.job_positions;
create policy "job position viewers can view job positions"
on public.job_positions for select to authenticated
using (public.current_user_has_permission('job_positions.view'));

drop policy if exists "job position creators can insert job positions" on public.job_positions;
create policy "job position creators can insert job positions"
on public.job_positions for insert to authenticated
with check (public.current_user_has_permission('job_positions.create'));

drop policy if exists "job position editors can update job positions" on public.job_positions;
create policy "job position editors can update job positions"
on public.job_positions for update to authenticated
using (public.current_user_has_permission('job_positions.edit'))
with check (public.current_user_has_permission('job_positions.edit'));

drop policy if exists "job position deleters can delete job positions" on public.job_positions;
create policy "job position deleters can delete job positions"
on public.job_positions for delete to authenticated
using (public.current_user_has_permission('job_positions.delete'));

drop policy if exists "employee viewers can view employees" on public.employees;
create policy "employee viewers can view employees"
on public.employees for select to authenticated
using (public.current_user_has_permission('employees.view'));

drop policy if exists "employee creators can insert employees" on public.employees;
create policy "employee creators can insert employees"
on public.employees for insert to authenticated
with check (public.current_user_has_permission('employees.create'));

drop policy if exists "employee editors can update employees" on public.employees;
create policy "employee editors can update employees"
on public.employees for update to authenticated
using (
  public.current_user_has_permission('employees.edit')
  or public.current_user_has_permission('employees.enable_login')
  or public.current_user_has_permission('employees.deactivate')
  or public.current_user_has_permission('employees.reset_password')
)
with check (
  public.current_user_has_permission('employees.edit')
  or public.current_user_has_permission('employees.enable_login')
  or public.current_user_has_permission('employees.deactivate')
  or public.current_user_has_permission('employees.reset_password')
);

drop policy if exists "roles viewers can view role outlets" on public.role_outlets;
create policy "roles viewers can view role outlets"
on public.role_outlets for select to authenticated
using (public.current_user_has_permission('roles.view'));

drop policy if exists "role editors can manage role outlets" on public.role_outlets;
create policy "role editors can manage role outlets"
on public.role_outlets for all to authenticated
using (public.current_user_has_permission('roles.edit'))
with check (public.current_user_has_permission('roles.edit'));

drop policy if exists "purchase input and comparison viewers can view purchase records" on public.purchase_records;
create policy "purchase input and comparison viewers can view purchase records"
on public.purchase_records for select to authenticated
using (
  public.current_user_has_permission('purchase_input.view')
  or public.current_user_has_permission('purchase_comparison.view')
);

drop policy if exists "purchase input creators can insert purchase records" on public.purchase_records;
create policy "purchase input creators can insert purchase records"
on public.purchase_records for insert to authenticated
with check (public.current_user_has_permission('purchase_input.create'));

drop policy if exists "purchase input editors can update purchase records" on public.purchase_records;
create policy "purchase input editors can update purchase records"
on public.purchase_records for update to authenticated
using (public.current_user_has_permission('purchase_input.edit') or public.current_user_has_permission('purchase_input.approve'))
with check (public.current_user_has_permission('purchase_input.edit') or public.current_user_has_permission('purchase_input.approve'));

drop policy if exists "purchase input deleters can delete purchase records" on public.purchase_records;
create policy "purchase input deleters can delete purchase records"
on public.purchase_records for delete to authenticated
using (public.current_user_has_permission('purchase_input.delete'));
