-- Factory Production Planning page.
-- Adds permissions and read access for the Warehouse production planning board.

insert into public.permissions (code, module, description)
values
  ('factory_production_planning.view', 'Factory Production Planning', 'View Factory Production Planning board.'),
  ('factory_production_planning.export', 'Factory Production Planning', 'Export Factory Production Planning board.')
on conflict (code) do update
set module = excluded.module,
    description = excluded.description;

drop policy if exists "factory finished goods view" on public.factory_finished_goods;
create policy "factory finished goods view" on public.factory_finished_goods for select to authenticated
using (
  public.current_user_has_permission('factory_dashboard.view')
  or public.current_user_has_permission('factory_finished_goods.view')
  or public.current_user_has_permission('factory_finished_goods.create')
  or public.current_user_has_permission('factory_finished_goods.edit')
  or public.current_user_has_permission('factory_production_planning.view')
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
  or public.current_user_has_permission('factory_finished_goods_dispatch.view')
  or public.current_user_has_permission('factory_finished_goods_dispatch.create')
  or public.current_user_has_permission('factory_finished_goods_dispatch.edit')
  or public.current_user_has_permission('factory_finished_goods_dispatch.complete')
);

drop policy if exists "factory finished good categories view" on public.factory_finished_good_categories;
create policy "factory finished good categories view" on public.factory_finished_good_categories for select to authenticated
using (
  public.current_user_has_permission('factory_dashboard.view')
  or public.current_user_has_permission('factory_finished_goods.view')
  or public.current_user_has_permission('factory_production_planning.view')
  or public.current_user_has_permission('factory_production.view')
  or public.current_user_has_permission('factory_production.complete')
);

drop policy if exists "factory product families view" on public.factory_product_families;
create policy "factory product families view" on public.factory_product_families for select to authenticated
using (
  public.current_user_has_permission('factory_dashboard.view')
  or public.current_user_has_permission('factory_finished_goods.view')
  or public.current_user_has_permission('factory_production_planning.view')
  or public.current_user_has_permission('factory_product_families.view')
  or public.current_user_has_permission('factory_product_families.manage')
);

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where lower(r.name) in ('owner', 'admin')
  and p.code like 'factory_%'
on conflict do nothing;
