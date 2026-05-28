-- Inventory Control outlet-specific stock configuration
-- Separates global inventory item identity from outlet par settings.

create extension if not exists pgcrypto;

insert into public.permissions (code, module, description)
values
  ('inventory_categories.view', 'Inventory Categories', 'View inventory categories.'),
  ('inventory_categories.create', 'Inventory Categories', 'Create inventory categories.'),
  ('inventory_categories.edit', 'Inventory Categories', 'Edit inventory categories.'),
  ('inventory_categories.delete', 'Inventory Categories', 'Delete inventory categories.'),
  ('inventory_par_levels.view', 'Par Levels', 'View inventory par levels.'),
  ('inventory_par_levels.edit', 'Par Levels', 'Edit inventory par levels.'),
  ('inventory_par_levels.export', 'Par Levels', 'Export inventory par levels.'),
  ('inventory_master.import', 'Master Inventory', 'Import master inventory.'),
  ('inventory_master.export', 'Master Inventory', 'Export master inventory.')
on conflict (code) do update
set module = excluded.module,
    description = excluded.description;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.name in ('owner', 'admin')
on conflict do nothing;

create table if not exists public.inventory_categories (
  id uuid primary key default gen_random_uuid()
);

alter table public.inventory_categories
  add column if not exists name text,
  add column if not exists description text,
  add column if not exists sort_order integer not null default 0,
  add column if not exists status text not null default 'active',
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid()
);

alter table public.inventory_items
  add column if not exists item_name text,
  add column if not exists sku_code text,
  add column if not exists category_id uuid references public.inventory_categories(id) on delete set null,
  add column if not exists unit text,
  add column if not exists photo_url text,
  add column if not exists description text,
  add column if not exists inventory_type text,
  add column if not exists default_supplier_id uuid references public.suppliers(id) on delete set null,
  add column if not exists status text not null default 'active',
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_by uuid references auth.users(id) on delete set null,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.inventory_item_outlets (
  id uuid primary key default gen_random_uuid()
);

alter table public.inventory_item_outlets
  add column if not exists inventory_item_id uuid references public.inventory_items(id) on delete cascade,
  add column if not exists outlet_id uuid references public.outlets(id) on delete cascade,
  add column if not exists par_level numeric(14,3) not null default 0,
  add column if not exists storage_location text,
  add column if not exists is_active boolean not null default true,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create index if not exists inventory_categories_status_idx on public.inventory_categories (status, sort_order);
create index if not exists inventory_items_category_idx on public.inventory_items (category_id);
create index if not exists inventory_items_status_idx on public.inventory_items (status);
create index if not exists inventory_item_outlets_item_idx on public.inventory_item_outlets (inventory_item_id);
create index if not exists inventory_item_outlets_outlet_idx on public.inventory_item_outlets (outlet_id);
create unique index if not exists inventory_item_outlets_unique_idx
  on public.inventory_item_outlets (inventory_item_id, outlet_id);

