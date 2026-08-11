-- Factory Raw Material Master and Inventory.
-- Extends existing raw material tables; receiving, production usage and stock checks continue to use the same balance and movement foundation.

create table if not exists public.factory_raw_material_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  status text not null default 'active',
  created_by uuid references public.employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists factory_raw_material_categories_name_key
on public.factory_raw_material_categories (lower(name));

alter table public.factory_raw_materials
  add column if not exists name_en text,
  add column if not exists name_cn text,
  add column if not exists name_bm text,
  add column if not exists category_id uuid references public.factory_raw_material_categories(id) on delete set null,
  add column if not exists preferred_supplier text,
  add column if not exists remarks text;

update public.factory_raw_materials
set name_en = coalesce(nullif(name_en, ''), name),
    status = case
      when lower(coalesce(status, '')) = 'inactive' then 'archived'
      when lower(coalesce(status, '')) in ('active', 'archived') then lower(status)
      else 'active'
    end,
    updated_at = now();

insert into public.factory_raw_material_categories (name, status, created_at, updated_at)
select distinct trim(category), 'active', now(), now()
from public.factory_raw_materials
where nullif(trim(coalesce(category, '')), '') is not null
on conflict ((lower(name))) do nothing;

update public.factory_raw_materials material
set category_id = category.id,
    updated_at = now()
from public.factory_raw_material_categories category
where material.category_id is null
  and lower(trim(material.category)) = lower(category.name);

create index if not exists factory_raw_materials_category_id_idx
on public.factory_raw_materials(category_id);

create index if not exists factory_raw_materials_status_idx
on public.factory_raw_materials(status);

create unique index if not exists factory_raw_materials_name_en_key
on public.factory_raw_materials (lower(name_en))
where name_en is not null;

alter table public.factory_raw_material_categories enable row level security;

grant select, insert, update, delete on public.factory_raw_material_categories to authenticated;

drop policy if exists "factory raw material categories view" on public.factory_raw_material_categories;
create policy "factory raw material categories view" on public.factory_raw_material_categories for select to authenticated
using (
  public.current_user_has_permission('factory_dashboard.view')
  or public.current_user_has_permission('factory_raw_inventory.view')
  or public.current_user_has_permission('factory_raw_receiving.view')
  or public.current_user_has_permission('factory_raw_stock_check.view')
  or public.current_user_has_permission('factory_product_recipes.view')
  or public.current_user_has_permission('factory_production.complete')
  or public.current_user_has_permission('factory_production_reports.view')
);

drop policy if exists "factory raw material categories manage" on public.factory_raw_material_categories;
create policy "factory raw material categories manage" on public.factory_raw_material_categories for all to authenticated
using (
  public.current_user_has_permission('factory_raw_inventory.create')
  or public.current_user_has_permission('factory_raw_inventory.edit')
)
with check (
  public.current_user_has_permission('factory_raw_inventory.create')
  or public.current_user_has_permission('factory_raw_inventory.edit')
);

drop policy if exists "factory raw materials view" on public.factory_raw_materials;
create policy "factory raw materials view" on public.factory_raw_materials for select to authenticated
using (
  public.current_user_has_permission('factory_dashboard.view')
  or public.current_user_has_permission('factory_raw_inventory.view')
  or public.current_user_has_permission('factory_raw_receiving.view')
  or public.current_user_has_permission('factory_raw_stock_check.view')
  or public.current_user_has_permission('factory_product_recipes.view')
  or public.current_user_has_permission('factory_production.complete')
  or public.current_user_has_permission('factory_production_reports.view')
);

drop policy if exists "factory raw materials insert" on public.factory_raw_materials;
create policy "factory raw materials insert" on public.factory_raw_materials for insert to authenticated
with check (public.current_user_has_permission('factory_raw_inventory.create'));

drop policy if exists "factory raw materials update" on public.factory_raw_materials;
create policy "factory raw materials update" on public.factory_raw_materials for update to authenticated
using (
  public.current_user_has_permission('factory_raw_inventory.edit')
  or public.current_user_has_permission('factory_raw_receiving.create')
  or public.current_user_has_permission('factory_raw_receiving.edit')
  or public.current_user_has_permission('factory_production.complete')
  or public.current_user_has_permission('factory_raw_stock_check.approve')
)
with check (
  public.current_user_has_permission('factory_raw_inventory.edit')
  or public.current_user_has_permission('factory_raw_receiving.create')
  or public.current_user_has_permission('factory_raw_receiving.edit')
  or public.current_user_has_permission('factory_production.complete')
  or public.current_user_has_permission('factory_raw_stock_check.approve')
);

drop policy if exists "factory raw receiving view" on public.factory_raw_material_receivings;
create policy "factory raw receiving view" on public.factory_raw_material_receivings for select to authenticated
using (
  public.current_user_has_permission('factory_dashboard.view')
  or public.current_user_has_permission('factory_raw_inventory.view')
  or public.current_user_has_permission('factory_raw_receiving.view')
  or public.current_user_has_permission('factory_production_reports.view')
);

drop policy if exists "factory raw movements view" on public.factory_raw_material_movements;
create policy "factory raw movements view" on public.factory_raw_material_movements for select to authenticated
using (
  public.current_user_has_permission('factory_dashboard.view')
  or public.current_user_has_permission('factory_raw_inventory.view')
  or public.current_user_has_permission('factory_raw_receiving.view')
  or public.current_user_has_permission('factory_production.view')
  or public.current_user_has_permission('factory_production_reports.view')
);

drop policy if exists "factory raw movements insert" on public.factory_raw_material_movements;
create policy "factory raw movements insert" on public.factory_raw_material_movements for insert to authenticated
with check (
  public.current_user_has_permission('factory_raw_receiving.create')
  or public.current_user_has_permission('factory_raw_receiving.edit')
  or public.current_user_has_permission('factory_raw_inventory.edit')
  or public.current_user_has_permission('factory_production.complete')
  or public.current_user_has_permission('factory_raw_stock_check.approve')
);

drop policy if exists "factory raw stock checks view" on public.factory_raw_material_stock_checks;
create policy "factory raw stock checks view" on public.factory_raw_material_stock_checks for select to authenticated
using (
  public.current_user_has_permission('factory_dashboard.view')
  or public.current_user_has_permission('factory_raw_inventory.view')
  or public.current_user_has_permission('factory_raw_stock_check.view')
);

drop policy if exists "factory raw stock check items view" on public.factory_raw_material_stock_check_items;
create policy "factory raw stock check items view" on public.factory_raw_material_stock_check_items for select to authenticated
using (
  public.current_user_has_permission('factory_dashboard.view')
  or public.current_user_has_permission('factory_raw_inventory.view')
  or public.current_user_has_permission('factory_raw_stock_check.view')
);

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where lower(r.name) in ('owner', 'admin')
  and p.code like 'factory_%'
on conflict do nothing;
