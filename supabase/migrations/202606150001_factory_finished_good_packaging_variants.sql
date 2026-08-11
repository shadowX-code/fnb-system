-- Factory Finished Good product group and packaging variant support.
-- Finished Good records remain the inventory SKU; product groups are stored in factory_product_families.

create table if not exists public.factory_product_families (
  id uuid primary key default gen_random_uuid(),
  name_en text not null,
  name_cn text,
  name_bm text,
  category_id uuid references public.factory_finished_good_categories(id) on delete set null,
  status text not null default 'active',
  remarks text,
  created_by uuid references public.employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.factory_finished_goods
  add column if not exists product_family_id uuid references public.factory_product_families(id) on delete set null,
  add column if not exists variant_name text,
  add column if not exists pack_size_qty numeric,
  add column if not exists pack_size_uom text,
  add column if not exists base_qty numeric,
  add column if not exists base_uom text;

create unique index if not exists factory_product_families_lower_name_en_key
on public.factory_product_families (lower(name_en));

create index if not exists factory_finished_goods_product_family_id_idx
on public.factory_finished_goods(product_family_id);

insert into public.permissions (code, module, description)
values
  ('factory_product_families.view', 'Factory Product Groups', 'View Factory product group master data.'),
  ('factory_product_families.create', 'Factory Product Groups', 'Create Factory product group master data.'),
  ('factory_product_families.edit', 'Factory Product Groups', 'Edit Factory product group master data.'),
  ('factory_product_families.delete', 'Factory Product Groups', 'Archive Factory product group master data.'),
  ('factory_product_families.manage', 'Factory Product Groups', 'Manage Factory product group master data.'),
  ('factory_product_families.export', 'Factory Product Groups', 'Export Factory product group master data.')
on conflict (code) do update
set module = excluded.module,
    description = excluded.description;

grant select, insert, update, delete on public.factory_product_families to authenticated;

alter table public.factory_product_families enable row level security;

drop policy if exists "factory product families view" on public.factory_product_families;
create policy "factory product families view" on public.factory_product_families for select to authenticated
using (
  public.current_user_has_permission('factory_dashboard.view')
  or public.current_user_has_permission('factory_finished_goods.view')
  or public.current_user_has_permission('factory_product_families.view')
  or public.current_user_has_permission('factory_product_families.manage')
);

drop policy if exists "factory product families insert" on public.factory_product_families;
create policy "factory product families insert" on public.factory_product_families for insert to authenticated
with check (
  public.current_user_has_permission('factory_product_families.create')
  or public.current_user_has_permission('factory_product_families.manage')
  or public.current_user_has_permission('factory_finished_goods.create')
);

drop policy if exists "factory product families update" on public.factory_product_families;
create policy "factory product families update" on public.factory_product_families for update to authenticated
using (
  public.current_user_has_permission('factory_product_families.edit')
  or public.current_user_has_permission('factory_product_families.delete')
  or public.current_user_has_permission('factory_product_families.manage')
  or public.current_user_has_permission('factory_finished_goods.edit')
)
with check (
  public.current_user_has_permission('factory_product_families.edit')
  or public.current_user_has_permission('factory_product_families.delete')
  or public.current_user_has_permission('factory_product_families.manage')
  or public.current_user_has_permission('factory_finished_goods.edit')
);

drop policy if exists "factory product families delete" on public.factory_product_families;
create policy "factory product families delete" on public.factory_product_families for delete to authenticated
using (
  public.current_user_has_permission('factory_product_families.delete')
  or public.current_user_has_permission('factory_product_families.manage')
);

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where lower(r.name) in ('owner', 'admin')
  and p.code like 'factory_%'
on conflict do nothing;