create table if not exists public.inventory_stock_check_group_categories (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null,
  category_id uuid references public.inventory_categories(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists inventory_stock_check_group_categories_group_idx
  on public.inventory_stock_check_group_categories (group_id);
create index if not exists inventory_stock_check_group_categories_category_idx
  on public.inventory_stock_check_group_categories (category_id);
create unique index if not exists inventory_stock_check_group_categories_unique_idx
  on public.inventory_stock_check_group_categories (group_id, category_id);

create table if not exists public.inventory_item_outlet_suppliers (
  id uuid primary key default gen_random_uuid(),
  inventory_item_outlet_id uuid references public.inventory_item_outlets(id) on delete cascade,
  supplier_id uuid references public.suppliers(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists inventory_item_outlet_suppliers_config_idx
  on public.inventory_item_outlet_suppliers (inventory_item_outlet_id);
create index if not exists inventory_item_outlet_suppliers_supplier_idx
  on public.inventory_item_outlet_suppliers (supplier_id);
create unique index if not exists inventory_item_outlet_suppliers_unique_idx
  on public.inventory_item_outlet_suppliers (inventory_item_outlet_id, supplier_id);

create table if not exists public.inventory_stock_checks (
  id uuid primary key default gen_random_uuid()
);

alter table public.inventory_stock_checks
  add column if not exists outlet_id uuid references public.outlets(id) on delete set null,
  add column if not exists group_id uuid,
  add column if not exists stock_check_type text not null default 'scheduled',
  add column if not exists audit_type text,
  add column if not exists audit_name text,
  add column if not exists notes text,
  add column if not exists status text not null default 'draft',
  add column if not exists submitted_at timestamptz,
  add column if not exists reviewed_at timestamptz,
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  alter table public.inventory_stock_checks
    add constraint inventory_stock_checks_type_check
    check (stock_check_type in ('scheduled', 'audit'));
exception
  when duplicate_object then null;
end $$;

create table if not exists public.inventory_stock_check_items (
  id uuid primary key default gen_random_uuid()
);

alter table public.inventory_stock_check_items
  add column if not exists stock_check_id uuid references public.inventory_stock_checks(id) on delete cascade,
  add column if not exists item_id uuid references public.inventory_items(id) on delete set null,
  add column if not exists par_level_quantity numeric(14,3) not null default 0,
  add column if not exists actual_count_quantity numeric(14,3) not null default 0,
  add column if not exists variance numeric(14,3) not null default 0,
  add column if not exists unit text,
  add column if not exists status text,
  add column if not exists notes text,
  add column if not exists created_at timestamptz not null default now();

create table if not exists public.inventory_purchase_orders (
  id uuid primary key default gen_random_uuid()
);

alter table public.inventory_purchase_orders
  add column if not exists po_no text,
  add column if not exists outlet_id uuid references public.outlets(id) on delete set null,
  add column if not exists supplier_id uuid references public.suppliers(id) on delete set null,
  add column if not exists status text not null default 'draft',
  add column if not exists source_type text,
  add column if not exists source_stock_check_id uuid references public.inventory_stock_checks(id) on delete set null,
  add column if not exists source_stock_request_id uuid,
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists submitted_at timestamptz,
  add column if not exists confirmed_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists completion_type text,
  add column if not exists completion_reason text,
  add column if not exists unfulfilled_qty numeric(14,3) not null default 0,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancellation_reason text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  alter table public.inventory_purchase_orders
    add constraint inventory_purchase_orders_completion_type_check
    check (completion_type is null or completion_type in ('full', 'partial'));
exception
  when duplicate_object then null;
end $$;

create table if not exists public.inventory_purchase_order_items (
  id uuid primary key default gen_random_uuid()
);

alter table public.inventory_purchase_order_items
  add column if not exists purchase_order_id uuid references public.inventory_purchase_orders(id) on delete cascade,
  add column if not exists item_id uuid references public.inventory_items(id) on delete set null,
  add column if not exists requested_qty numeric(14,3) not null default 0,
  add column if not exists received_qty numeric(14,3) not null default 0,
  add column if not exists unit text,
  add column if not exists remark text,
  add column if not exists source_stock_check_item_id uuid references public.inventory_stock_check_items(id) on delete set null,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.inventory_purchase_receipts (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid references public.inventory_purchase_orders(id) on delete cascade,
  outlet_id uuid references public.outlets(id) on delete set null,
  supplier_id uuid references public.suppliers(id) on delete set null,
  received_by uuid references auth.users(id) on delete set null,
  received_at timestamptz not null default now(),
  remark text,
  created_at timestamptz not null default now()
);

create table if not exists public.inventory_purchase_receipt_items (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid references public.inventory_purchase_receipts(id) on delete cascade,
  purchase_order_item_id uuid references public.inventory_purchase_order_items(id) on delete set null,
  item_id uuid references public.inventory_items(id) on delete set null,
  received_qty numeric(14,3) not null default 0,
  unit text,
  remark text,
  created_at timestamptz not null default now()
);

grant select, insert, update, delete on table public.inventory_categories to authenticated;
grant select, insert, update, delete on table public.inventory_items to authenticated;
grant select, insert, update, delete on table public.inventory_item_outlets to authenticated;
grant select, insert, update, delete on table public.inventory_stock_check_group_categories to authenticated;
grant select, insert, update, delete on table public.inventory_item_outlet_suppliers to authenticated;
grant select, insert, update, delete on table public.inventory_stock_checks to authenticated;
grant select, insert, update, delete on table public.inventory_stock_check_items to authenticated;
grant select, insert, update, delete on table public.inventory_purchase_orders to authenticated;
grant select, insert, update, delete on table public.inventory_purchase_order_items to authenticated;
grant select, insert, update, delete on table public.inventory_purchase_receipts to authenticated;
grant select, insert, update, delete on table public.inventory_purchase_receipt_items to authenticated;
revoke all on table public.inventory_categories from anon;
revoke all on table public.inventory_items from anon;
revoke all on table public.inventory_item_outlets from anon;
revoke all on table public.inventory_stock_check_group_categories from anon;
revoke all on table public.inventory_item_outlet_suppliers from anon;
revoke all on table public.inventory_stock_checks from anon;
revoke all on table public.inventory_stock_check_items from anon;
revoke all on table public.inventory_purchase_orders from anon;
revoke all on table public.inventory_purchase_order_items from anon;
revoke all on table public.inventory_purchase_receipts from anon;
revoke all on table public.inventory_purchase_receipt_items from anon;

alter table public.inventory_categories enable row level security;
alter table public.inventory_items enable row level security;
alter table public.inventory_item_outlets enable row level security;
alter table public.inventory_stock_check_group_categories enable row level security;
alter table public.inventory_item_outlet_suppliers enable row level security;
alter table public.inventory_stock_checks enable row level security;
alter table public.inventory_stock_check_items enable row level security;
alter table public.inventory_purchase_orders enable row level security;
alter table public.inventory_purchase_order_items enable row level security;
alter table public.inventory_purchase_receipts enable row level security;
alter table public.inventory_purchase_receipt_items enable row level security;

drop policy if exists "inventory category viewers can view categories" on public.inventory_categories;
create policy "inventory category viewers can view categories"
on public.inventory_categories for select to authenticated
using (
  public.current_user_has_permission('inventory_categories.view')
  or public.current_user_has_permission('inventory_master.view')
  or public.current_user_has_permission('inventory_control.view')
);

drop policy if exists "inventory category creators can create categories" on public.inventory_categories;
create policy "inventory category creators can create categories"
on public.inventory_categories for insert to authenticated
with check (public.current_user_has_permission('inventory_categories.create') or public.current_user_has_permission('inventory_control.manage_categories'));

drop policy if exists "inventory category editors can update categories" on public.inventory_categories;
create policy "inventory category editors can update categories"
on public.inventory_categories for update to authenticated
using (public.current_user_has_permission('inventory_categories.edit') or public.current_user_has_permission('inventory_control.manage_categories'))
with check (public.current_user_has_permission('inventory_categories.edit') or public.current_user_has_permission('inventory_control.manage_categories'));

drop policy if exists "inventory category deleters can delete categories" on public.inventory_categories;
create policy "inventory category deleters can delete categories"
on public.inventory_categories for delete to authenticated
using (public.current_user_has_permission('inventory_categories.delete') or public.current_user_has_permission('inventory_control.manage_categories'));

drop policy if exists "inventory master viewers can view items" on public.inventory_items;
create policy "inventory master viewers can view items"
on public.inventory_items for select to authenticated
using (
  public.current_user_has_permission('inventory_master.view')
  or public.current_user_has_permission('inventory_stock_check.view')
  or public.current_user_has_permission('inventory_requests.view')
  or public.current_user_has_permission('inventory_orders.view')
  or public.current_user_has_permission('inventory_movements.view')
  or public.current_user_has_permission('inventory_waste.view')
  or public.current_user_has_permission('inventory_recipes.view')
  or public.current_user_has_permission('inventory_control.view')
);

drop policy if exists "inventory master creators can create items" on public.inventory_items;
create policy "inventory master creators can create items"
on public.inventory_items for insert to authenticated
with check (public.current_user_has_permission('inventory_master.create') or public.current_user_has_permission('inventory_control.manage_master'));

drop policy if exists "inventory master editors can update items" on public.inventory_items;
create policy "inventory master editors can update items"
on public.inventory_items for update to authenticated
using (public.current_user_has_permission('inventory_master.edit') or public.current_user_has_permission('inventory_control.manage_master'))
with check (public.current_user_has_permission('inventory_master.edit') or public.current_user_has_permission('inventory_control.manage_master'));

drop policy if exists "inventory master deleters can delete items" on public.inventory_items;
create policy "inventory master deleters can delete items"
on public.inventory_items for delete to authenticated
using (public.current_user_has_permission('inventory_master.delete') or public.current_user_has_permission('inventory_control.manage_master'));

drop policy if exists "inventory outlet config viewers can view configs" on public.inventory_item_outlets;
create policy "inventory outlet config viewers can view configs"
on public.inventory_item_outlets for select to authenticated
using (
  (
    public.current_user_has_permission('inventory_master.view')
    or public.current_user_has_permission('inventory_par_levels.view')
    or public.current_user_has_permission('inventory_stock_check.view')
    or public.current_user_has_permission('inventory_requests.view')
    or public.current_user_has_permission('inventory_control.view')
  )
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "inventory outlet config managers can create configs" on public.inventory_item_outlets;
create policy "inventory outlet config managers can create configs"
on public.inventory_item_outlets for insert to authenticated
with check (
  (
    public.current_user_has_permission('inventory_master.create')
    or public.current_user_has_permission('inventory_master.edit')
    or public.current_user_has_permission('inventory_par_levels.edit')
    or public.current_user_has_permission('inventory_control.manage_master')
  )
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "inventory outlet config managers can update configs" on public.inventory_item_outlets;
create policy "inventory outlet config managers can update configs"
on public.inventory_item_outlets for update to authenticated
using (
  (
    public.current_user_has_permission('inventory_master.edit')
    or public.current_user_has_permission('inventory_par_levels.edit')
    or public.current_user_has_permission('inventory_control.manage_master')
  )
  and public.current_user_can_access_outlet(outlet_id)
)
with check (
  (
    public.current_user_has_permission('inventory_master.edit')
    or public.current_user_has_permission('inventory_par_levels.edit')
    or public.current_user_has_permission('inventory_control.manage_master')
  )
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "inventory outlet config managers can delete configs" on public.inventory_item_outlets;
create policy "inventory outlet config managers can delete configs"
on public.inventory_item_outlets for delete to authenticated
using (
  (
    public.current_user_has_permission('inventory_master.delete')
    or public.current_user_has_permission('inventory_control.manage_master')
  )
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "inventory stock group category viewers can view links" on public.inventory_stock_check_group_categories;
create policy "inventory stock group category viewers can view links"
on public.inventory_stock_check_group_categories for select to authenticated
using (
  public.current_user_has_permission('inventory_groups.view')
  or public.current_user_has_permission('inventory_stock_check.view')
  or public.current_user_has_permission('inventory_control.view')
);

drop policy if exists "inventory stock group category managers can create links" on public.inventory_stock_check_group_categories;
create policy "inventory stock group category managers can create links"
on public.inventory_stock_check_group_categories for insert to authenticated
with check (
  public.current_user_has_permission('inventory_groups.create')
  or public.current_user_has_permission('inventory_groups.edit')
  or public.current_user_has_permission('inventory_control.manage_groups')
);

drop policy if exists "inventory stock group category managers can update links" on public.inventory_stock_check_group_categories;
create policy "inventory stock group category managers can update links"
on public.inventory_stock_check_group_categories for update to authenticated
using (
  public.current_user_has_permission('inventory_groups.edit')
  or public.current_user_has_permission('inventory_control.manage_groups')
)
with check (
  public.current_user_has_permission('inventory_groups.edit')
  or public.current_user_has_permission('inventory_control.manage_groups')
);

drop policy if exists "inventory stock group category managers can delete links" on public.inventory_stock_check_group_categories;
create policy "inventory stock group category managers can delete links"
on public.inventory_stock_check_group_categories for delete to authenticated
using (
  public.current_user_has_permission('inventory_groups.delete')
  or public.current_user_has_permission('inventory_groups.edit')
  or public.current_user_has_permission('inventory_control.manage_groups')
);

drop policy if exists "inventory outlet supplier viewers can view links" on public.inventory_item_outlet_suppliers;
create policy "inventory outlet supplier viewers can view links"
on public.inventory_item_outlet_suppliers for select to authenticated
using (
  (
    public.current_user_has_permission('inventory_par_levels.view')
    or public.current_user_has_permission('inventory_master.view')
    or public.current_user_has_permission('inventory_control.view')
  )
  and exists (
    select 1
    from public.inventory_item_outlets iio
    where iio.id = inventory_item_outlet_suppliers.inventory_item_outlet_id
      and public.current_user_can_access_outlet(iio.outlet_id)
  )
);

drop policy if exists "inventory outlet supplier managers can create links" on public.inventory_item_outlet_suppliers;
create policy "inventory outlet supplier managers can create links"
on public.inventory_item_outlet_suppliers for insert to authenticated
with check (
  (
    public.current_user_has_permission('inventory_par_levels.edit')
    or public.current_user_has_permission('inventory_master.edit')
    or public.current_user_has_permission('inventory_control.manage_master')
  )
  and exists (
    select 1
    from public.inventory_item_outlets iio
    join public.supplier_outlets so on so.outlet_id = iio.outlet_id
    where iio.id = inventory_item_outlet_suppliers.inventory_item_outlet_id
      and so.supplier_id = inventory_item_outlet_suppliers.supplier_id
      and public.current_user_can_access_outlet(iio.outlet_id)
  )
);

drop policy if exists "inventory outlet supplier managers can update links" on public.inventory_item_outlet_suppliers;
create policy "inventory outlet supplier managers can update links"
on public.inventory_item_outlet_suppliers for update to authenticated
using (
  (
    public.current_user_has_permission('inventory_par_levels.edit')
    or public.current_user_has_permission('inventory_master.edit')
    or public.current_user_has_permission('inventory_control.manage_master')
  )
  and exists (
    select 1
    from public.inventory_item_outlets iio
    where iio.id = inventory_item_outlet_suppliers.inventory_item_outlet_id
      and public.current_user_can_access_outlet(iio.outlet_id)
  )
)
with check (
  (
    public.current_user_has_permission('inventory_par_levels.edit')
    or public.current_user_has_permission('inventory_master.edit')
    or public.current_user_has_permission('inventory_control.manage_master')
  )
  and exists (
    select 1
    from public.inventory_item_outlets iio
    join public.supplier_outlets so on so.outlet_id = iio.outlet_id
    where iio.id = inventory_item_outlet_suppliers.inventory_item_outlet_id
      and so.supplier_id = inventory_item_outlet_suppliers.supplier_id
      and public.current_user_can_access_outlet(iio.outlet_id)
  )
);

drop policy if exists "inventory outlet supplier managers can delete links" on public.inventory_item_outlet_suppliers;
create policy "inventory outlet supplier managers can delete links"
on public.inventory_item_outlet_suppliers for delete to authenticated
using (
  (
    public.current_user_has_permission('inventory_par_levels.edit')
    or public.current_user_has_permission('inventory_master.edit')
    or public.current_user_has_permission('inventory_control.manage_master')
  )
  and exists (
    select 1
    from public.inventory_item_outlets iio
    where iio.id = inventory_item_outlet_suppliers.inventory_item_outlet_id
      and public.current_user_can_access_outlet(iio.outlet_id)
  )
);

drop policy if exists "inventory stock checks scoped access" on public.inventory_stock_checks;
create policy "inventory stock checks scoped access"
on public.inventory_stock_checks for all to authenticated
using (
  (
    public.current_user_has_permission('inventory_stock_check.view')
    or public.current_user_has_permission('inventory_stock_check.create')
    or public.current_user_has_permission('inventory_stock_check.edit')
    or public.current_user_has_permission('inventory_control.view')
  )
  and public.current_user_can_access_outlet(outlet_id)
)
with check (
  (
    public.current_user_has_permission('inventory_stock_check.create')
    or public.current_user_has_permission('inventory_stock_check.edit')
    or public.current_user_has_permission('inventory_control.create')
  )
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "inventory stock check items scoped access" on public.inventory_stock_check_items;
create policy "inventory stock check items scoped access"
on public.inventory_stock_check_items for all to authenticated
using (
  exists (
    select 1 from public.inventory_stock_checks sc
    where sc.id = inventory_stock_check_items.stock_check_id
      and public.current_user_can_access_outlet(sc.outlet_id)
  )
)
with check (
  exists (
    select 1 from public.inventory_stock_checks sc
    where sc.id = inventory_stock_check_items.stock_check_id
      and public.current_user_can_access_outlet(sc.outlet_id)
  )
);

drop policy if exists "inventory purchase orders scoped access" on public.inventory_purchase_orders;
create policy "inventory purchase orders scoped access"
on public.inventory_purchase_orders for all to authenticated
using (
  (
    public.current_user_has_permission('inventory_orders.view')
    or public.current_user_has_permission('inventory_orders.create')
    or public.current_user_has_permission('inventory_orders.edit')
    or public.current_user_has_permission('inventory_control.view')
  )
  and public.current_user_can_access_outlet(outlet_id)
)
with check (
  (
    public.current_user_has_permission('inventory_orders.create')
    or public.current_user_has_permission('inventory_orders.edit')
    or public.current_user_has_permission('inventory_control.manage')
  )
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "inventory purchase order items scoped access" on public.inventory_purchase_order_items;
create policy "inventory purchase order items scoped access"
on public.inventory_purchase_order_items for all to authenticated
using (
  exists (
    select 1 from public.inventory_purchase_orders po
    where po.id = inventory_purchase_order_items.purchase_order_id
      and public.current_user_can_access_outlet(po.outlet_id)
  )
)
with check (
  exists (
    select 1 from public.inventory_purchase_orders po
    where po.id = inventory_purchase_order_items.purchase_order_id
      and public.current_user_can_access_outlet(po.outlet_id)
  )
);

drop policy if exists "inventory purchase receipts scoped access" on public.inventory_purchase_receipts;
create policy "inventory purchase receipts scoped access"
on public.inventory_purchase_receipts for all to authenticated
using (
  (
    public.current_user_has_permission('inventory_orders.view')
    or public.current_user_has_permission('inventory_orders.edit')
    or public.current_user_has_permission('inventory_control.view')
  )
  and public.current_user_can_access_outlet(outlet_id)
)
with check (
  (
    public.current_user_has_permission('inventory_orders.edit')
    or public.current_user_has_permission('inventory_control.manage')
  )
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "inventory purchase receipt items scoped access" on public.inventory_purchase_receipt_items;
create policy "inventory purchase receipt items scoped access"
on public.inventory_purchase_receipt_items for all to authenticated
using (
  exists (
    select 1 from public.inventory_purchase_receipts receipt
    where receipt.id = inventory_purchase_receipt_items.receipt_id
      and public.current_user_can_access_outlet(receipt.outlet_id)
  )
)
with check (
  exists (
    select 1 from public.inventory_purchase_receipts receipt
    where receipt.id = inventory_purchase_receipt_items.receipt_id
      and public.current_user_can_access_outlet(receipt.outlet_id)
  )
);

insert into storage.buckets (id, name, public)
values ('inventory-item-photos', 'inventory-item-photos', true)
on conflict (id) do update
set public = excluded.public;

drop policy if exists "inventory viewers can view item photos" on storage.objects;
create policy "inventory viewers can view item photos"
on storage.objects for select to authenticated
using (
  bucket_id = 'inventory-item-photos'
  and (
    public.current_user_has_permission('inventory_master.view')
    or public.current_user_has_permission('inventory_control.view')
  )
);

drop policy if exists "inventory editors can upload item photos" on storage.objects;
create policy "inventory editors can upload item photos"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'inventory-item-photos'
  and (
    public.current_user_has_permission('inventory_master.create')
    or public.current_user_has_permission('inventory_master.edit')
    or public.current_user_has_permission('inventory_control.manage_master')
  )
);

drop policy if exists "inventory editors can update item photos" on storage.objects;
create policy "inventory editors can update item photos"
on storage.objects for update to authenticated
using (
  bucket_id = 'inventory-item-photos'
  and (
    public.current_user_has_permission('inventory_master.create')
    or public.current_user_has_permission('inventory_master.edit')
    or public.current_user_has_permission('inventory_control.manage_master')
  )
)
with check (
  bucket_id = 'inventory-item-photos'
  and (
    public.current_user_has_permission('inventory_master.create')
    or public.current_user_has_permission('inventory_master.edit')
    or public.current_user_has_permission('inventory_control.manage_master')
  )
);
