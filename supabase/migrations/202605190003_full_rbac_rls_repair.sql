-- Production hotfix: repair RBAC/RLS across FeedX core tables.
-- Data-safe: no deletes/truncates/reseeds of business rows.

create extension if not exists pgcrypto;

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  name text unique not null
);

alter table public.roles
  add column if not exists description text,
  add column if not exists is_system_role boolean not null default false,
  add column if not exists is_active boolean not null default true,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz;

create table if not exists public.permissions (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  module text not null default 'Unknown',
  description text,
  created_at timestamptz not null default now()
);

create table if not exists public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid()
);

alter table public.employees
  add column if not exists auth_user_id uuid references auth.users(id) on delete set null,
  add column if not exists role_id uuid references public.roles(id),
  add column if not exists enable_system_login boolean not null default false,
  add column if not exists access_state text not null default 'no_access',
  add column if not exists is_active boolean not null default true,
  add column if not exists email text;

create index if not exists employees_auth_user_id_idx on public.employees(auth_user_id);
create index if not exists employees_email_lower_idx on public.employees(lower(email));
create index if not exists employees_role_id_idx on public.employees(role_id);

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
  ('employees.enable_login', 'Employees', 'Enable employee login.'),
  ('employees.reset_password', 'Employees', 'Reset employee password.'),
  ('departments.view', 'Departments', 'View Departments.'),
  ('departments.create', 'Departments', 'Create Departments.'),
  ('departments.edit', 'Departments', 'Edit Departments.'),
  ('departments.delete', 'Departments', 'Delete Departments.'),
  ('job_positions.view', 'Job Positions', 'View Job Positions.'),
  ('job_positions.create', 'Job Positions', 'Create Job Positions.'),
  ('job_positions.edit', 'Job Positions', 'Edit Job Positions.'),
  ('job_positions.delete', 'Job Positions', 'Delete Job Positions.'),
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

insert into public.roles (name, description, is_system_role, is_active)
values
  ('owner', 'Protected company owner role with full FeedX access.', true, true),
  ('admin', 'Protected system administrator role with full FeedX access.', true, true)
on conflict (name) do update
set description = excluded.description,
    is_system_role = excluded.is_system_role,
    is_active = excluded.is_active;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.name in ('owner', 'admin')
on conflict do nothing;

create or replace function public.current_user_has_permission(permission_code text)
returns boolean
language sql
security definer
set search_path = public
as $$
  with current_identity as (
    select auth.uid() as user_id, lower(coalesce(auth.jwt() ->> 'email', '')) as email
  )
  select exists (
    select 1
    from current_identity ci
    join public.employees e on (
      e.auth_user_id = ci.user_id
      or e.id = ci.user_id
      or (ci.email <> '' and lower(e.email) = ci.email)
    )
    join public.role_permissions rp on rp.role_id = e.role_id
    join public.permissions p on p.id = rp.permission_id
    where e.enable_system_login = true
      and e.access_state = 'active'
      and coalesce(e.is_active, true) = true
      and p.code = permission_code
  );
$$;

grant execute on function public.current_user_has_permission(text) to authenticated;

alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.employees enable row level security;

grant select on table public.roles to authenticated;
grant select on table public.permissions to authenticated;
grant select on table public.role_permissions to authenticated;
grant select, insert, update on table public.employees to authenticated;

drop policy if exists "authenticated users can view roles" on public.roles;
drop policy if exists "roles viewers can view roles" on public.roles;
create policy "authenticated users can view roles"
on public.roles for select to authenticated
using (true);

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
drop policy if exists "roles viewers can view permissions" on public.permissions;
create policy "authenticated users can view permissions"
on public.permissions for select to authenticated
using (true);

drop policy if exists "role editors can manage permissions catalog" on public.permissions;
create policy "role editors can manage permissions catalog"
on public.permissions for all to authenticated
using (public.current_user_has_permission('roles.edit'))
with check (public.current_user_has_permission('roles.edit'));

drop policy if exists "authenticated users can view role permissions" on public.role_permissions;
drop policy if exists "roles viewers can view role permissions" on public.role_permissions;
create policy "authenticated users can view role permissions"
on public.role_permissions for select to authenticated
using (true);

