alter table public.inventory_recipes
add column if not exists selling_price numeric(12,4) default 0;
