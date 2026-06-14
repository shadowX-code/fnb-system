-- Factory Product Recipe Production Standard/BOM UX support.
-- Adds optional estimated production time for production standard records.

alter table public.factory_product_recipes
  add column if not exists estimated_production_time_minutes numeric;