drop policy if exists "role editors can manage role permissions" on public.role_permissions;
create policy "role editors can manage role permissions"
on public.role_permissions for all to authenticated
using (public.current_user_has_permission('roles.edit'))
with check (public.current_user_has_permission('roles.edit'));

drop policy if exists "employees can view own profile or employee viewers can view all" on public.employees;
drop policy if exists "employee viewers can view employees" on public.employees;
create policy "employees can view own profile or permitted users can view employees"
on public.employees for select to authenticated
using (
  auth_user_id = auth.uid()
  or id = auth.uid()
  or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  or public.current_user_has_permission('employees.view')
);

drop policy if exists "employee creators can insert employees" on public.employees;
create policy "employee creators can insert employees"
on public.employees for insert to authenticated
with check (public.current_user_has_permission('employees.create'));

drop policy if exists "employee editors can update employees" on public.employees;
create policy "employee editors can update employees"
on public.employees for update to authenticated
using (
  auth_user_id = auth.uid()
  or id = auth.uid()
  or public.current_user_has_permission('employees.edit')
  or public.current_user_has_permission('employees.enable_login')
  or public.current_user_has_permission('employees.deactivate')
  or public.current_user_has_permission('employees.reset_password')
)
with check (
  auth_user_id = auth.uid()
  or id = auth.uid()
  or public.current_user_has_permission('employees.edit')
  or public.current_user_has_permission('employees.enable_login')
  or public.current_user_has_permission('employees.deactivate')
  or public.current_user_has_permission('employees.reset_password')
);

do $$
begin
  if to_regclass('public.role_outlets') is not null then
    execute 'alter table public.role_outlets enable row level security';
    execute 'grant select, insert, update, delete on table public.role_outlets to authenticated';
    execute 'drop policy if exists "authenticated users can view role outlets" on public.role_outlets';
    execute 'drop policy if exists "roles viewers can view role outlets" on public.role_outlets';
    execute 'create policy "authenticated users can view role outlets"
      on public.role_outlets for select to authenticated
      using (true)';
    execute 'drop policy if exists "role editors can manage role outlets" on public.role_outlets';
    execute 'create policy "role editors can manage role outlets"
      on public.role_outlets for all to authenticated
      using (public.current_user_has_permission(''roles.edit''))
      with check (public.current_user_has_permission(''roles.edit''))';
  end if;
end $$;

do $$
begin
  if to_regclass('public.outlets') is not null then
    execute 'alter table public.outlets enable row level security';
    execute 'grant select, insert, update, delete on table public.outlets to authenticated';
    execute 'revoke all on table public.outlets from anon';
    execute 'drop policy if exists "outlet viewers can view outlets" on public.outlets';
    execute 'drop policy if exists "authenticated users can view outlets" on public.outlets';
    execute 'create policy "outlet viewers can view outlets"
      on public.outlets for select to authenticated
      using (
        public.current_user_has_permission(''outlets.view'')
        or public.current_user_has_permission(''dashboard.view'')
        or public.current_user_has_permission(''sales_input.view'')
        or public.current_user_has_permission(''purchase_input.view'')
        or public.current_user_has_permission(''data_import.view'')
      )';
    execute 'drop policy if exists "outlet creators can insert outlets" on public.outlets';
    execute 'create policy "outlet creators can insert outlets"
      on public.outlets for insert to authenticated
      with check (public.current_user_has_permission(''outlets.create''))';
    execute 'drop policy if exists "outlet editors can update outlets" on public.outlets';
    execute 'create policy "outlet editors can update outlets"
      on public.outlets for update to authenticated
      using (public.current_user_has_permission(''outlets.edit''))
      with check (public.current_user_has_permission(''outlets.edit''))';
    execute 'drop policy if exists "outlet deleters can delete outlets" on public.outlets';
    execute 'create policy "outlet deleters can delete outlets"
      on public.outlets for delete to authenticated
      using (public.current_user_has_permission(''outlets.delete''))';
  end if;
end $$;

