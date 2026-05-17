-- Supplier contact and operational notes used by Supplier Directory.
alter table public.suppliers
  add column if not exists phone text,
  add column if not exists remark text;
