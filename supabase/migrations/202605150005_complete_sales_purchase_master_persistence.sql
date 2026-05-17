-- Production Sprint 3C
-- Guard Sales/Purchase master data and comparison persistence tables.
-- Align RLS with the feature-level module registry permission codes.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Permission guards
-- ---------------------------------------------------------------------------
insert into public.permissions (code, module, description)
values
  ('sales_channels.view', 'Sales Channels', 'View Sales Channels.'),
  ('sales_channels.create', 'Sales Channels', 'Create Sales Channels.'),
  ('sales_channels.edit', 'Sales Channels', 'Edit Sales Channels.'),
  ('sales_channels.delete', 'Sales Channels', 'Delete Sales Channels.'),
  ('tax_settings.view', 'Tax Settings', 'View Tax Settings.'),
  ('tax_settings.edit', 'Tax Settings', 'Edit Tax Settings.'),
  ('suppliers.view', 'Suppliers', 'View Suppliers.'),
  ('suppliers.create', 'Suppliers', 'Create Suppliers.'),
  ('suppliers.edit', 'Suppliers', 'Edit Suppliers.'),
  ('suppliers.delete', 'Suppliers', 'Delete Suppliers.'),
  ('purchase_categories.view', 'Purchase Categories', 'View Purchase Categories.'),
  ('purchase_categories.create', 'Purchase Categories', 'Create Purchase Categories.'),
  ('purchase_categories.edit', 'Purchase Categories', 'Edit Purchase Categories.'),
  ('purchase_categories.delete', 'Purchase Categories', 'Delete Purchase Categories.'),
  ('sales_comparison.view', 'Sales Comparison', 'View Sales Comparison.'),
  ('sales_comparison.export', 'Sales Comparison', 'Export Sales Comparison.'),
  ('purchase_comparison.view', 'Purchase Comparison', 'View Purchase Comparison.'),
  ('purchase_comparison.export', 'Purchase Comparison', 'Export Purchase Comparison.')
on conflict (code) do update
set module = excluded.module,
    description = excluded.description;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.name in ('owner', 'admin')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Master tables
-- ---------------------------------------------------------------------------
create table if not exists public.sales_channels (
  id uuid primary key default gen_random_uuid()
);

alter table public.sales_channels
  add column if not exists name text,
  add column if not exists type text not null default 'channel',
  add column if not exists sort_order integer not null default 0,
  add column if not exists status text not null default 'active',
  add column if not exists is_active boolean not null default true,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

update public.sales_channels
set status = case when is_active then 'active' else 'inactive' end
where status is null or status not in ('active', 'inactive');

create index if not exists sales_channels_name_idx on public.sales_channels (name);

create table if not exists public.purchase_categories (
  id uuid primary key default gen_random_uuid()
);

alter table public.purchase_categories
  add column if not exists name text,
  add column if not exists sort_order integer not null default 0,
  add column if not exists status text not null default 'active',
  add column if not exists is_active boolean not null default true,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

update public.purchase_categories
set status = case when is_active then 'active' else 'inactive' end
where status is null or status not in ('active', 'inactive');

create index if not exists purchase_categories_name_idx on public.purchase_categories (name);

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid()
);

alter table public.suppliers
  add column if not exists name text,
  add column if not exists category text,
  add column if not exists default_category_id uuid references public.purchase_categories(id) on delete set null,
  add column if not exists status text not null default 'active',
  add column if not exists is_active boolean not null default true,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

update public.suppliers
set status = case when is_active then 'active' else 'inactive' end
where status is null or status not in ('active', 'inactive');

create index if not exists suppliers_name_idx on public.suppliers (name);
create index if not exists suppliers_default_category_idx on public.suppliers (default_category_id);

create table if not exists public.outlet_tax_configs (
  id uuid primary key default gen_random_uuid()
);

alter table public.outlet_tax_configs
  add column if not exists outlet_id uuid references public.outlets(id) on delete cascade,
  add column if not exists tax_type text not null default 'SST',
  add column if not exists enabled boolean not null default false,
  add column if not exists rate numeric(8,3) not null default 0,
  add column if not exists effective_from text,
  add column if not exists effective_until text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create index if not exists outlet_tax_configs_scope_idx
  on public.outlet_tax_configs (outlet_id, tax_type, effective_from);

-- ---------------------------------------------------------------------------
-- Transaction table guards
-- ---------------------------------------------------------------------------
create table if not exists public.sales_records (
  id uuid primary key default gen_random_uuid()
);

alter table public.sales_records
  add column if not exists outlet_id uuid references public.outlets(id) on delete cascade,
  add column if not exists year integer,
  add column if not exists month integer,
  add column if not exists channel_id uuid references public.sales_channels(id) on delete set null,
  add column if not exists channel_name text,
  add column if not exists amount numeric(14,2) not null default 0,
  add column if not exists remark text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.purchase_records (
  id uuid primary key default gen_random_uuid()
);

alter table public.purchase_records
  add column if not exists outlet_id uuid references public.outlets(id) on delete cascade,
  add column if not exists year integer,
  add column if not exists month integer,
  add column if not exists supplier_id uuid references public.suppliers(id) on delete restrict,
  add column if not exists supplier_name text,
  add column if not exists category_id uuid references public.purchase_categories(id) on delete restrict,
  add column if not exists category_name text,
  add column if not exists amount numeric(14,2) not null default 0,
  add column if not exists remark text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create index if not exists sales_records_period_idx on public.sales_records (outlet_id, year, month);
create index if not exists purchase_records_period_idx on public.purchase_records (outlet_id, year, month);

-- ---------------------------------------------------------------------------
-- Grants and RLS
-- ---------------------------------------------------------------------------
grant usage on schema public to authenticated;

