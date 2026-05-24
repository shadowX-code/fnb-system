-- Asset Tracking module
-- Outlet-level asset quantities, movement logs and inspections.

create extension if not exists pgcrypto;

insert into public.permissions (code, module, description)
values
  ('asset_tracking.view', 'Asset Tracking', 'View Asset Tracking.'),
  ('asset_tracking.create', 'Asset Tracking', 'Create asset records and categories.'),
  ('asset_tracking.edit', 'Asset Tracking', 'Edit asset records and categories.'),
  ('asset_tracking.delete', 'Asset Tracking', 'Archive or delete asset records and categories.'),
  ('asset_tracking.manage', 'Asset Tracking', 'Adjust quantities and submit inspections.'),
  ('asset_tracking.export', 'Asset Tracking', 'Export Asset Tracking.')
on conflict (code) do update
set module = excluded.module,
    description = excluded.description;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.name in ('owner', 'admin')
  and p.code like 'asset_tracking.%'
on conflict do nothing;

create table if not exists public.asset_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.asset_items (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  category_id uuid not null references public.asset_categories(id),
  name text not null,
  description text,
  unit text not null default 'unit',
  current_quantity numeric not null default 0 check (current_quantity >= 0),
  minimum_quantity numeric not null default 0 check (minimum_quantity >= 0),
  status text not null default 'active' check (status in ('active', 'damaged', 'missing', 'disposed', 'inactive')),
  remark text,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.asset_movement_logs (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.asset_items(id) on delete cascade,
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  movement_type text not null check (movement_type in ('add', 'reduce', 'correction', 'transfer_in', 'transfer_out')),
  quantity_change numeric not null,
  quantity_before numeric not null check (quantity_before >= 0),
  quantity_after numeric not null check (quantity_after >= 0),
  reason text,
  remark text,
  movement_date date not null default current_date,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.asset_inspections (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  inspection_date date not null default current_date,
  checked_by text,
  category_scope jsonb not null default '{"type":"all","category_ids":[]}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'completed', 'partial')),
  remark text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.asset_inspection_items (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.asset_inspections(id) on delete cascade,
  asset_id uuid not null references public.asset_items(id) on delete cascade,
  expected_quantity numeric not null default 0,
  counted_quantity numeric not null default 0,
  difference numeric not null default 0,
  condition_status text not null default 'good' check (condition_status in ('good', 'damaged', 'missing', 'need_repair')),
  remark text,
  created_at timestamptz not null default now()
);

create index if not exists asset_items_outlet_idx on public.asset_items (outlet_id);
create index if not exists asset_items_category_idx on public.asset_items (category_id);
create index if not exists asset_movement_logs_asset_idx on public.asset_movement_logs (asset_id, movement_date desc);
create index if not exists asset_inspections_outlet_date_idx on public.asset_inspections (outlet_id, inspection_date desc);
create index if not exists asset_inspection_items_asset_idx on public.asset_inspection_items (asset_id);

insert into public.asset_categories (name, description, sort_order, is_active)
values
  ('Kitchen Equipment', 'Kitchen equipment and production tools.', 1, true),
  ('Dining Furniture', 'Tables, chairs and dining area furniture.', 2, true),
  ('Electrical Appliances', 'Electrical appliances used by outlets.', 3, true),
  ('POS Equipment', 'POS terminals, printers and payment devices.', 4, true),
  ('Utensils', 'Reusable utensils and serving tools.', 5, true),
  ('Signage', 'Outlet signs and display materials.', 6, true),
  ('Cleaning Equipment', 'Cleaning tools and equipment.', 7, true),
  ('Decoration', 'Decorative outlet assets.', 8, true),
  ('Other', 'Other outlet assets.', 99, true)
on conflict (name) do update
set description = excluded.description,
    sort_order = excluded.sort_order,
    is_active = excluded.is_active,
    updated_at = now();

grant select, insert, update, delete on table public.asset_categories to authenticated;
grant select, insert, update, delete on table public.asset_items to authenticated;
grant select, insert, update, delete on table public.asset_movement_logs to authenticated;
grant select, insert, update, delete on table public.asset_inspections to authenticated;
grant select, insert, update, delete on table public.asset_inspection_items to authenticated;

revoke all on table public.asset_categories from anon;
revoke all on table public.asset_items from anon;
revoke all on table public.asset_movement_logs from anon;
revoke all on table public.asset_inspections from anon;
revoke all on table public.asset_inspection_items from anon;

alter table public.asset_categories enable row level security;
alter table public.asset_items enable row level security;
alter table public.asset_movement_logs enable row level security;
alter table public.asset_inspections enable row level security;
alter table public.asset_inspection_items enable row level security;

drop policy if exists "asset tracking viewers can view categories" on public.asset_categories;
create policy "asset tracking viewers can view categories"
on public.asset_categories for select to authenticated
using (public.current_user_has_permission('asset_tracking.view'));

drop policy if exists "asset tracking creators can create categories" on public.asset_categories;
create policy "asset tracking creators can create categories"
on public.asset_categories for insert to authenticated
with check (public.current_user_has_permission('asset_tracking.create'));

drop policy if exists "asset tracking editors can update categories" on public.asset_categories;
create policy "asset tracking editors can update categories"
on public.asset_categories for update to authenticated
using (public.current_user_has_permission('asset_tracking.edit') or public.current_user_has_permission('asset_tracking.delete'))
with check (public.current_user_has_permission('asset_tracking.edit') or public.current_user_has_permission('asset_tracking.delete'));

drop policy if exists "asset tracking deleters can delete categories" on public.asset_categories;
create policy "asset tracking deleters can delete categories"
on public.asset_categories for delete to authenticated
using (public.current_user_has_permission('asset_tracking.delete'));

drop policy if exists "asset tracking viewers can view assets" on public.asset_items;
create policy "asset tracking viewers can view assets"
on public.asset_items for select to authenticated
using (public.current_user_has_permission('asset_tracking.view'));

drop policy if exists "asset tracking creators can create assets" on public.asset_items;
create policy "asset tracking creators can create assets"
on public.asset_items for insert to authenticated
with check (public.current_user_has_permission('asset_tracking.create'));

drop policy if exists "asset tracking editors can update assets" on public.asset_items;
create policy "asset tracking editors can update assets"
on public.asset_items for update to authenticated
using (
  public.current_user_has_permission('asset_tracking.edit')
  or public.current_user_has_permission('asset_tracking.manage')
  or public.current_user_has_permission('asset_tracking.delete')
)
with check (
  public.current_user_has_permission('asset_tracking.edit')
  or public.current_user_has_permission('asset_tracking.manage')
  or public.current_user_has_permission('asset_tracking.delete')
);

drop policy if exists "asset tracking deleters can delete assets" on public.asset_items;
create policy "asset tracking deleters can delete assets"
on public.asset_items for delete to authenticated
using (public.current_user_has_permission('asset_tracking.delete'));

drop policy if exists "asset tracking viewers can view movement logs" on public.asset_movement_logs;
create policy "asset tracking viewers can view movement logs"
on public.asset_movement_logs for select to authenticated
using (public.current_user_has_permission('asset_tracking.view'));

drop policy if exists "asset tracking managers can create movement logs" on public.asset_movement_logs;
create policy "asset tracking managers can create movement logs"
on public.asset_movement_logs for insert to authenticated
with check (public.current_user_has_permission('asset_tracking.manage'));

drop policy if exists "asset tracking viewers can view inspections" on public.asset_inspections;
create policy "asset tracking viewers can view inspections"
on public.asset_inspections for select to authenticated
using (public.current_user_has_permission('asset_tracking.view'));

drop policy if exists "asset tracking managers can create inspections" on public.asset_inspections;
create policy "asset tracking managers can create inspections"
on public.asset_inspections for insert to authenticated
with check (public.current_user_has_permission('asset_tracking.manage'));

drop policy if exists "asset tracking managers can update inspections" on public.asset_inspections;
create policy "asset tracking managers can update inspections"
on public.asset_inspections for update to authenticated
using (public.current_user_has_permission('asset_tracking.manage'))
with check (public.current_user_has_permission('asset_tracking.manage'));

drop policy if exists "asset tracking viewers can view inspection items" on public.asset_inspection_items;
create policy "asset tracking viewers can view inspection items"
on public.asset_inspection_items for select to authenticated
using (public.current_user_has_permission('asset_tracking.view'));

drop policy if exists "asset tracking managers can create inspection items" on public.asset_inspection_items;
create policy "asset tracking managers can create inspection items"
on public.asset_inspection_items for insert to authenticated
with check (public.current_user_has_permission('asset_tracking.manage'));

do $$
begin
  if to_regclass('public.outlets') is not null then
    execute 'drop policy if exists "outlet viewers can view outlets" on public.outlets';
    execute '
      create policy "outlet viewers can view outlets"
      on public.outlets for select to authenticated
      using (
        public.current_user_has_permission(''outlets.view'')
        or public.current_user_has_permission(''dashboard.view'')
        or public.current_user_has_permission(''sales_input.view'')
        or public.current_user_has_permission(''purchase_input.view'')
        or public.current_user_has_permission(''data_import.view'')
        or public.current_user_has_permission(''outlet_pnl.view'')
        or public.current_user_has_permission(''operating_expenses.view'')
        or public.current_user_has_permission(''duty_roster.view'')
        or public.current_user_has_permission(''outlet_duty_roster.view'')
        or public.current_user_has_permission(''asset_tracking.view'')
      )';
  end if;
end $$;