do $$
begin
  if to_regclass('public.sales_channels') is not null then
    execute 'alter table public.sales_channels enable row level security';
    execute 'grant select, insert, update, delete on table public.sales_channels to authenticated';
    execute 'revoke all on table public.sales_channels from anon';
    execute 'drop policy if exists "sales channel viewers can view sales channels" on public.sales_channels';
    execute 'create policy "sales channel viewers can view sales channels"
      on public.sales_channels for select to authenticated
      using (
        public.current_user_has_permission(''sales_channels.view'')
        or public.current_user_has_permission(''dashboard.view'')
        or public.current_user_has_permission(''sales_input.view'')
        or public.current_user_has_permission(''sales_comparison.view'')
        or public.current_user_has_permission(''data_import.view'')
      )';
    execute 'drop policy if exists "sales channel creators can insert sales channels" on public.sales_channels';
    execute 'create policy "sales channel creators can insert sales channels"
      on public.sales_channels for insert to authenticated
      with check (public.current_user_has_permission(''sales_channels.create''))';
    execute 'drop policy if exists "sales channel editors can update sales channels" on public.sales_channels';
    execute 'create policy "sales channel editors can update sales channels"
      on public.sales_channels for update to authenticated
      using (public.current_user_has_permission(''sales_channels.edit''))
      with check (public.current_user_has_permission(''sales_channels.edit''))';
    execute 'drop policy if exists "sales channel deleters can delete sales channels" on public.sales_channels';
    execute 'create policy "sales channel deleters can delete sales channels"
      on public.sales_channels for delete to authenticated
      using (public.current_user_has_permission(''sales_channels.delete''))';
  end if;
end $$;

do $$
begin
  if to_regclass('public.outlet_tax_configs') is not null then
    execute 'alter table public.outlet_tax_configs enable row level security';
    execute 'grant select, insert, update, delete on table public.outlet_tax_configs to authenticated';
    execute 'revoke all on table public.outlet_tax_configs from anon';
    execute 'drop policy if exists "tax setting viewers can view tax settings" on public.outlet_tax_configs';
    execute 'create policy "tax setting viewers can view tax settings"
      on public.outlet_tax_configs for select to authenticated
      using (
        public.current_user_has_permission(''tax_settings.view'')
        or public.current_user_has_permission(''sales_input.view'')
        or public.current_user_has_permission(''sales_comparison.view'')
        or public.current_user_has_permission(''dashboard.view'')
      )';
    execute 'drop policy if exists "tax setting editors can insert tax settings" on public.outlet_tax_configs';
    execute 'create policy "tax setting editors can insert tax settings"
      on public.outlet_tax_configs for insert to authenticated
      with check (public.current_user_has_permission(''tax_settings.edit''))';
    execute 'drop policy if exists "tax setting editors can update tax settings" on public.outlet_tax_configs';
    execute 'create policy "tax setting editors can update tax settings"
      on public.outlet_tax_configs for update to authenticated
      using (public.current_user_has_permission(''tax_settings.edit''))
      with check (public.current_user_has_permission(''tax_settings.edit''))';
    execute 'drop policy if exists "tax setting editors can delete tax settings" on public.outlet_tax_configs';
    execute 'create policy "tax setting editors can delete tax settings"
      on public.outlet_tax_configs for delete to authenticated
      using (public.current_user_has_permission(''tax_settings.edit''))';
  end if;
end $$;

do $$
begin
  if to_regclass('public.suppliers') is not null then
    execute 'alter table public.suppliers enable row level security';
    execute 'grant select, insert, update, delete on table public.suppliers to authenticated';
    execute 'revoke all on table public.suppliers from anon';
    execute 'drop policy if exists "supplier viewers can view suppliers" on public.suppliers';
    execute 'create policy "supplier viewers can view suppliers"
      on public.suppliers for select to authenticated
      using (
        public.current_user_has_permission(''suppliers.view'')
        or public.current_user_has_permission(''dashboard.view'')
        or public.current_user_has_permission(''purchase_input.view'')
        or public.current_user_has_permission(''purchase_comparison.view'')
        or public.current_user_has_permission(''data_import.view'')
      )';
    execute 'drop policy if exists "supplier creators can insert suppliers" on public.suppliers';
    execute 'create policy "supplier creators can insert suppliers"
      on public.suppliers for insert to authenticated
      with check (
        public.current_user_has_permission(''suppliers.create'')
        or public.current_user_has_permission(''data_import.import'')
      )';
    execute 'drop policy if exists "supplier editors can update suppliers" on public.suppliers';
    execute 'create policy "supplier editors can update suppliers"
      on public.suppliers for update to authenticated
      using (
        public.current_user_has_permission(''suppliers.edit'')
        or public.current_user_has_permission(''data_import.import'')
      )
      with check (
        public.current_user_has_permission(''suppliers.edit'')
        or public.current_user_has_permission(''data_import.import'')
      )';
    execute 'drop policy if exists "supplier deleters can delete suppliers" on public.suppliers';
    execute 'create policy "supplier deleters can delete suppliers"
      on public.suppliers for delete to authenticated
      using (public.current_user_has_permission(''suppliers.delete''))';
  end if;
