-- Asset categories decide whether assets need maintenance workflows.
-- Simple consumable/replacement categories remain inspection and quantity focused.

alter table public.asset_categories
  add column if not exists maintenance_enabled boolean not null default false;

update public.asset_categories
set maintenance_enabled = true
where lower(name) in ('kitchen equipment', 'electrical appliances', 'pos equipment')
   or lower(name) like '%electrical%'
   or lower(name) like '%machine%'
   or lower(name) like '%refrigerator%'
   or lower(name) like '%fridge%'
   or lower(name) like '%aircond%'
   or lower(name) like '%pos%';

create index if not exists asset_categories_maintenance_enabled_idx
on public.asset_categories (maintenance_enabled, is_active);
