alter table public.asset_items
  add column if not exists asset_code text,
  add column if not exists location text,
  add column if not exists purchase_date date,
  add column if not exists warranty_expiry date,
  add column if not exists notes text;

create unique index if not exists asset_items_outlet_asset_code_uidx
on public.asset_items (outlet_id, lower(asset_code))
where asset_code is not null and btrim(asset_code) <> '';

create index if not exists asset_items_outlet_name_lookup_idx
on public.asset_items (outlet_id, lower(name));
