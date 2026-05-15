-- Production Sprint 2
-- Align Supabase RBAC/RLS with the frontend module registry in config/modules.ts.
-- Source of truth: feature-level permission codes generated as module_id.action,
-- with dashes converted to underscores.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Base RBAC / Employee tables
-- This migration must be safe even when the earlier RBAC migration was never
-- applied, so every table used below is created before any ALTER/RLS work.
-- ---------------------------------------------------------------------------
create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  description text,
  is_system_role boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.permissions (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  module text not null,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  nickname text,
  gender text,
  nationality text default 'Malaysia',
  ic_no text,
  birthday date,
  contact text,
  email text,
  employment_status text,
  department text,
  position text,
  employee_code text,
  joined_date date,
  resigned_date date,
  bank_name text,
  bank_account_number text,
  bank_account_name text,
  role_id uuid references public.roles(id),
  enable_system_login boolean not null default false,
  access_state text not null default 'no_access',
  is_active boolean not null default true,
  email_verified boolean not null default false,
  verification_sent_at timestamptz,
  access_disabled_at timestamptz,
  last_login_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if to_regclass('public.outlets') is not null then
    create table if not exists public.user_outlets (
      user_id uuid not null references public.user_profiles(id) on delete cascade,
      outlet_id uuid not null references public.outlets(id) on delete cascade,
      primary key (user_id, outlet_id)
    );
  end if;
end $$;

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  module text not null,
  user_id uuid references auth.users(id),
  user_name text,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Employee-first profile schema
-- ---------------------------------------------------------------------------
alter table public.user_profiles
  add column if not exists full_name text,
  add column if not exists nickname text,
  add column if not exists gender text,
  add column if not exists nationality text default 'Malaysia',
  add column if not exists ic_no text,
  add column if not exists birthday date,
  add column if not exists contact text,
  add column if not exists email text,
  add column if not exists employment_status text,
  add column if not exists bank_name text,
  add column if not exists bank_account_number text,
  add column if not exists bank_account_name text,
  add column if not exists department text,
  add column if not exists position text,
  add column if not exists employee_code text,
  add column if not exists joined_date date,
  add column if not exists resigned_date date,
  add column if not exists role_id uuid references public.roles(id),
  add column if not exists enable_system_login boolean not null default false,
  add column if not exists access_state text not null default 'no_access',
  add column if not exists is_active boolean not null default true,
  add column if not exists email_verified boolean not null default false,
  add column if not exists access_disabled_at timestamptz,
  add column if not exists verification_sent_at timestamptz,
  add column if not exists last_login_at timestamptz,
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'user_profiles_access_state_check'
      and conrelid = 'public.user_profiles'::regclass
  ) then
    alter table public.user_profiles drop constraint user_profiles_access_state_check;
  end if;
end $$;

comment on column public.user_profiles.employment_status is
  'HR lifecycle only: full_time, part_time, resigned.';
comment on column public.user_profiles.enable_system_login is
  'Whether this employee profile has system login enabled.';
comment on column public.user_profiles.access_state is
  'Generated login lifecycle: no_access, not_sent, invited, active, disabled.';

update public.user_profiles
set
  enable_system_login = true
where email is not null
   or role_id is not null
   or email_verified = true
   or last_login_at is not null;

update public.user_profiles
set access_state = 'disabled'
where access_state = 'inactive';

update public.user_profiles
set
  access_state = case
    when coalesce(enable_system_login, false) = false then 'no_access'
    when is_active = true and email_verified = true then 'active'
    when is_active = false and email_verified = false then 'invited'
    when is_active = false then 'disabled'
    else coalesce(access_state, 'not_sent')
  end;

alter table public.user_profiles
  add constraint user_profiles_access_state_check
  check (access_state in ('no_access', 'not_sent', 'invited', 'active', 'disabled'));

-- ---------------------------------------------------------------------------
-- Roles: only owner/admin are protected. Other roles are configurable.
-- ---------------------------------------------------------------------------
insert into public.roles (name, description, is_system_role, is_active)
values
  ('owner', 'Protected company owner role with full FeedX access.', true, true),
  ('admin', 'Protected system administrator role with full FeedX access.', true, true),
  ('manager', 'Configurable outlet or area manager role.', false, true),
  ('supervisor', 'Configurable shift supervisor role.', false, true),
  ('cashier', 'Configurable front counter role.', false, true),
  ('kitchen', 'Configurable kitchen operations role.', false, true),
  ('purchaser', 'Configurable purchase and supplier control role.', false, true),
  ('finance', 'Configurable finance review role.', false, true),
  ('hr', 'Configurable HR and employee management role.', false, true),
  ('staff', 'Configurable basic employee access role.', false, true)
on conflict (name) do update
set
  description = excluded.description,
  is_system_role = excluded.is_system_role,
  is_active = excluded.is_active;

