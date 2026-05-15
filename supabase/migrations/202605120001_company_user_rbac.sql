create extension if not exists pgcrypto;

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
  gender text,
  ic_no text,
  birthday date,
  contact text,
  email text,
  employment_status text,
  position text,
  employee_code text,
  joined_date date,
  resigned_date date,
  role_id uuid references public.roles(id),
  is_active boolean not null default true,
  email_verified boolean not null default false,
  last_login_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_outlets (
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  primary key (user_id, outlet_id)
);

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

insert into public.roles (name, description, is_system_role)
values
  ('owner', 'Company owner with full platform access.', true),
  ('admin', 'System administrator with full operational access.', true),
  ('manager', 'Outlet or area manager with sales and purchase access.', true),
  ('supervisor', 'Shift supervisor with operational visibility.', true),
  ('cashier', 'Front counter user.', true),
  ('kitchen', 'Kitchen operations user.', true),
  ('purchaser', 'Purchase and supplier control user.', true),
  ('finance', 'Finance review and approval user.', true),
  ('hr', 'HR and employee management user.', true),
  ('staff', 'Basic employee access.', true)
on conflict (name) do nothing;

insert into public.permissions (code, module, description)
values
  ('dashboard.view', 'Dashboard', 'View company dashboard.'),
  ('sales.view', 'Sales', 'View sales records and comparison.'),
  ('sales.edit', 'Sales', 'Create and update sales records.'),
  ('purchase.view', 'Purchase', 'View purchase records and comparison.'),
  ('purchase.edit', 'Purchase', 'Create and update purchase records.'),
  ('settings.view', 'Settings', 'View system settings.'),
  ('settings.edit', 'Settings', 'Edit system settings.'),
  ('users.view', 'Users', 'View company users.'),
  ('users.manage', 'Users', 'Create, update, invite, deactivate users.'),
  ('roles.view', 'Roles', 'View roles.'),
  ('roles.manage', 'Roles', 'Create and update roles.'),
  ('permissions.view', 'Permissions', 'View permission catalog.'),
  ('permissions.manage', 'Permissions', 'Manage role permissions.'),
  ('outlets.view', 'Outlets', 'View outlet master data.'),
  ('outlets.manage', 'Outlets', 'Manage outlet master data.'),
  ('suppliers.view', 'Suppliers', 'View supplier master data.'),
  ('suppliers.manage', 'Suppliers', 'Manage supplier master data.'),
  ('month.lock', 'Month Lock', 'Lock accounting months.'),
  ('month.unlock', 'Month Lock', 'Unlock accounting months.'),
  ('audit.view', 'Audit', 'View audit logs.'),
  ('hr.view', 'HR', 'View HR data.'),
  ('hr.manage', 'HR', 'Manage HR data.'),
  ('kpi.view', 'KPI', 'View KPI data.'),
  ('kpi.manage', 'KPI', 'Manage KPI data.'),
  ('payroll.view', 'Payroll', 'View payroll data.'),
  ('payroll.manage', 'Payroll', 'Manage payroll data.')
on conflict (code) do nothing;

insert into public.role_permissions (role_id, permission_id)
select roles.id, permissions.id
from public.roles
cross join public.permissions
where roles.name in ('owner', 'admin')
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select roles.id, permissions.id
from public.roles
join public.permissions on permissions.code in (
  'dashboard.view',
  'sales.view',
  'sales.edit',
  'purchase.view',
  'purchase.edit',
  'outlets.view',
  'suppliers.view'
)
where roles.name = 'manager'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select roles.id, permissions.id
from public.roles
join public.permissions on permissions.code = 'dashboard.view'
where roles.name = 'staff'
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
      and p.code = permission_code
  );
$$;

alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_profiles enable row level security;
alter table public.user_outlets enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists "authenticated users can view roles" on public.roles;
create policy "authenticated users can view roles" on public.roles for select to authenticated using (true);

