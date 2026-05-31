alter table public.product_recipe_mappings
  alter column recipe_id drop not null;

alter table public.product_recipe_mappings
  add column if not exists status text not null default 'mapped',
  add column if not exists ignored_reason text,
  add column if not exists ignored_at timestamptz,
  add column if not exists ignored_by uuid references public.employees(id);

alter table public.product_recipe_mappings
  drop constraint if exists product_recipe_mappings_status_check;

alter table public.product_recipe_mappings
  add constraint product_recipe_mappings_status_check
  check (status in ('mapped', 'ignored'));

alter table public.product_recipe_mappings
  drop constraint if exists product_recipe_mappings_status_recipe_check;

alter table public.product_recipe_mappings
  add constraint product_recipe_mappings_status_recipe_check
  check (
    (status = 'mapped' and recipe_id is not null)
    or
    (status = 'ignored' and recipe_id is null)
  );

update public.product_recipe_mappings
set status = 'mapped'
where status is null;
