-- Factory workspace foundation and Phase 1A persistence.
-- Phase 1A active UI: Factory Dashboard, Job Orders, Raw Material Receiving.

create extension if not exists pgcrypto;

create table if not exists public.factory_raw_materials (
  id uuid primary key default gen_random_uuid(),
  material_code text unique,
  name text not null,
  category text,
  uom text,
  current_balance numeric not null default 0,
  min_stock_level numeric not null default 0,
  storage_location text,
  status text not null default 'active',
  created_by uuid references public.employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists factory_raw_materials_name_key
on public.factory_raw_materials (lower(name));

create table if not exists public.factory_raw_material_receivings (
  id uuid primary key default gen_random_uuid(),
  receipt_no text unique not null,
  raw_material_id uuid not null references public.factory_raw_materials(id),
  supplier_name text,
  batch_no text,
  received_qty numeric not null,
  uom text,
  unit_cost numeric(12,4) not null default 0,
  total_cost numeric(14,4) not null default 0,
  invoice_no text,
  received_date date not null default current_date,
  expiry_date date,
  storage_location text,
  remarks text,
  received_by uuid references public.employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.factory_raw_material_movements (
  id uuid primary key default gen_random_uuid(),
  raw_material_id uuid not null references public.factory_raw_materials(id),
  movement_type text not null,
  quantity numeric not null,
  uom text,
  reference_type text,
  reference_id uuid,
  reference_no text,
  movement_date date not null default current_date,
  notes text,
  created_by uuid references public.employees(id),
  created_at timestamptz not null default now()
);

create table if not exists public.factory_job_orders (
  id uuid primary key default gen_random_uuid(),
  job_order_no text unique not null,
  product_name text not null,
  target_quantity numeric not null,
  produced_quantity numeric not null default 0,
  uom text,
  planned_date date,
  due_date date,
  priority text not null default 'Normal',
  status text not null default 'draft',
  assigned_team text,
  remarks text,
  created_by uuid references public.employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.factory_productions (
  id uuid primary key default gen_random_uuid(),
  job_order_id uuid references public.factory_job_orders(id) on delete set null,
  production_no text unique,
  product_name text not null,
  produced_quantity numeric not null default 0,
  uom text,
  production_date date not null default current_date,
  status text not null default 'draft',
  notes text,
  created_by uuid references public.employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.factory_production_material_usage (
  id uuid primary key default gen_random_uuid(),
  production_id uuid not null references public.factory_productions(id) on delete cascade,
  raw_material_id uuid not null references public.factory_raw_materials(id),
  quantity_used numeric not null,
  uom text,
  wastage_quantity numeric not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.factory_finished_goods (
  id uuid primary key default gen_random_uuid(),
  product_code text unique,
  product_name text not null,
  category text,
  uom text,
  current_balance numeric not null default 0,
  min_stock_level numeric not null default 0,
  status text not null default 'active',
  created_by uuid references public.employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.factory_product_stock_movements (
  id uuid primary key default gen_random_uuid(),
  finished_good_id uuid references public.factory_finished_goods(id),
  product_name text,
  movement_type text not null,
  quantity numeric not null,
  uom text,
  reference_type text,
  reference_id uuid,
  reference_no text,
  movement_date date not null default current_date,
  notes text,
  created_by uuid references public.employees(id),
  created_at timestamptz not null default now()
);

create table if not exists public.factory_product_stock_checks (
  id uuid primary key default gen_random_uuid(),
  check_no text unique,
  check_date date not null default current_date,
  status text not null default 'draft',
  notes text,
  created_by uuid references public.employees(id),
  submitted_by uuid references public.employees(id),
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.factory_raw_material_stock_checks (
  id uuid primary key default gen_random_uuid(),
  check_no text unique,
  check_date date not null default current_date,
  status text not null default 'draft',
  notes text,
  created_by uuid references public.employees(id),
  submitted_by uuid references public.employees(id),
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.factory_product_recipes (
  id uuid primary key default gen_random_uuid(),
  recipe_code text unique not null,
  product_name text not null,
  version text,
  yield_quantity numeric,
  uom text,
  status text not null default 'active',
  notes text,
  created_by uuid references public.employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.factory_product_recipe_items (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.factory_product_recipes(id) on delete cascade,
  raw_material_id uuid not null references public.factory_raw_materials(id),
  quantity_used numeric not null,
  uom text,
  wastage_percent numeric not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.factory_production_sops (
  id uuid primary key default gen_random_uuid(),
  sop_code text unique not null,
  title text not null,
  product_name text,
  status text not null default 'active',
  notes text,
  created_by uuid references public.employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.factory_production_sop_steps (
  id uuid primary key default gen_random_uuid(),
  sop_id uuid not null references public.factory_production_sops(id) on delete cascade,
  step_no integer not null,
  instruction text not null,
  expected_duration_minutes integer,
  safety_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.factory_adjust_raw_material_balance(material_id uuid, quantity_delta numeric)
returns void
language plpgsql
security invoker
as $$
begin
  update public.factory_raw_materials
  set current_balance = coalesce(current_balance, 0) + coalesce(quantity_delta, 0),
      updated_at = now()
  where id = material_id;
end;
$$;

grant execute on function public.factory_adjust_raw_material_balance(uuid, numeric) to authenticated;

insert into public.permissions (code, module, description)
values
  ('factory_dashboard.view', 'Factory Dashboard', 'View Factory Dashboard.'),
  ('factory_dashboard.export', 'Factory Dashboard', 'Export Factory Dashboard.'),
  ('factory_job_orders.view', 'Job Orders', 'View Factory Job Orders.'),
  ('factory_job_orders.create', 'Job Orders', 'Create Factory Job Orders.'),
  ('factory_job_orders.edit', 'Job Orders', 'Edit Factory Job Orders.'),
  ('factory_job_orders.delete', 'Job Orders', 'Delete Factory Job Orders.'),
  ('factory_job_orders.cancel', 'Job Orders', 'Cancel Factory Job Orders.'),
  ('factory_job_orders.complete', 'Job Orders', 'Complete Factory Job Orders.'),
  ('factory_job_orders.export', 'Job Orders', 'Export Factory Job Orders.'),
  ('factory_production.view', 'Production Records', 'View Factory Production Records.'),
  ('factory_production.create', 'Production Records', 'Create Factory Production Records.'),
  ('factory_production.edit', 'Production Records', 'Edit Factory Production Records.'),
  ('factory_production.complete', 'Production Records', 'Complete Factory Production Records.'),
  ('factory_production.export', 'Production Records', 'Export Factory Production Records.'),
  ('factory_production_reports.view', 'Production Reports', 'View Factory Production Reports.'),
  ('factory_production_reports.export', 'Production Reports', 'Export Factory Production Reports.'),
  ('factory_finished_goods.view', 'Finished Goods', 'View Finished Goods.'),
  ('factory_finished_goods.create', 'Finished Goods', 'Create Finished Goods.'),
  ('factory_finished_goods.edit', 'Finished Goods', 'Edit Finished Goods.'),
  ('factory_finished_goods.export', 'Finished Goods', 'Export Finished Goods.'),
  ('factory_product_movements.view', 'Product Movements', 'View Factory Product Movements.'),
  ('factory_product_movements.create', 'Product Movements', 'Create Factory Product Movements.'),
  ('factory_product_movements.edit', 'Product Movements', 'Edit Factory Product Movements.'),
  ('factory_product_movements.export', 'Product Movements', 'Export Factory Product Movements.'),
  ('factory_product_stock_check.view', 'Product Stock Check', 'View Factory Product Stock Check.'),
  ('factory_product_stock_check.create', 'Product Stock Check', 'Create Factory Product Stock Check.'),
  ('factory_product_stock_check.edit', 'Product Stock Check', 'Edit Factory Product Stock Check.'),
  ('factory_product_stock_check.submit', 'Product Stock Check', 'Submit Factory Product Stock Check.'),
  ('factory_product_stock_check.export', 'Product Stock Check', 'Export Factory Product Stock Check.'),
  ('factory_raw_receiving.view', 'Raw Material Receiving', 'View Factory Raw Material Receiving.'),
  ('factory_raw_receiving.create', 'Raw Material Receiving', 'Create Factory Raw Material Receiving.'),
  ('factory_raw_receiving.edit', 'Raw Material Receiving', 'Edit Factory Raw Material Receiving.'),
  ('factory_raw_receiving.delete', 'Raw Material Receiving', 'Delete Factory Raw Material Receiving.'),
  ('factory_raw_receiving.export', 'Raw Material Receiving', 'Export Factory Raw Material Receiving.'),
  ('factory_raw_inventory.view', 'Raw Material Inventory', 'View Factory Raw Material Inventory.'),
  ('factory_raw_inventory.create', 'Raw Material Inventory', 'Create Factory Raw Material Inventory.'),
  ('factory_raw_inventory.edit', 'Raw Material Inventory', 'Edit Factory Raw Material Inventory.'),
  ('factory_raw_inventory.export', 'Raw Material Inventory', 'Export Factory Raw Material Inventory.'),
  ('factory_raw_stock_check.view', 'Raw Material Stock Check', 'View Factory Raw Material Stock Check.'),
  ('factory_raw_stock_check.create', 'Raw Material Stock Check', 'Create Factory Raw Material Stock Check.'),
  ('factory_raw_stock_check.edit', 'Raw Material Stock Check', 'Edit Factory Raw Material Stock Check.'),
  ('factory_raw_stock_check.submit', 'Raw Material Stock Check', 'Submit Factory Raw Material Stock Check.'),
  ('factory_raw_stock_check.export', 'Raw Material Stock Check', 'Export Factory Raw Material Stock Check.'),
  ('factory_product_recipes.view', 'Product Recipes', 'View Factory Product Recipes.'),
  ('factory_product_recipes.create', 'Product Recipes', 'Create Factory Product Recipes.'),
  ('factory_product_recipes.edit', 'Product Recipes', 'Edit Factory Product Recipes.'),
  ('factory_product_recipes.delete', 'Product Recipes', 'Delete Factory Product Recipes.'),
  ('factory_product_recipes.manage', 'Product Recipes', 'Manage Factory Product Recipes.'),
  ('factory_product_recipes.export', 'Product Recipes', 'Export Factory Product Recipes.'),
  ('factory_production_sop.view', 'Production SOP', 'View Factory Production SOP.'),
  ('factory_production_sop.create', 'Production SOP', 'Create Factory Production SOP.'),
  ('factory_production_sop.edit', 'Production SOP', 'Edit Factory Production SOP.'),
  ('factory_production_sop.delete', 'Production SOP', 'Delete Factory Production SOP.'),
  ('factory_production_sop.manage', 'Production SOP', 'Manage Factory Production SOP.'),
  ('factory_production_sop.export', 'Production SOP', 'Export Factory Production SOP.'),
  ('factory_audit_logs.view', 'Factory Audit Logs', 'View Factory Audit Logs.'),
  ('factory_audit_logs.export', 'Factory Audit Logs', 'Export Factory Audit Logs.'),
  ('factory_settings.view', 'Factory Settings', 'View Factory Settings.'),
  ('factory_settings.edit', 'Factory Settings', 'Edit Factory Settings.'),
  ('factory_settings.manage', 'Factory Settings', 'Manage Factory Settings.')
on conflict (code) do update
set module = excluded.module,
    description = excluded.description;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.name in ('owner', 'admin')
  and p.code like 'factory_%'
on conflict do nothing;

grant select, insert, update, delete on
  public.factory_raw_materials,
  public.factory_raw_material_receivings,
  public.factory_raw_material_movements,
  public.factory_job_orders,
  public.factory_productions,
  public.factory_production_material_usage,
  public.factory_finished_goods,
  public.factory_product_stock_movements,
  public.factory_product_stock_checks,
  public.factory_raw_material_stock_checks,
  public.factory_product_recipes,
  public.factory_product_recipe_items,
  public.factory_production_sops,
  public.factory_production_sop_steps
to authenticated;

alter table public.factory_raw_materials enable row level security;
alter table public.factory_raw_material_receivings enable row level security;
alter table public.factory_raw_material_movements enable row level security;
alter table public.factory_job_orders enable row level security;
alter table public.factory_productions enable row level security;
alter table public.factory_production_material_usage enable row level security;
alter table public.factory_finished_goods enable row level security;
alter table public.factory_product_stock_movements enable row level security;
alter table public.factory_product_stock_checks enable row level security;
alter table public.factory_raw_material_stock_checks enable row level security;
alter table public.factory_product_recipes enable row level security;
alter table public.factory_product_recipe_items enable row level security;
alter table public.factory_production_sops enable row level security;
alter table public.factory_production_sop_steps enable row level security;

drop policy if exists "factory raw materials view" on public.factory_raw_materials;
create policy "factory raw materials view" on public.factory_raw_materials for select to authenticated
using (
  public.current_user_has_permission('factory_dashboard.view')
  or public.current_user_has_permission('factory_raw_inventory.view')
  or public.current_user_has_permission('factory_raw_receiving.view')
  or public.current_user_has_permission('factory_raw_stock_check.view')
  or public.current_user_has_permission('factory_product_recipes.view')
);
drop policy if exists "factory raw materials insert" on public.factory_raw_materials;
create policy "factory raw materials insert" on public.factory_raw_materials for insert to authenticated
with check (public.current_user_has_permission('factory_raw_inventory.create') or public.current_user_has_permission('factory_raw_receiving.create'));
drop policy if exists "factory raw materials update" on public.factory_raw_materials;
create policy "factory raw materials update" on public.factory_raw_materials for update to authenticated
using (public.current_user_has_permission('factory_raw_inventory.edit') or public.current_user_has_permission('factory_raw_receiving.create') or public.current_user_has_permission('factory_raw_receiving.edit'))
with check (public.current_user_has_permission('factory_raw_inventory.edit') or public.current_user_has_permission('factory_raw_receiving.create') or public.current_user_has_permission('factory_raw_receiving.edit'));

drop policy if exists "factory raw receiving view" on public.factory_raw_material_receivings;
create policy "factory raw receiving view" on public.factory_raw_material_receivings for select to authenticated
using (public.current_user_has_permission('factory_dashboard.view') or public.current_user_has_permission('factory_raw_receiving.view'));
drop policy if exists "factory raw receiving insert" on public.factory_raw_material_receivings;
create policy "factory raw receiving insert" on public.factory_raw_material_receivings for insert to authenticated
with check (public.current_user_has_permission('factory_raw_receiving.create'));
drop policy if exists "factory raw receiving update" on public.factory_raw_material_receivings;
create policy "factory raw receiving update" on public.factory_raw_material_receivings for update to authenticated
using (public.current_user_has_permission('factory_raw_receiving.edit'))
with check (public.current_user_has_permission('factory_raw_receiving.edit'));
drop policy if exists "factory raw receiving delete" on public.factory_raw_material_receivings;
create policy "factory raw receiving delete" on public.factory_raw_material_receivings for delete to authenticated
using (public.current_user_has_permission('factory_raw_receiving.delete'));

drop policy if exists "factory raw movements view" on public.factory_raw_material_movements;
create policy "factory raw movements view" on public.factory_raw_material_movements for select to authenticated
using (public.current_user_has_permission('factory_dashboard.view') or public.current_user_has_permission('factory_raw_inventory.view') or public.current_user_has_permission('factory_raw_receiving.view'));
drop policy if exists "factory raw movements insert" on public.factory_raw_material_movements;
create policy "factory raw movements insert" on public.factory_raw_material_movements for insert to authenticated
with check (public.current_user_has_permission('factory_raw_receiving.create') or public.current_user_has_permission('factory_raw_receiving.edit') or public.current_user_has_permission('factory_raw_inventory.edit'));

drop policy if exists "factory job orders view" on public.factory_job_orders;
create policy "factory job orders view" on public.factory_job_orders for select to authenticated
using (public.current_user_has_permission('factory_dashboard.view') or public.current_user_has_permission('factory_job_orders.view') or public.current_user_has_permission('factory_production.view'));
drop policy if exists "factory job orders insert" on public.factory_job_orders;
create policy "factory job orders insert" on public.factory_job_orders for insert to authenticated
with check (public.current_user_has_permission('factory_job_orders.create'));
drop policy if exists "factory job orders update" on public.factory_job_orders;
create policy "factory job orders update" on public.factory_job_orders for update to authenticated
using (public.current_user_has_permission('factory_job_orders.edit') or public.current_user_has_permission('factory_job_orders.complete') or public.current_user_has_permission('factory_job_orders.cancel'))
with check (public.current_user_has_permission('factory_job_orders.edit') or public.current_user_has_permission('factory_job_orders.complete') or public.current_user_has_permission('factory_job_orders.cancel'));
drop policy if exists "factory job orders delete" on public.factory_job_orders;
create policy "factory job orders delete" on public.factory_job_orders for delete to authenticated
using (public.current_user_has_permission('factory_job_orders.delete'));

drop policy if exists "factory production view" on public.factory_productions;
create policy "factory production view" on public.factory_productions for select to authenticated
using (public.current_user_has_permission('factory_dashboard.view') or public.current_user_has_permission('factory_production.view') or public.current_user_has_permission('factory_production_reports.view'));
drop policy if exists "factory production manage" on public.factory_productions;
create policy "factory production manage" on public.factory_productions for all to authenticated
using (public.current_user_has_permission('factory_production.edit') or public.current_user_has_permission('factory_production.create') or public.current_user_has_permission('factory_production.complete'))
with check (public.current_user_has_permission('factory_production.edit') or public.current_user_has_permission('factory_production.create') or public.current_user_has_permission('factory_production.complete'));

drop policy if exists "factory production usage view" on public.factory_production_material_usage;
create policy "factory production usage view" on public.factory_production_material_usage for select to authenticated
using (public.current_user_has_permission('factory_production.view') or public.current_user_has_permission('factory_production_reports.view'));
drop policy if exists "factory production usage manage" on public.factory_production_material_usage;
create policy "factory production usage manage" on public.factory_production_material_usage for all to authenticated
using (public.current_user_has_permission('factory_production.edit') or public.current_user_has_permission('factory_production.create'))
with check (public.current_user_has_permission('factory_production.edit') or public.current_user_has_permission('factory_production.create'));

drop policy if exists "factory finished goods view" on public.factory_finished_goods;
create policy "factory finished goods view" on public.factory_finished_goods for select to authenticated
using (public.current_user_has_permission('factory_dashboard.view') or public.current_user_has_permission('factory_finished_goods.view') or public.current_user_has_permission('factory_product_movements.view') or public.current_user_has_permission('factory_product_stock_check.view'));
drop policy if exists "factory finished goods manage" on public.factory_finished_goods;
create policy "factory finished goods manage" on public.factory_finished_goods for all to authenticated
using (public.current_user_has_permission('factory_finished_goods.create') or public.current_user_has_permission('factory_finished_goods.edit'))
with check (public.current_user_has_permission('factory_finished_goods.create') or public.current_user_has_permission('factory_finished_goods.edit'));

drop policy if exists "factory product movements view" on public.factory_product_stock_movements;
create policy "factory product movements view" on public.factory_product_stock_movements for select to authenticated
using (public.current_user_has_permission('factory_product_movements.view') or public.current_user_has_permission('factory_finished_goods.view') or public.current_user_has_permission('factory_dashboard.view'));
drop policy if exists "factory product movements manage" on public.factory_product_stock_movements;
create policy "factory product movements manage" on public.factory_product_stock_movements for all to authenticated
using (public.current_user_has_permission('factory_product_movements.create') or public.current_user_has_permission('factory_product_movements.edit'))
with check (public.current_user_has_permission('factory_product_movements.create') or public.current_user_has_permission('factory_product_movements.edit'));

drop policy if exists "factory product stock checks view" on public.factory_product_stock_checks;
create policy "factory product stock checks view" on public.factory_product_stock_checks for select to authenticated
using (public.current_user_has_permission('factory_product_stock_check.view'));
drop policy if exists "factory product stock checks manage" on public.factory_product_stock_checks;
create policy "factory product stock checks manage" on public.factory_product_stock_checks for all to authenticated
using (public.current_user_has_permission('factory_product_stock_check.create') or public.current_user_has_permission('factory_product_stock_check.edit') or public.current_user_has_permission('factory_product_stock_check.submit'))
with check (public.current_user_has_permission('factory_product_stock_check.create') or public.current_user_has_permission('factory_product_stock_check.edit') or public.current_user_has_permission('factory_product_stock_check.submit'));

drop policy if exists "factory raw stock checks view" on public.factory_raw_material_stock_checks;
create policy "factory raw stock checks view" on public.factory_raw_material_stock_checks for select to authenticated
using (public.current_user_has_permission('factory_raw_stock_check.view'));
drop policy if exists "factory raw stock checks manage" on public.factory_raw_material_stock_checks;
create policy "factory raw stock checks manage" on public.factory_raw_material_stock_checks for all to authenticated
using (public.current_user_has_permission('factory_raw_stock_check.create') or public.current_user_has_permission('factory_raw_stock_check.edit') or public.current_user_has_permission('factory_raw_stock_check.submit'))
with check (public.current_user_has_permission('factory_raw_stock_check.create') or public.current_user_has_permission('factory_raw_stock_check.edit') or public.current_user_has_permission('factory_raw_stock_check.submit'));

drop policy if exists "factory product recipes view" on public.factory_product_recipes;
create policy "factory product recipes view" on public.factory_product_recipes for select to authenticated
using (public.current_user_has_permission('factory_product_recipes.view') or public.current_user_has_permission('factory_production_sop.view'));
drop policy if exists "factory product recipes manage" on public.factory_product_recipes;
create policy "factory product recipes manage" on public.factory_product_recipes for all to authenticated
using (public.current_user_has_permission('factory_product_recipes.create') or public.current_user_has_permission('factory_product_recipes.edit') or public.current_user_has_permission('factory_product_recipes.delete') or public.current_user_has_permission('factory_product_recipes.manage'))
with check (public.current_user_has_permission('factory_product_recipes.create') or public.current_user_has_permission('factory_product_recipes.edit') or public.current_user_has_permission('factory_product_recipes.manage'));

drop policy if exists "factory product recipe items view" on public.factory_product_recipe_items;
create policy "factory product recipe items view" on public.factory_product_recipe_items for select to authenticated
using (public.current_user_has_permission('factory_product_recipes.view'));
drop policy if exists "factory product recipe items manage" on public.factory_product_recipe_items;
create policy "factory product recipe items manage" on public.factory_product_recipe_items for all to authenticated
using (public.current_user_has_permission('factory_product_recipes.create') or public.current_user_has_permission('factory_product_recipes.edit') or public.current_user_has_permission('factory_product_recipes.manage'))
with check (public.current_user_has_permission('factory_product_recipes.create') or public.current_user_has_permission('factory_product_recipes.edit') or public.current_user_has_permission('factory_product_recipes.manage'));

drop policy if exists "factory sops view" on public.factory_production_sops;
create policy "factory sops view" on public.factory_production_sops for select to authenticated
using (public.current_user_has_permission('factory_production_sop.view'));
drop policy if exists "factory sops manage" on public.factory_production_sops;
create policy "factory sops manage" on public.factory_production_sops for all to authenticated
using (public.current_user_has_permission('factory_production_sop.create') or public.current_user_has_permission('factory_production_sop.edit') or public.current_user_has_permission('factory_production_sop.delete') or public.current_user_has_permission('factory_production_sop.manage'))
with check (public.current_user_has_permission('factory_production_sop.create') or public.current_user_has_permission('factory_production_sop.edit') or public.current_user_has_permission('factory_production_sop.manage'));

drop policy if exists "factory sop steps view" on public.factory_production_sop_steps;
create policy "factory sop steps view" on public.factory_production_sop_steps for select to authenticated
using (public.current_user_has_permission('factory_production_sop.view'));
drop policy if exists "factory sop steps manage" on public.factory_production_sop_steps;
create policy "factory sop steps manage" on public.factory_production_sop_steps for all to authenticated
using (public.current_user_has_permission('factory_production_sop.create') or public.current_user_has_permission('factory_production_sop.edit') or public.current_user_has_permission('factory_production_sop.manage'))
with check (public.current_user_has_permission('factory_production_sop.create') or public.current_user_has_permission('factory_production_sop.edit') or public.current_user_has_permission('factory_production_sop.manage'));
