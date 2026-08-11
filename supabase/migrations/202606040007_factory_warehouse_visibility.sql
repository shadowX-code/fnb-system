-- Factory warehouse visibility optimization.
-- Finished Goods and Product Movements are read-only warehouse views that need
-- production headers for last production date, batch history and movement source context.

drop policy if exists "factory production view" on public.factory_productions;
create policy "factory production view" on public.factory_productions for select to authenticated
using (
  public.current_user_has_permission('factory_dashboard.view')
  or public.current_user_has_permission('factory_production.view')
  or public.current_user_has_permission('factory_production_reports.view')
  or public.current_user_has_permission('factory_batch_traceability.view')
  or public.current_user_has_permission('factory_finished_goods.view')
  or public.current_user_has_permission('factory_product_movements.view')
);
