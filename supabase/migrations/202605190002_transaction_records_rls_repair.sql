-- Production hotfix: transaction record RLS must match feature-level RBAC.
-- This migration is data-safe: it only repairs permission seeds, grants and
-- sales_records / purchase_records policies.

create extension if not exists pgcrypto;

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  name text unique not null
);

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
  ('purchase_input.view', 'Purchase Input', 'View Purchase Input.'),
  ('purchase_input.create', 'Purchase Input', 'Create Purchase Input records.'),
  ('purchase_input.edit', 'Purchase Input', 'Edit Purchase Input records.'),
  ('purchase_input.delete', 'Purchase Input', 'Delete Purchase Input records.'),
  ('purchase_input.approve', 'Purchase Input', 'Approve Purchase Input records.'),
  ('purchase_comparison.view', 'Purchase Comparison', 'View Purchase Comparison.'),
  ('purchase_comparison.export', 'Purchase Comparison', 'Export Purchase Comparison.'),
  ('data_import.view', 'Data Import', 'View Data Import.'),
  ('data_import.import', 'Data Import', 'Import data.')
on conflict (code) do update
set module = excluded.module,
    description = excluded.description;

insert into public.roles (name)
values ('owner'), ('admin')
on conflict (name) do nothing;

-- Owner/admin protected roles always receive every current permission.
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
      and e.is_active = true
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

do $$
begin
  if to_regclass('public.sales_records') is not null then
    alter table public.sales_records enable row level security;
    revoke all on table public.sales_records from anon;
    grant select, insert, update, delete on table public.sales_records to authenticated;

    drop policy if exists "authenticated users can view sales records" on public.sales_records;
    drop policy if exists "sales editors can write sales records" on public.sales_records;
    drop policy if exists "sales input and comparison viewers can view sales records" on public.sales_records;
    drop policy if exists "sales input creators can insert sales records" on public.sales_records;
    drop policy if exists "sales input editors can update sales records" on public.sales_records;
    drop policy if exists "sales input deleters can delete sales records" on public.sales_records;
    drop policy if exists "sales records can be selected by permitted users" on public.sales_records;
    drop policy if exists "sales records can be inserted by permitted users" on public.sales_records;
    drop policy if exists "sales records can be updated by permitted users" on public.sales_records;
    drop policy if exists "sales records can be deleted by permitted users" on public.sales_records;

    create policy "sales records can be selected by permitted users"
    on public.sales_records for select to authenticated
    using (
      public.current_user_has_permission('sales_input.view')
      or public.current_user_has_permission('sales_comparison.view')
      or public.current_user_has_permission('dashboard.view')
    );

    create policy "sales records can be inserted by permitted users"
    on public.sales_records for insert to authenticated
    with check (
      public.current_user_has_permission('sales_input.create')
      or public.current_user_has_permission('data_import.import')
    );

    create policy "sales records can be updated by permitted users"
    on public.sales_records for update to authenticated
    using (
      public.current_user_has_permission('sales_input.edit')
      or public.current_user_has_permission('data_import.import')
    )
    with check (
      public.current_user_has_permission('sales_input.edit')
      or public.current_user_has_permission('data_import.import')
    );

    create policy "sales records can be deleted by permitted users"
    on public.sales_records for delete to authenticated
    using (
      public.current_user_has_permission('sales_input.delete')
      or public.current_user_has_permission('data_import.import')
    );
  end if;

  if to_regclass('public.purchase_records') is not null then
    alter table public.purchase_records enable row level security;
    revoke all on table public.purchase_records from anon;
    grant select, insert, update, delete on table public.purchase_records to authenticated;

    drop policy if exists "authenticated users can view purchase records" on public.purchase_records;
    drop policy if exists "purchase editors can write purchase records" on public.purchase_records;
    drop policy if exists "purchase input and comparison viewers can view purchase records" on public.purchase_records;
    drop policy if exists "purchase input creators can insert purchase records" on public.purchase_records;
    drop policy if exists "purchase input editors can update purchase records" on public.purchase_records;
    drop policy if exists "purchase input deleters can delete purchase records" on public.purchase_records;
    drop policy if exists "purchase records can be selected by permitted users" on public.purchase_records;
    drop policy if exists "purchase records can be inserted by permitted users" on public.purchase_records;
    drop policy if exists "purchase records can be updated by permitted users" on public.purchase_records;
    drop policy if exists "purchase records can be deleted by permitted users" on public.purchase_records;

    create policy "purchase records can be selected by permitted users"
    on public.purchase_records for select to authenticated
    using (
      public.current_user_has_permission('purchase_input.view')
      or public.current_user_has_permission('purchase_comparison.view')
      or public.current_user_has_permission('dashboard.view')
    );

    create policy "purchase records can be inserted by permitted users"
    on public.purchase_records for insert to authenticated
    with check (
      public.current_user_has_permission('purchase_input.create')
      or public.current_user_has_permission('data_import.import')
    );

    create policy "purchase records can be updated by permitted users"
    on public.purchase_records for update to authenticated
    using (
      public.current_user_has_permission('purchase_input.edit')
      or public.current_user_has_permission('data_import.import')
    )
    with check (
      public.current_user_has_permission('purchase_input.edit')
      or public.current_user_has_permission('data_import.import')
    );

    create policy "purchase records can be deleted by permitted users"
    on public.purchase_records for delete to authenticated
    using (
      public.current_user_has_permission('purchase_input.delete')
      or public.current_user_has_permission('data_import.import')
    );
  end if;
end $$;
