-- Production Sprint 3A Fix Pass
-- Make core persistence tables compatible with partially migrated schemas and
-- ensure authenticated users have table privileges in addition to RLS policies.

create extension if not exists pgcrypto;

create table if not exists public.departments (
  id uuid primary key default gen_random_uuid()
);

alter table public.departments
  add column if not exists name text,
  add column if not exists description text,
  add column if not exists status text not null default 'active',
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists departments_name_unique_idx on public.departments (name);

create table if not exists public.job_positions (
  id uuid primary key default gen_random_uuid()
);

alter table public.job_positions
  add column if not exists name text,
  add column if not exists department text,
  add column if not exists description text,
  add column if not exists status text not null default 'active',
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists job_positions_name_unique_idx on public.job_positions (name);

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid()
);

alter table public.employees
  add column if not exists auth_user_id uuid references auth.users(id) on delete set null,
  add column if not exists full_name text,
  add column if not exists nickname text,
  add column if not exists gender text,
  add column if not exists nationality text not null default 'Malaysia',
  add column if not exists ic_no text,
  add column if not exists birthday date,
  add column if not exists contact text,
  add column if not exists email text,
  add column if not exists employment_status text not null default 'full_time',
  add column if not exists department text,
  add column if not exists position text,
  add column if not exists workplace text,
  add column if not exists employee_code text,
  add column if not exists joined_date date,
  add column if not exists resigned_date date,
  add column if not exists bank_name text,
  add column if not exists bank_account_number text,
  add column if not exists bank_account_name text,
  add column if not exists enable_system_login boolean not null default false,
  add column if not exists role_id uuid references public.roles(id),
  add column if not exists access_state text not null default 'no_access',
  add column if not exists is_active boolean not null default true,
  add column if not exists email_verified boolean not null default false,
  add column if not exists verification_sent_at timestamptz,
  add column if not exists access_disabled_at timestamptz,
  add column if not exists last_login_at timestamptz,
  add column if not exists audit_summary text,
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

update public.employees set access_state = 'disabled' where access_state = 'inactive';

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

  if exists (
    select 1 from pg_constraint
    where conname = 'employees_employment_status_check'
      and conrelid = 'public.employees'::regclass
  ) then
    alter table public.employees drop constraint employees_employment_status_check;
  end if;
  alter table public.employees
    add constraint employees_employment_status_check
    check (employment_status in ('full_time', 'part_time', 'resigned'));
end $$;

do $$
begin
  if to_regclass('public.outlets') is not null then
    create table if not exists public.role_outlets (
      role_id uuid not null references public.roles(id) on delete cascade,
      outlet_id uuid not null references public.outlets(id) on delete cascade,
      primary key (role_id, outlet_id)
    );
  end if;
end $$;

create table if not exists public.purchase_records (
  id uuid primary key default gen_random_uuid()
);

alter table public.purchase_records
  add column if not exists outlet_id uuid references public.outlets(id) on delete cascade,
  add column if not exists year integer,
  add column if not exists month integer,
  add column if not exists supplier_id uuid references public.suppliers(id) on delete restrict,
  add column if not exists category_id uuid references public.purchase_categories(id) on delete restrict,
  add column if not exists amount numeric(14,2) not null default 0,
  add column if not exists remark text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create index if not exists purchase_records_period_idx
  on public.purchase_records (outlet_id, year, month);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid()
);

alter table public.audit_logs
  add column if not exists action text,
  add column if not exists module text,
  add column if not exists user_id uuid references auth.users(id),
  add column if not exists user_name text,
  add column if not exists description text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now();

grant usage on schema public to authenticated;

revoke all on table public.departments from anon;
revoke all on table public.job_positions from anon;
revoke all on table public.employees from anon;
revoke all on table public.audit_logs from anon;
revoke all on table public.purchase_records from anon;

grant select, insert, update, delete on table public.departments to authenticated;
grant select, insert, update, delete on table public.job_positions to authenticated;
grant select, insert, update on table public.employees to authenticated;
grant select, insert on table public.audit_logs to authenticated;
grant select, insert, update, delete on table public.purchase_records to authenticated;

do $$
begin
  if to_regclass('public.role_outlets') is not null then
    execute 'revoke all on table public.role_outlets from anon';
    execute 'grant select, insert, update, delete on table public.role_outlets to authenticated';
  end if;
end $$;

alter table public.departments enable row level security;
alter table public.job_positions enable row level security;
alter table public.employees enable row level security;
alter table public.audit_logs enable row level security;
alter table public.purchase_records enable row level security;

do $$
begin
  if to_regclass('public.role_outlets') is not null then
    execute 'alter table public.role_outlets enable row level security';
  end if;
end $$;

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

drop policy if exists "audit log viewers can view audit logs" on public.audit_logs;
create policy "audit log viewers can view audit logs"
on public.audit_logs for select to authenticated
using (public.current_user_has_permission('audit_logs.view'));

drop policy if exists "authenticated users can insert audit logs" on public.audit_logs;
create policy "authenticated users can insert audit logs"
on public.audit_logs for insert to authenticated
with check (auth.uid() is not null);

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

do $$
begin
  if to_regclass('public.role_outlets') is not null then
    execute 'drop policy if exists "roles viewers can view role outlets" on public.role_outlets';
    execute 'create policy "roles viewers can view role outlets"
      on public.role_outlets for select to authenticated
      using (public.current_user_has_permission(''roles.view''))';
    execute 'drop policy if exists "role editors can manage role outlets" on public.role_outlets';
    execute 'create policy "role editors can manage role outlets"
      on public.role_outlets for all to authenticated
      using (public.current_user_has_permission(''roles.edit''))
      with check (public.current_user_has_permission(''roles.edit''))';
  end if;
end $$;
