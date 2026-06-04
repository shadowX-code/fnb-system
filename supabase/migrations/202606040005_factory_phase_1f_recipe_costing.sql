-- Factory Phase 1F: read-only recipe costing and raw material cost history access.

drop policy if exists "factory raw materials view" on public.factory_raw_materials;
create policy "factory raw materials view" on public.factory_raw_materials for select to authenticated
using (
  public.current_user_has_permission('factory_dashboard.view')
  or public.current_user_has_permission('factory_raw_inventory.view')
  or public.current_user_has_permission('factory_raw_receiving.view')
  or public.current_user_has_permission('factory_raw_stock_check.view')
  or public.current_user_has_permission('factory_product_recipes.view')
  or public.current_user_has_permission('factory_production_reports.view')
);

drop policy if exists "factory raw receiving view" on public.factory_raw_material_receivings;
create policy "factory raw receiving view" on public.factory_raw_material_receivings for select to authenticated
using (
  public.current_user_has_permission('factory_dashboard.view')
  or public.current_user_has_permission('factory_raw_receiving.view')
  or public.current_user_has_permission('factory_production_reports.view')
);

drop policy if exists "factory product recipes view" on public.factory_product_recipes;
create policy "factory product recipes view" on public.factory_product_recipes for select to authenticated
using (
  public.current_user_has_permission('factory_dashboard.view')
  or public.current_user_has_permission('factory_product_recipes.view')
  or public.current_user_has_permission('factory_production_sop.view')
  or public.current_user_has_permission('factory_production_reports.view')
);

drop policy if exists "factory product recipe items view" on public.factory_product_recipe_items;
create policy "factory product recipe items view" on public.factory_product_recipe_items for select to authenticated
using (
  public.current_user_has_permission('factory_dashboard.view')
  or public.current_user_has_permission('factory_product_recipes.view')
  or public.current_user_has_permission('factory_production_reports.view')
);
