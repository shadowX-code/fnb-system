-- Factory Storage Locations master.
-- Adds managed storage locations for Factory raw materials and finished goods while preserving existing text location values.

create table if not exists public.factory_storage_locations (
  id uuid primary key default gen_random_uuid(),
  location_name text not null,
  location_code text,
  location_type text,
  status text not null default 'active',
  remarks text,
  created_by uuid references public.employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists factory_storage_locations_lower_name_key
on public.factory_storage_locations (lower(location_name));

create unique index if not exists factory_storage_locations_lower_code_key
on public.factory_storage_locations (lower(location_code))
where location_code is not null and location_code <> '';

alter table public.factory_raw_materials
  add column if not exists storage_location_id uuid references public.factory_storage_locations(id) on delete set null;

alter table public.factory_finished_goods
  add column if not exists storage_location_id uuid references public.factory_storage_locations(id) on delete set null,
  add column if not exists storage_location text;

insert into public.permissions (code, module, description)
values
  ('factory_storage_locations.view', 'Factory Storage Locations', 'View Factory storage location master data.'),
  ('factory_storage_locations.create', 'Factory Storage Locations', 'Create Factory storage location master data.'),
  ('factory_storage_locations.edit', 'Factory Storage Locations', 'Edit Factory storage location master data.'),
  ('factory_storage_locations.delete', 'Factory Storage Locations', 'Archive Factory storage location master data.'),
  ('factory_storage_locations.manage', 'Factory Storage Locations', 'Manage Factory storage location master data.')
on conflict (code) do update
set module = excluded.module,
    description = excluded.description;

grant select, insert, update, delete on public.factory_storage_locations to authenticated;

alter table public.factory_storage_locations enable row level security;

drop policy if exists "factory storage locations view" on public.factory_storage_locations;
create policy "factory storage locations view" on public.factory_storage_locations for select to authenticated
using (
  public.current_user_has_permission('factory_dashboard.view')
  or public.current_user_has_permission('factory_raw_inventory.view')
  or public.current_user_has_permission('factory_raw_receiving.view')
  or public.current_user_has_permission('factory_finished_goods.view')
  or public.current_user_has_permission('factory_storage_locations.view')
  or public.current_user_has_permission('factory_storage_locations.manage')
  or public.current_user_has_permission('factory_settings.manage')
);

drop policy if exists "factory storage locations manage" on public.factory_storage_locations;
create policy "factory storage locations manage" on public.factory_storage_locations for all to authenticated
using (
  public.current_user_has_permission('factory_storage_locations.create')
  or public.current_user_has_permission('factory_storage_locations.edit')
  or public.current_user_has_permission('factory_storage_locations.delete')
  or public.current_user_has_permission('factory_storage_locations.manage')
  or public.current_user_has_permission('factory_settings.manage')
)
with check (
  public.current_user_has_permission('factory_storage_locations.create')
  or public.current_user_has_permission('factory_storage_locations.edit')
  or public.current_user_has_permission('factory_storage_locations.delete')
  or public.current_user_has_permission('factory_storage_locations.manage')
  or public.current_user_has_permission('factory_settings.manage')
);

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where lower(r.name) in ('owner', 'admin')
  and p.code like 'factory_%'
on conflict do nothing;