end $$;

do $$
begin
  if to_regclass('public.purchase_categories') is not null then
    execute 'alter table public.purchase_categories enable row level security';
    execute 'grant select, insert, update, delete on table public.purchase_categories to authenticated';
    execute 'revoke all on table public.purchase_categories from anon';
    execute 'drop policy if exists "purchase category viewers can view purchase categories" on public.purchase_categories';
    execute 'create policy "purchase category viewers can view purchase categories"
      on public.purchase_categories for select to authenticated
      using (
        public.current_user_has_permission(''purchase_categories.view'')
        or public.current_user_has_permission(''dashboard.view'')
        or public.current_user_has_permission(''purchase_input.view'')
        or public.current_user_has_permission(''purchase_comparison.view'')
        or public.current_user_has_permission(''data_import.view'')
      )';
    execute 'drop policy if exists "purchase category creators can insert purchase categories" on public.purchase_categories';
    execute 'create policy "purchase category creators can insert purchase categories"
      on public.purchase_categories for insert to authenticated
      with check (
        public.current_user_has_permission(''purchase_categories.create'')
        or public.current_user_has_permission(''data_import.import'')
      )';
    execute 'drop policy if exists "purchase category editors can update purchase categories" on public.purchase_categories';
    execute 'create policy "purchase category editors can update purchase categories"
      on public.purchase_categories for update to authenticated
      using (
        public.current_user_has_permission(''purchase_categories.edit'')
        or public.current_user_has_permission(''data_import.import'')
      )
      with check (
        public.current_user_has_permission(''purchase_categories.edit'')
        or public.current_user_has_permission(''data_import.import'')
      )';
    execute 'drop policy if exists "purchase category deleters can delete purchase categories" on public.purchase_categories';
    execute 'create policy "purchase category deleters can delete purchase categories"
      on public.purchase_categories for delete to authenticated
      using (public.current_user_has_permission(''purchase_categories.delete''))';
  end if;
end $$;

do $$
begin
  if to_regclass('public.departments') is not null then
    execute 'alter table public.departments enable row level security';
    execute 'grant select, insert, update, delete on table public.departments to authenticated';
    execute 'drop policy if exists "department viewers can view departments" on public.departments';
    execute 'create policy "department viewers can view departments"
      on public.departments for select to authenticated
      using (public.current_user_has_permission(''departments.view'') or public.current_user_has_permission(''employees.view''))';
    execute 'drop policy if exists "department creators can insert departments" on public.departments';
    execute 'create policy "department creators can insert departments"
      on public.departments for insert to authenticated
      with check (public.current_user_has_permission(''departments.create''))';
    execute 'drop policy if exists "department editors can update departments" on public.departments';
    execute 'create policy "department editors can update departments"
      on public.departments for update to authenticated
      using (public.current_user_has_permission(''departments.edit''))
      with check (public.current_user_has_permission(''departments.edit''))';
    execute 'drop policy if exists "department deleters can delete departments" on public.departments';
    execute 'create policy "department deleters can delete departments"
      on public.departments for delete to authenticated
      using (public.current_user_has_permission(''departments.delete''))';
  end if;
end $$;

