-- Fix Employee-first RBAC/RLS resolution for non-owner roles.
-- The app now stores access profiles in public.employees.

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  name text unique not null
);

create table if not exists public.permissions (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  module text not null default 'Unknown'
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
  add column if not exists email text;

create index if not exists employees_auth_user_id_idx on public.employees(auth_user_id);
create index if not exists employees_email_lower_idx on public.employees(lower(email));
create index if not exists employees_role_id_idx on public.employees(role_id);

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
grant select on table public.roles to authenticated;
grant select on table public.permissions to authenticated;
grant select on table public.role_permissions to authenticated;

alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.employees enable row level security;

drop policy if exists "authenticated users can view roles" on public.roles;
create policy "authenticated users can view roles"
on public.roles for select to authenticated
using (true);

drop policy if exists "authenticated users can view permissions" on public.permissions;
create policy "authenticated users can view permissions"
on public.permissions for select to authenticated
using (true);

drop policy if exists "authenticated users can view role permissions" on public.role_permissions;
create policy "authenticated users can view role permissions"
on public.role_permissions for select to authenticated
using (true);

drop policy if exists "employees can view own profile or employee viewers can view all" on public.employees;
create policy "employees can view own profile or employee viewers can view all"
on public.employees for select to authenticated
using (
  auth_user_id = auth.uid()
  or id = auth.uid()
  or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  or public.current_user_has_permission('employees.view')
);

drop policy if exists "employee viewers can view employees" on public.employees;
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

do $$
begin
  if to_regclass('public.outlets') is not null then
    execute 'grant select on table public.outlets to authenticated';
    execute 'drop policy if exists "outlet viewers can view outlets" on public.outlets';
    execute 'create policy "outlet viewers can view outlets"
      on public.outlets for select to authenticated
      using (
        public.current_user_has_permission(''outlets.view'')
        or public.current_user_has_permission(''dashboard.view'')
      )';
  end if;

  if to_regclass('public.suppliers') is not null then
    execute 'grant select on table public.suppliers to authenticated';
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
  end if;

  if to_regclass('public.purchase_categories') is not null then
    execute 'grant select on table public.purchase_categories to authenticated';
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
  end if;

  if to_regclass('public.sales_channels') is not null then
    execute 'grant select on table public.sales_channels to authenticated';
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
  end if;

  if to_regclass('public.outlet_tax_configs') is not null then
    execute 'grant select on table public.outlet_tax_configs to authenticated';
    execute 'drop policy if exists "tax setting viewers can view tax settings" on public.outlet_tax_configs';
    execute 'create policy "tax setting viewers can view tax settings"
      on public.outlet_tax_configs for select to authenticated
      using (
        public.current_user_has_permission(''tax_settings.view'')
        or public.current_user_has_permission(''sales_input.view'')
        or public.current_user_has_permission(''dashboard.view'')
      )';
  end if;
end $$;
