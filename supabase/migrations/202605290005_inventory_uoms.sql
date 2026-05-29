-- Inventory UOM management

create table if not exists public.inventory_uoms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  display_name text not null,
  uom_type text not null default 'General',
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.permissions (code, module, description)
values
  ('inventory_uoms.view', 'Inventory UOMs', 'View inventory units of measure.'),
  ('inventory_uoms.create', 'Inventory UOMs', 'Create inventory units of measure.'),
  ('inventory_uoms.edit', 'Inventory UOMs', 'Edit inventory units of measure.'),
  ('inventory_uoms.delete', 'Inventory UOMs', 'Delete inventory units of measure.')
on conflict (code) do update
set module = excluded.module,
    description = excluded.description;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where lower(r.name) in ('owner', 'admin')
  and p.code in ('inventory_uoms.view', 'inventory_uoms.create', 'inventory_uoms.edit', 'inventory_uoms.delete')
on conflict do nothing;

insert into public.inventory_uoms (code, display_name, uom_type, sort_order)
values
  ('kg', 'Kilogram', 'Weight', 1),
  ('g', 'Gram', 'Weight', 2),
  ('pcs', 'Pieces', 'Count', 3),
  ('box', 'Box', 'Packaging', 4),
  ('pack', 'Pack', 'Packaging', 5),
  ('bottle', 'Bottle', 'Volume', 6),
  ('carton', 'Carton', 'Packaging', 7),
  ('litre', 'Litre', 'Volume', 8)
on conflict (code) do update
set display_name = excluded.display_name,
    uom_type = excluded.uom_type,
    sort_order = excluded.sort_order,
    updated_at = now();

alter table public.inventory_uoms enable row level security;

grant select, insert, update, delete on table public.inventory_uoms to authenticated;
revoke all on table public.inventory_uoms from anon;

drop policy if exists "inventory uom viewers can view uoms" on public.inventory_uoms;
create policy "inventory uom viewers can view uoms"
on public.inventory_uoms for select to authenticated
using (
  public.current_user_has_permission('inventory_uoms.view')
  or public.current_user_has_permission('inventory_master.view')
);

drop policy if exists "inventory uom creators can create uoms" on public.inventory_uoms;
create policy "inventory uom creators can create uoms"
on public.inventory_uoms for insert to authenticated
with check (public.current_user_has_permission('inventory_uoms.create'));

drop policy if exists "inventory uom editors can update uoms" on public.inventory_uoms;
create policy "inventory uom editors can update uoms"
on public.inventory_uoms for update to authenticated
using (public.current_user_has_permission('inventory_uoms.edit'))
with check (public.current_user_has_permission('inventory_uoms.edit'));

drop policy if exists "inventory uom deleters can delete uoms" on public.inventory_uoms;
create policy "inventory uom deleters can delete uoms"
on public.inventory_uoms for delete to authenticated
using (public.current_user_has_permission('inventory_uoms.delete'));
