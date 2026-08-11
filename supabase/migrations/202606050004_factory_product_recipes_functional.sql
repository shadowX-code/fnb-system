-- Factory Product Recipes functional BOM management.
-- Extends existing recipe tables; no duplicate recipe tables are created.

alter table public.factory_product_recipes
  add column if not exists finished_good_id uuid references public.factory_finished_goods(id) on delete restrict,
  add column if not exists recipe_name text,
  add column if not exists remarks text;

alter table public.factory_product_recipe_items
  add column if not exists sort_order integer not null default 1,
  add column if not exists remarks text;

update public.factory_product_recipes recipe
set finished_good_id = product.id,
    product_name = product.product_name,
    uom = coalesce(nullif(recipe.uom, ''), product.uom),
    recipe_name = coalesce(nullif(recipe.recipe_name, ''), recipe.recipe_code, product.product_name),
    remarks = coalesce(recipe.remarks, recipe.notes),
    updated_at = now()
from public.factory_finished_goods product
where recipe.finished_good_id is null
  and lower(recipe.product_name) = lower(product.product_name);

update public.factory_product_recipes
set recipe_name = coalesce(nullif(recipe_name, ''), recipe_code, product_name),
    remarks = coalesce(remarks, notes),
    status = case
      when lower(coalesce(status, '')) = 'inactive' then 'archived'
      when lower(coalesce(status, '')) in ('draft', 'active', 'archived') then lower(status)
      else 'draft'
    end,
    updated_at = now();

update public.factory_product_recipe_items
set remarks = coalesce(remarks, notes),
    sort_order = coalesce(nullif(sort_order, 0), 1),
    updated_at = now();

alter table public.factory_product_recipes
  alter column status set default 'draft';

create index if not exists factory_product_recipes_finished_good_id_idx
on public.factory_product_recipes(finished_good_id);

create index if not exists factory_product_recipe_items_recipe_sort_idx
on public.factory_product_recipe_items(recipe_id, sort_order);

with ranked_active as (
  select
    id,
    row_number() over (
      partition by finished_good_id
      order by updated_at desc nulls last, created_at desc nulls last, id
    ) as rn
  from public.factory_product_recipes
  where finished_good_id is not null
    and lower(status) = 'active'
)
update public.factory_product_recipes recipe
set status = 'archived',
    remarks = concat_ws(E'\n', nullif(recipe.remarks, ''), 'Auto-archived by migration because another active recipe version exists for the same Finished Good.'),
    updated_at = now()
from ranked_active ranked
where recipe.id = ranked.id
  and ranked.rn > 1;

create unique index if not exists factory_product_recipes_one_active_per_finished_good
on public.factory_product_recipes(finished_good_id)
where lower(status) = 'active' and finished_good_id is not null;

drop policy if exists "factory raw materials view" on public.factory_raw_materials;
create policy "factory raw materials view" on public.factory_raw_materials for select to authenticated
using (
  public.current_user_has_permission('factory_dashboard.view')
  or public.current_user_has_permission('factory_raw_inventory.view')
  or public.current_user_has_permission('factory_raw_receiving.view')
  or public.current_user_has_permission('factory_raw_stock_check.view')
  or public.current_user_has_permission('factory_product_recipes.view')
  or public.current_user_has_permission('factory_production.complete')
  or public.current_user_has_permission('factory_production_reports.view')
);

drop policy if exists "factory finished goods view" on public.factory_finished_goods;
create policy "factory finished goods view" on public.factory_finished_goods for select to authenticated
using (
  public.current_user_has_permission('factory_dashboard.view')
  or public.current_user_has_permission('factory_finished_goods.view')
  or public.current_user_has_permission('factory_finished_goods.create')
  or public.current_user_has_permission('factory_finished_goods.edit')
  or public.current_user_has_permission('factory_product_movements.view')
  or public.current_user_has_permission('factory_product_stock_check.view')
  or public.current_user_has_permission('factory_job_orders.view')
  or public.current_user_has_permission('factory_job_orders.create')
  or public.current_user_has_permission('factory_job_orders.edit')
  or public.current_user_has_permission('factory_product_recipes.view')
  or public.current_user_has_permission('factory_product_recipes.create')
  or public.current_user_has_permission('factory_product_recipes.edit')
  or public.current_user_has_permission('factory_production.view')
  or public.current_user_has_permission('factory_production.complete')
);

drop policy if exists "factory product recipes view" on public.factory_product_recipes;
create policy "factory product recipes view" on public.factory_product_recipes for select to authenticated
using (
  public.current_user_has_permission('factory_dashboard.view')
  or public.current_user_has_permission('factory_product_recipes.view')
  or public.current_user_has_permission('factory_production.complete')
  or public.current_user_has_permission('factory_production_reports.view')
);

drop policy if exists "factory product recipes manage" on public.factory_product_recipes;
create policy "factory product recipes manage" on public.factory_product_recipes for all to authenticated
using (
  public.current_user_has_permission('factory_product_recipes.create')
  or public.current_user_has_permission('factory_product_recipes.edit')
  or public.current_user_has_permission('factory_product_recipes.delete')
  or public.current_user_has_permission('factory_product_recipes.manage')
)
with check (
  public.current_user_has_permission('factory_product_recipes.create')
  or public.current_user_has_permission('factory_product_recipes.edit')
  or public.current_user_has_permission('factory_product_recipes.manage')
);

drop policy if exists "factory product recipe items view" on public.factory_product_recipe_items;
create policy "factory product recipe items view" on public.factory_product_recipe_items for select to authenticated
using (
  public.current_user_has_permission('factory_dashboard.view')
  or public.current_user_has_permission('factory_product_recipes.view')
  or public.current_user_has_permission('factory_production.complete')
  or public.current_user_has_permission('factory_production_reports.view')
);

drop policy if exists "factory product recipe items manage" on public.factory_product_recipe_items;
create policy "factory product recipe items manage" on public.factory_product_recipe_items for all to authenticated
using (
  public.current_user_has_permission('factory_product_recipes.create')
  or public.current_user_has_permission('factory_product_recipes.edit')
  or public.current_user_has_permission('factory_product_recipes.manage')
)
with check (
  public.current_user_has_permission('factory_product_recipes.create')
  or public.current_user_has_permission('factory_product_recipes.edit')
  or public.current_user_has_permission('factory_product_recipes.manage')
);