-- ---------------------------------------------------------------------------
-- Registry permissions
-- ---------------------------------------------------------------------------
insert into public.permissions (code, module, description)
values
  ('dashboard.view', 'Dashboard', 'View Dashboard.'),

  ('sales_input.view', 'Sales Input', 'View Sales Input.'),
  ('sales_input.create', 'Sales Input', 'Create Sales Input records.'),
  ('sales_input.edit', 'Sales Input', 'Edit Sales Input records.'),
  ('sales_input.delete', 'Sales Input', 'Delete Sales Input records.'),

  ('sales_comparison.view', 'Sales Comparison', 'View Sales Comparison.'),
  ('sales_comparison.export', 'Sales Comparison', 'Export Sales Comparison.'),

  ('sales_channels.view', 'Sales Channels', 'View Sales Channels.'),
  ('sales_channels.create', 'Sales Channels', 'Create Sales Channels.'),
  ('sales_channels.edit', 'Sales Channels', 'Edit Sales Channels.'),
  ('sales_channels.delete', 'Sales Channels', 'Delete Sales Channels.'),

  ('tax_settings.view', 'Tax Settings', 'View Tax Settings.'),
  ('tax_settings.edit', 'Tax Settings', 'Edit Tax Settings.'),

  ('purchase_input.view', 'Purchase Input', 'View Purchase Input.'),
  ('purchase_input.create', 'Purchase Input', 'Create Purchase Input records.'),
  ('purchase_input.edit', 'Purchase Input', 'Edit Purchase Input records.'),
  ('purchase_input.delete', 'Purchase Input', 'Delete Purchase Input records.'),
  ('purchase_input.approve', 'Purchase Input', 'Approve Purchase Input records.'),

  ('purchase_comparison.view', 'Purchase Comparison', 'View Purchase Comparison.'),
  ('purchase_comparison.export', 'Purchase Comparison', 'Export Purchase Comparison.'),

  ('suppliers.view', 'Suppliers', 'View Suppliers.'),
  ('suppliers.create', 'Suppliers', 'Create Suppliers.'),
  ('suppliers.edit', 'Suppliers', 'Edit Suppliers.'),
  ('suppliers.delete', 'Suppliers', 'Delete Suppliers.'),

  ('purchase_categories.view', 'Purchase Categories', 'View Purchase Categories.'),
  ('purchase_categories.create', 'Purchase Categories', 'Create Purchase Categories.'),
  ('purchase_categories.edit', 'Purchase Categories', 'Edit Purchase Categories.'),
  ('purchase_categories.delete', 'Purchase Categories', 'Delete Purchase Categories.'),

  ('employees.view', 'Employees', 'View Employees.'),
  ('employees.create', 'Employees', 'Create Employees.'),
  ('employees.edit', 'Employees', 'Edit Employees.'),
  ('employees.deactivate', 'Employees', 'Deactivate Employees.'),
  ('employees.enable_login', 'Employees', 'Enable employee system login.'),
  ('employees.reset_password', 'Employees', 'Send employee reset password links.'),

  ('job_positions.view', 'Job Positions', 'View Job Positions.'),
  ('job_positions.create', 'Job Positions', 'Create Job Positions.'),
  ('job_positions.edit', 'Job Positions', 'Edit Job Positions.'),
  ('job_positions.delete', 'Job Positions', 'Delete Job Positions.'),

  ('departments.view', 'Departments', 'View Departments.'),
  ('departments.create', 'Departments', 'Create Departments.'),
  ('departments.edit', 'Departments', 'Edit Departments.'),
  ('departments.delete', 'Departments', 'Delete Departments.'),

  ('roles.view', 'Roles', 'View Roles.'),
  ('roles.create', 'Roles', 'Create Roles.'),
  ('roles.edit', 'Roles', 'Edit Roles.'),
  ('roles.delete', 'Roles', 'Delete Roles.'),

  ('outlets.view', 'Outlets', 'View Outlets.'),
  ('outlets.create', 'Outlets', 'Create Outlets.'),
  ('outlets.edit', 'Outlets', 'Edit Outlets.'),
  ('outlets.delete', 'Outlets', 'Delete Outlets.'),

  ('alerts.view', 'Alerts & Insights', 'View Alerts & Insights.'),
  ('alerts.manage', 'Alerts & Insights', 'Manage Alerts & Insights.'),

  ('data_import.view', 'Data Import', 'View Data Import.'),
  ('data_import.import', 'Data Import', 'Import data.'),

  ('data_health.view', 'Data Health', 'View Data Health.'),

  ('audit_logs.view', 'Audit Logs', 'View Audit Logs.'),
  ('audit_logs.export', 'Audit Logs', 'Export Audit Logs.')
on conflict (code) do update
set module = excluded.module,
    description = excluded.description;