do $$
begin
  if to_regclass('public.job_positions') is not null then
    execute 'alter table public.job_positions enable row level security';
    execute 'grant select, insert, update, delete on table public.job_positions to authenticated';
    execute 'drop policy if exists "job position viewers can view job positions" on public.job_positions';
    execute 'create policy "job position viewers can view job positions"
      on public.job_positions for select to authenticated
      using (public.current_user_has_permission(''job_positions.view'') or public.current_user_has_permission(''employees.view''))';
    execute 'drop policy if exists "job position creators can insert job positions" on public.job_positions';
    execute 'create policy "job position creators can insert job positions"
      on public.job_positions for insert to authenticated
      with check (public.current_user_has_permission(''job_positions.create''))';
    execute 'drop policy if exists "job position editors can update job positions" on public.job_positions';
    execute 'create policy "job position editors can update job positions"
      on public.job_positions for update to authenticated
      using (public.current_user_has_permission(''job_positions.edit''))
      with check (public.current_user_has_permission(''job_positions.edit''))';
    execute 'drop policy if exists "job position deleters can delete job positions" on public.job_positions';
    execute 'create policy "job position deleters can delete job positions"
      on public.job_positions for delete to authenticated
      using (public.current_user_has_permission(''job_positions.delete''))';
  end if;
end $$;

do $$
begin
  if to_regclass('public.sales_records') is not null then
    execute 'alter table public.sales_records enable row level security';
    execute 'grant select, insert, update, delete on table public.sales_records to authenticated';
    execute 'revoke all on table public.sales_records from anon';
    execute 'drop policy if exists "authenticated users can view sales records" on public.sales_records';
    execute 'drop policy if exists "sales editors can write sales records" on public.sales_records';
    execute 'drop policy if exists "sales input and comparison viewers can view sales records" on public.sales_records';
    execute 'drop policy if exists "sales input creators can insert sales records" on public.sales_records';
    execute 'drop policy if exists "sales input editors can update sales records" on public.sales_records';
    execute 'drop policy if exists "sales input deleters can delete sales records" on public.sales_records';
    execute 'drop policy if exists "sales records can be selected by permitted users" on public.sales_records';
    execute 'drop policy if exists "sales records can be inserted by permitted users" on public.sales_records';
    execute 'drop policy if exists "sales records can be updated by permitted users" on public.sales_records';
    execute 'drop policy if exists "sales records can be deleted by permitted users" on public.sales_records';
    execute 'create policy "sales records can be selected by permitted users"
      on public.sales_records for select to authenticated
      using (
        public.current_user_has_permission(''sales_input.view'')
        or public.current_user_has_permission(''sales_comparison.view'')
        or public.current_user_has_permission(''dashboard.view'')
      )';
    execute 'create policy "sales records can be inserted by permitted users"
      on public.sales_records for insert to authenticated
      with check (
        public.current_user_has_permission(''sales_input.create'')
        or public.current_user_has_permission(''data_import.import'')
      )';
    execute 'create policy "sales records can be updated by permitted users"
      on public.sales_records for update to authenticated
      using (
        public.current_user_has_permission(''sales_input.edit'')
        or public.current_user_has_permission(''data_import.import'')
      )
      with check (
        public.current_user_has_permission(''sales_input.edit'')
        or public.current_user_has_permission(''data_import.import'')
      )';
    execute 'create policy "sales records can be deleted by permitted users"
      on public.sales_records for delete to authenticated
      using (
        public.current_user_has_permission(''sales_input.delete'')
        or public.current_user_has_permission(''data_import.import'')
      )';
  end if;
end $$;

