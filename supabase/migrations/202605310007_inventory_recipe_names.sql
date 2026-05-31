alter table public.inventory_recipes
add column if not exists recipe_code text,
add column if not exists recipe_name_en text,
add column if not exists recipe_name_cn text;

update public.inventory_recipes
set recipe_name_en = nullif(btrim(recipe_name), '')
where (recipe_name_en is null or btrim(recipe_name_en) = '')
  and recipe_name is not null
  and btrim(recipe_name) <> '';

update public.inventory_recipes
set recipe_code = 'LEGACY-' || left(regexp_replace(id::text, '-', '', 'g'), 12)
where recipe_code is null or btrim(recipe_code) = '';

alter table public.inventory_recipes
alter column recipe_code set not null;

with duplicate_codes as (
  select
    id,
    recipe_code,
    row_number() over (partition by lower(recipe_code) order by created_at nulls last, id) as duplicate_index
  from public.inventory_recipes
)
update public.inventory_recipes recipe
set recipe_code = duplicate_codes.recipe_code || '-' || duplicate_codes.duplicate_index
from duplicate_codes
where recipe.id = duplicate_codes.id
  and duplicate_codes.duplicate_index > 1;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'inventory_recipes_recipe_code_not_blank'
      and conrelid = 'public.inventory_recipes'::regclass
  ) then
    alter table public.inventory_recipes
    add constraint inventory_recipes_recipe_code_not_blank
    check (btrim(recipe_code) <> '');
  end if;
end $$;

create unique index if not exists inventory_recipes_recipe_code_unique
on public.inventory_recipes (lower(recipe_code));

create index if not exists inventory_recipes_recipe_name_en_idx
on public.inventory_recipes (lower(recipe_name_en));

create index if not exists inventory_recipes_recipe_name_cn_idx
on public.inventory_recipes (lower(recipe_name_cn));