-- Remove old broad/obsolete permission concepts to prevent frontend/database drift.
delete from public.permissions
where code in (
  'sales.view',
  'sales.edit',
  'purchase.view',
  'purchase.edit',
  'settings.view',
  'settings.edit',
  'users.view',
  'users.manage',
  'roles.manage',
  'permissions.view',
  'permissions.manage',
  'month.lock',
  'month.unlock',
  'audit.view',
  'hr.view',
  'hr.manage',
  'kpi.view',
  'kpi.manage',
  'payroll.view',
  'payroll.manage',
  'outlets.manage',
  'suppliers.manage'
);

-- Owner/admin protected roles receive every registry permission.
insert into public.role_permissions (role_id, permission_id)
select roles.id, permissions.id
from public.roles
cross join public.permissions
where roles.name in ('owner', 'admin')
on conflict do nothing;

-- Replace common default role grants with feature-level permissions.
delete from public.role_permissions rp
using public.roles r
where rp.role_id = r.id
  and r.name in ('manager', 'cashier', 'kitchen', 'staff')
  and r.name not in ('owner', 'admin');

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code in (
  'dashboard.view',
  'sales_input.view',
  'sales_input.create',
  'sales_input.edit',
  'sales_comparison.view',
  'purchase_input.view',
  'purchase_input.create',
  'purchase_input.edit',
  'purchase_comparison.view',
  'outlets.view',
  'suppliers.view',
  'employees.view',
  'employees.edit',
  'employees.enable_login'
)
where r.name = 'manager'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code in ('dashboard.view', 'sales_input.view', 'sales_input.create')
where r.name = 'cashier'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code in ('dashboard.view', 'purchase_input.view')
where r.name = 'kitchen'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code = 'dashboard.view'
where r.name = 'staff'
on conflict do nothing;

create or replace function public.current_user_has_permission(permission_code text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_profiles up
    join public.role_permissions rp on rp.role_id = up.role_id
    join public.permissions p on p.id = rp.permission_id
    where up.id = auth.uid()
      and up.is_active = true
      and coalesce(up.enable_system_login, false) = true
      and up.access_state = 'active'
      and p.code = permission_code
  );
$$;

-- ---------------------------------------------------------------------------
-- RBAC RLS policies
-- ---------------------------------------------------------------------------
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_profiles enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists "authenticated users can view roles" on public.roles;
drop policy if exists "roles managers can manage roles" on public.roles;
drop policy if exists "roles viewers can view roles" on public.roles;
create policy "roles viewers can view roles"
on public.roles for select to authenticated
using (public.current_user_has_permission('roles.view'));

drop policy if exists "role creators can create roles" on public.roles;
create policy "role creators can create roles"
on public.roles for insert to authenticated
with check (public.current_user_has_permission('roles.create'));

drop policy if exists "role editors can update roles" on public.roles;
create policy "role editors can update roles"
on public.roles for update to authenticated
using (public.current_user_has_permission('roles.edit'))
with check (public.current_user_has_permission('roles.edit'));

drop policy if exists "role deleters can delete roles" on public.roles;
create policy "role deleters can delete roles"
on public.roles for delete to authenticated
using (public.current_user_has_permission('roles.delete') and name not in ('owner', 'admin'));

drop policy if exists "authenticated users can view permissions" on public.permissions;
drop policy if exists "permission managers can manage permissions" on public.permissions;
drop policy if exists "roles viewers can view permissions" on public.permissions;
create policy "roles viewers can view permissions"
on public.permissions for select to authenticated
using (public.current_user_has_permission('roles.view'));

drop policy if exists "role editors can manage permissions catalog" on public.permissions;
create policy "role editors can manage permissions catalog"
on public.permissions for all to authenticated
using (public.current_user_has_permission('roles.edit'))
with check (public.current_user_has_permission('roles.edit'));

drop policy if exists "authenticated users can view role permissions" on public.role_permissions;
drop policy if exists "permission managers can manage role permissions" on public.role_permissions;
drop policy if exists "roles viewers can view role permissions" on public.role_permissions;
create policy "roles viewers can view role permissions"
on public.role_permissions for select to authenticated
using (public.current_user_has_permission('roles.view'));

drop policy if exists "role editors can manage role permissions" on public.role_permissions;
create policy "role editors can manage role permissions"
on public.role_permissions for all to authenticated
using (public.current_user_has_permission('roles.edit'))
with check (public.current_user_has_permission('roles.edit'));

drop policy if exists "users can view own profile or user managers can view all" on public.user_profiles;
drop policy if exists "user managers can manage profiles" on public.user_profiles;
drop policy if exists "employees can view own profile or employee viewers can view all" on public.user_profiles;
create policy "employees can view own profile or employee viewers can view all"
on public.user_profiles for select to authenticated
using (id = auth.uid() or public.current_user_has_permission('employees.view'));