revoke all on table public.sales_channels from anon;
revoke all on table public.purchase_categories from anon;
revoke all on table public.suppliers from anon;
revoke all on table public.outlet_tax_configs from anon;
revoke all on table public.sales_records from anon;
revoke all on table public.purchase_records from anon;

grant select, insert, update, delete on table public.sales_channels to authenticated;
grant select, insert, update, delete on table public.purchase_categories to authenticated;
grant select, insert, update, delete on table public.suppliers to authenticated;
grant select, insert, update, delete on table public.outlet_tax_configs to authenticated;
grant select, insert, update, delete on table public.sales_records to authenticated;
grant select, insert, update, delete on table public.purchase_records to authenticated;

alter table public.sales_channels enable row level security;
alter table public.purchase_categories enable row level security;
alter table public.suppliers enable row level security;
alter table public.outlet_tax_configs enable row level security;
alter table public.sales_records enable row level security;
alter table public.purchase_records enable row level security;

-- Sales Channels
drop policy if exists "sales channel viewers can view sales channels" on public.sales_channels;
create policy "sales channel viewers can view sales channels"
on public.sales_channels for select to authenticated
using (
  public.current_user_has_permission('sales_channels.view')
  or public.current_user_has_permission('sales_input.view')
  or public.current_user_has_permission('sales_comparison.view')
);

drop policy if exists "sales channel creators can insert sales channels" on public.sales_channels;
create policy "sales channel creators can insert sales channels"
on public.sales_channels for insert to authenticated
with check (public.current_user_has_permission('sales_channels.create'));

drop policy if exists "sales channel editors can update sales channels" on public.sales_channels;
create policy "sales channel editors can update sales channels"
on public.sales_channels for update to authenticated
using (public.current_user_has_permission('sales_channels.edit'))
with check (public.current_user_has_permission('sales_channels.edit'));

drop policy if exists "sales channel deleters can delete sales channels" on public.sales_channels;
create policy "sales channel deleters can delete sales channels"
on public.sales_channels for delete to authenticated
using (public.current_user_has_permission('sales_channels.delete'));

-- Tax Settings
drop policy if exists "tax setting viewers can view tax settings" on public.outlet_tax_configs;
create policy "tax setting viewers can view tax settings"
on public.outlet_tax_configs for select to authenticated
using (
  public.current_user_has_permission('tax_settings.view')
  or public.current_user_has_permission('sales_input.view')
  or public.current_user_has_permission('sales_comparison.view')
  or public.current_user_has_permission('data_health.view')
);

drop policy if exists "tax setting editors can insert tax settings" on public.outlet_tax_configs;
create policy "tax setting editors can insert tax settings"
on public.outlet_tax_configs for insert to authenticated
with check (public.current_user_has_permission('tax_settings.edit'));

drop policy if exists "tax setting editors can update tax settings" on public.outlet_tax_configs;
create policy "tax setting editors can update tax settings"
on public.outlet_tax_configs for update to authenticated
using (public.current_user_has_permission('tax_settings.edit'))
with check (public.current_user_has_permission('tax_settings.edit'));

drop policy if exists "tax setting editors can delete tax settings" on public.outlet_tax_configs;
create policy "tax setting editors can delete tax settings"
on public.outlet_tax_configs for delete to authenticated
using (public.current_user_has_permission('tax_settings.edit'));

-- Suppliers
drop policy if exists "supplier viewers can view suppliers" on public.suppliers;
create policy "supplier viewers can view suppliers"
on public.suppliers for select to authenticated
using (
  public.current_user_has_permission('suppliers.view')
  or public.current_user_has_permission('purchase_input.view')
  or public.current_user_has_permission('purchase_comparison.view')
);

drop policy if exists "supplier creators can insert suppliers" on public.suppliers;
create policy "supplier creators can insert suppliers"
on public.suppliers for insert to authenticated
with check (public.current_user_has_permission('suppliers.create'));

drop policy if exists "supplier editors can update suppliers" on public.suppliers;
create policy "supplier editors can update suppliers"
on public.suppliers for update to authenticated
using (public.current_user_has_permission('suppliers.edit'))
with check (public.current_user_has_permission('suppliers.edit'));

drop policy if exists "supplier deleters can delete suppliers" on public.suppliers;
create policy "supplier deleters can delete suppliers"
on public.suppliers for delete to authenticated
using (public.current_user_has_permission('suppliers.delete'));

-- Purchase Categories
drop policy if exists "purchase category viewers can view purchase categories" on public.purchase_categories;
create policy "purchase category viewers can view purchase categories"
on public.purchase_categories for select to authenticated
using (
  public.current_user_has_permission('purchase_categories.view')
  or public.current_user_has_permission('purchase_input.view')
  or public.current_user_has_permission('purchase_comparison.view')
);

drop policy if exists "purchase category creators can insert purchase categories" on public.purchase_categories;
create policy "purchase category creators can insert purchase categories"
on public.purchase_categories for insert to authenticated
with check (public.current_user_has_permission('purchase_categories.create'));

drop policy if exists "purchase category editors can update purchase categories" on public.purchase_categories;
create policy "purchase category editors can update purchase categories"
on public.purchase_categories for update to authenticated
using (public.current_user_has_permission('purchase_categories.edit'))
with check (public.current_user_has_permission('purchase_categories.edit'));

drop policy if exists "purchase category deleters can delete purchase categories" on public.purchase_categories;
create policy "purchase category deleters can delete purchase categories"
on public.purchase_categories for delete to authenticated
using (public.current_user_has_permission('purchase_categories.delete'));

-- Sales Records
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

-- Purchase Records
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