drop policy if exists "roles managers can manage roles" on public.roles;
create policy "roles managers can manage roles" on public.roles for all to authenticated using (public.current_user_has_permission('roles.manage')) with check (public.current_user_has_permission('roles.manage'));

drop policy if exists "authenticated users can view permissions" on public.permissions;
create policy "authenticated users can view permissions" on public.permissions for select to authenticated using (true);

drop policy if exists "permission managers can manage permissions" on public.permissions;
create policy "permission managers can manage permissions" on public.permissions for all to authenticated using (public.current_user_has_permission('permissions.manage')) with check (public.current_user_has_permission('permissions.manage'));

drop policy if exists "authenticated users can view role permissions" on public.role_permissions;
create policy "authenticated users can view role permissions" on public.role_permissions for select to authenticated using (true);

drop policy if exists "permission managers can manage role permissions" on public.role_permissions;
create policy "permission managers can manage role permissions" on public.role_permissions for all to authenticated using (public.current_user_has_permission('permissions.manage')) with check (public.current_user_has_permission('permissions.manage'));

drop policy if exists "users can view own profile or user managers can view all" on public.user_profiles;
create policy "users can view own profile or user managers can view all" on public.user_profiles for select to authenticated using (id = auth.uid() or public.current_user_has_permission('users.view'));

drop policy if exists "user managers can manage profiles" on public.user_profiles;
create policy "user managers can manage profiles" on public.user_profiles for all to authenticated using (public.current_user_has_permission('users.manage')) with check (public.current_user_has_permission('users.manage'));

drop policy if exists "users can view own outlets or user managers can view all" on public.user_outlets;
create policy "users can view own outlets or user managers can view all" on public.user_outlets for select to authenticated using (user_id = auth.uid() or public.current_user_has_permission('users.view'));

drop policy if exists "user managers can manage outlet assignments" on public.user_outlets;
create policy "user managers can manage outlet assignments" on public.user_outlets for all to authenticated using (public.current_user_has_permission('users.manage')) with check (public.current_user_has_permission('users.manage'));

drop policy if exists "audit viewers can view audit logs" on public.audit_logs;
create policy "audit viewers can view audit logs" on public.audit_logs for select to authenticated using (public.current_user_has_permission('audit.view'));

drop policy if exists "user managers can write audit logs" on public.audit_logs;
create policy "user managers can write audit logs" on public.audit_logs for insert to authenticated with check (public.current_user_has_permission('users.manage') or public.current_user_has_permission('roles.manage') or public.current_user_has_permission('permissions.manage'));

do $$
begin
  if to_regclass('public.sales_records') is not null then
    alter table public.sales_records enable row level security;
    revoke all on table public.sales_records from anon;
    grant select, insert, update, delete on table public.sales_records to authenticated;
    drop policy if exists "authenticated users can view sales records" on public.sales_records;
    create policy "authenticated users can view sales records" on public.sales_records for select to authenticated using (public.current_user_has_permission('sales.view'));
    drop policy if exists "sales editors can write sales records" on public.sales_records;
    create policy "sales editors can write sales records" on public.sales_records for all to authenticated using (public.current_user_has_permission('sales.edit')) with check (public.current_user_has_permission('sales.edit'));
  end if;
  if to_regclass('public.purchase_records') is not null then
    alter table public.purchase_records enable row level security;
    revoke all on table public.purchase_records from anon;
    grant select, insert, update, delete on table public.purchase_records to authenticated;
    drop policy if exists "authenticated users can view purchase records" on public.purchase_records;
    create policy "authenticated users can view purchase records" on public.purchase_records for select to authenticated using (public.current_user_has_permission('purchase.view'));
    drop policy if exists "purchase editors can write purchase records" on public.purchase_records;
    create policy "purchase editors can write purchase records" on public.purchase_records for all to authenticated using (public.current_user_has_permission('purchase.edit')) with check (public.current_user_has_permission('purchase.edit'));
  end if;
end $$;
