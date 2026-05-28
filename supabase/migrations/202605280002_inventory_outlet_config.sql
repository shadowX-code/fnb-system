-- Inventory Control outlet-specific stock configuration
-- Separates global inventory item identity from outlet par/threshold settings.

create extension if not exists pgcrypto;

insert into public.permissions (code, module, description)
values
  ('inventory_categories.view', 'Inventory Categories', 'View inventory categories.'),
  ('inventory_categories.create', 'Inventory Categories', 'Create inventory categories.'),
  ('inventory_categories.edit', 'Inventory Categories', 'Edit inventory categories.'),
  ('inventory_categories.delete', 'Inventory Categories', 'Delete inventory categories.'),
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
  add column if not exists low_stock_threshold numeric(14,3) not null default 0,
  add column if not exists reorder_qty numeric(14,3) not null default 0,
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

grant select, insert, update, delete on table public.inventory_categories to authenticated;
grant select, insert, update, delete on table public.inventory_items to authenticated;
grant select, insert, update, delete on table public.inventory_item_outlets to authenticated;
revoke all on table public.inventory_categories from anon;
revoke all on table public.inventory_items from anon;
revoke all on table public.inventory_item_outlets from anon;

alter table public.inventory_categories enable row level security;
alter table public.inventory_items enable row level security;
alter table public.inventory_item_outlets enable row level security;

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
    or public.current_user_has_permission('inventory_control.manage_master')
  )
  and public.current_user_can_access_outlet(outlet_id)
)
with check (
  (
    public.current_user_has_permission('inventory_master.edit')
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