do $$
begin
  if to_regclass('public.purchase_records') is not null then
    execute 'alter table public.purchase_records enable row level security';
    execute 'grant select, insert, update, delete on table public.purchase_records to authenticated';
    execute 'revoke all on table public.purchase_records from anon';
    execute 'drop policy if exists "authenticated users can view purchase records" on public.purchase_records';
    execute 'drop policy if exists "purchase editors can write purchase records" on public.purchase_records';
    execute 'drop policy if exists "purchase input and comparison viewers can view purchase records" on public.purchase_records';
    execute 'drop policy if exists "purchase input creators can insert purchase records" on public.purchase_records';
    execute 'drop policy if exists "purchase input editors can update purchase records" on public.purchase_records';
    execute 'drop policy if exists "purchase input deleters can delete purchase records" on public.purchase_records';
    execute 'drop policy if exists "purchase records can be selected by permitted users" on public.purchase_records';
    execute 'drop policy if exists "purchase records can be inserted by permitted users" on public.purchase_records';
    execute 'drop policy if exists "purchase records can be updated by permitted users" on public.purchase_records';
    execute 'drop policy if exists "purchase records can be deleted by permitted users" on public.purchase_records';
    execute 'create policy "purchase records can be selected by permitted users"
      on public.purchase_records for select to authenticated
      using (
        public.current_user_has_permission(''purchase_input.view'')
        or public.current_user_has_permission(''purchase_comparison.view'')
        or public.current_user_has_permission(''dashboard.view'')
      )';
    execute 'create policy "purchase records can be inserted by permitted users"
      on public.purchase_records for insert to authenticated
      with check (
        public.current_user_has_permission(''purchase_input.create'')
        or public.current_user_has_permission(''data_import.import'')
      )';
    execute 'create policy "purchase records can be updated by permitted users"
      on public.purchase_records for update to authenticated
      using (
        public.current_user_has_permission(''purchase_input.edit'')
        or public.current_user_has_permission(''data_import.import'')
      )
      with check (
        public.current_user_has_permission(''purchase_input.edit'')
        or public.current_user_has_permission(''data_import.import'')
      )';
    execute 'create policy "purchase records can be deleted by permitted users"
      on public.purchase_records for delete to authenticated
      using (
        public.current_user_has_permission(''purchase_input.delete'')
        or public.current_user_has_permission(''data_import.import'')
      )';
  end if;
end $$;

do $$
begin
  if to_regclass('public.import_batches') is not null then
    execute 'alter table public.import_batches enable row level security';
    execute 'grant select, insert, update on table public.import_batches to authenticated';
    execute 'drop policy if exists "data import viewers can view import batches" on public.import_batches';
    execute 'create policy "data import viewers can view import batches"
      on public.import_batches for select to authenticated
      using (
        public.current_user_has_permission(''data_import.view'')
        or public.current_user_has_permission(''audit_logs.view'')
      )';
    execute 'drop policy if exists "data import users can create import batches" on public.import_batches';
    execute 'create policy "data import users can create import batches"
      on public.import_batches for insert to authenticated
      with check (public.current_user_has_permission(''data_import.import''))';
    execute 'drop policy if exists "data import users can update import batches" on public.import_batches';
    execute 'create policy "data import users can update import batches"
      on public.import_batches for update to authenticated
      using (public.current_user_has_permission(''data_import.import''))
      with check (public.current_user_has_permission(''data_import.import''))';
  end if;

  if to_regclass('public.import_batch_rows') is not null then
    execute 'alter table public.import_batch_rows enable row level security';
    execute 'grant select, insert on table public.import_batch_rows to authenticated';
    execute 'drop policy if exists "data import viewers can view import batch rows" on public.import_batch_rows';
    execute 'create policy "data import viewers can view import batch rows"
      on public.import_batch_rows for select to authenticated
      using (
        public.current_user_has_permission(''data_import.view'')
        or public.current_user_has_permission(''audit_logs.view'')
      )';
    execute 'drop policy if exists "data import users can create import batch rows" on public.import_batch_rows';
    execute 'create policy "data import users can create import batch rows"
      on public.import_batch_rows for insert to authenticated
      with check (public.current_user_has_permission(''data_import.import''))';
  end if;
end $$;

do $$
begin
  if to_regclass('public.audit_logs') is not null then
    execute 'alter table public.audit_logs enable row level security';
    execute 'grant select, insert on table public.audit_logs to authenticated';
    execute 'drop policy if exists "audit viewers can view audit logs" on public.audit_logs';
    execute 'drop policy if exists "audit log viewers can view audit logs" on public.audit_logs';
    execute 'create policy "audit log viewers can view audit logs"
      on public.audit_logs for select to authenticated
      using (public.current_user_has_permission(''audit_logs.view''))';
    execute 'drop policy if exists "authenticated users can insert audit logs" on public.audit_logs';
    execute 'create policy "authenticated users can insert audit logs"
      on public.audit_logs for insert to authenticated
      with check (auth.uid() is not null)';
  end if;
end $$;