drop policy if exists "employee creators can create profiles" on public.user_profiles;
create policy "employee creators can create profiles"
on public.user_profiles for insert to authenticated
with check (public.current_user_has_permission('employees.create'));

drop policy if exists "employee editors can update profiles" on public.user_profiles;
create policy "employee editors can update profiles"
on public.user_profiles for update to authenticated
using (
  id = auth.uid()
  or public.current_user_has_permission('employees.edit')
  or public.current_user_has_permission('employees.enable_login')
  or public.current_user_has_permission('employees.deactivate')
  or public.current_user_has_permission('employees.reset_password')
)
with check (
  id = auth.uid()
  or public.current_user_has_permission('employees.edit')
  or public.current_user_has_permission('employees.enable_login')
  or public.current_user_has_permission('employees.deactivate')
  or public.current_user_has_permission('employees.reset_password')
);

do $$
begin
  if to_regclass('public.user_outlets') is not null then
    execute 'alter table public.user_outlets enable row level security';

    execute 'drop policy if exists "users can view own outlets or user managers can view all" on public.user_outlets';
    execute 'drop policy if exists "user managers can manage outlet assignments" on public.user_outlets';
    execute 'drop policy if exists "employees can view own legacy outlets or employee viewers can view all" on public.user_outlets';
    execute 'create policy "employees can view own legacy outlets or employee viewers can view all"
      on public.user_outlets for select to authenticated
      using (user_id = auth.uid() or public.current_user_has_permission(''employees.view''))';

    execute 'drop policy if exists "employee editors can manage legacy outlet assignments" on public.user_outlets';
    execute 'create policy "employee editors can manage legacy outlet assignments"
      on public.user_outlets for all to authenticated
      using (public.current_user_has_permission(''employees.edit''))
      with check (public.current_user_has_permission(''employees.edit''))';
  end if;
end $$;

drop policy if exists "audit viewers can view audit logs" on public.audit_logs;
drop policy if exists "user managers can write audit logs" on public.audit_logs;
drop policy if exists "audit log viewers can view audit logs" on public.audit_logs;
create policy "audit log viewers can view audit logs"
on public.audit_logs for select to authenticated
using (public.current_user_has_permission('audit_logs.view'));

drop policy if exists "authenticated users can insert audit logs" on public.audit_logs;
create policy "authenticated users can insert audit logs"
on public.audit_logs for insert to authenticated
with check (auth.uid() is not null);

-- ---------------------------------------------------------------------------
-- Transaction RLS policies
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.sales_records') is not null then
    alter table public.sales_records enable row level security;
    revoke all on table public.sales_records from anon;
    grant select, insert, update, delete on table public.sales_records to authenticated;

    drop policy if exists "authenticated users can view sales records" on public.sales_records;
    drop policy if exists "sales editors can write sales records" on public.sales_records;
    drop policy if exists "sales input and comparison viewers can view sales records" on public.sales_records;
    create policy "sales input and comparison viewers can view sales records"
    on public.sales_records for select to authenticated
    using (
      public.current_user_has_permission('sales_input.view')
      or public.current_user_has_permission('sales_comparison.view')
    );

    drop policy if exists "sales input creators can insert sales records" on public.sales_records;
    create policy "sales input creators can insert sales records"
    on public.sales_records for insert to authenticated
    with check (public.current_user_has_permission('sales_input.create'));

    drop policy if exists "sales input editors can update sales records" on public.sales_records;
    create policy "sales input editors can update sales records"
    on public.sales_records for update to authenticated
    using (public.current_user_has_permission('sales_input.edit'))
    with check (public.current_user_has_permission('sales_input.edit'));

    drop policy if exists "sales input deleters can delete sales records" on public.sales_records;
    create policy "sales input deleters can delete sales records"
    on public.sales_records for delete to authenticated
    using (public.current_user_has_permission('sales_input.delete'));
  end if;

  if to_regclass('public.purchase_records') is not null then
    alter table public.purchase_records enable row level security;
    revoke all on table public.purchase_records from anon;
    grant select, insert, update, delete on table public.purchase_records to authenticated;

    drop policy if exists "authenticated users can view purchase records" on public.purchase_records;
    drop policy if exists "purchase editors can write purchase records" on public.purchase_records;
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
    using (
      public.current_user_has_permission('purchase_input.edit')
      or public.current_user_has_permission('purchase_input.approve')
    )
    with check (
      public.current_user_has_permission('purchase_input.edit')
      or public.current_user_has_permission('purchase_input.approve')
    );

    drop policy if exists "purchase input deleters can delete purchase records" on public.purchase_records;
    create policy "purchase input deleters can delete purchase records"
    on public.purchase_records for delete to authenticated
    using (public.current_user_has_permission('purchase_input.delete'));
  end if;
end $$;
