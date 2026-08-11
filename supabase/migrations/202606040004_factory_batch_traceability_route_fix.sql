-- Factory Phase 1E UAT fix: expose Batch Traceability as its own RBAC-protected read module.

insert into public.permissions (code, module, description)
values
  ('factory_batch_traceability.view', 'Batch Traceability', 'View Factory Batch Traceability.'),
  ('factory_batch_traceability.export', 'Batch Traceability', 'Export Factory Batch Traceability.')
on conflict (code) do update
set module = excluded.module,
    description = excluded.description;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.name in ('owner', 'admin')
  and p.code like 'factory_batch_traceability.%'
on conflict do nothing;

drop policy if exists "factory job orders view" on public.factory_job_orders;
create policy "factory job orders view" on public.factory_job_orders for select to authenticated
using (
  public.current_user_has_permission('factory_dashboard.view')
  or public.current_user_has_permission('factory_job_orders.view')
  or public.current_user_has_permission('factory_production.view')
  or public.current_user_has_permission('factory_batch_traceability.view')
);

drop policy if exists "factory production view" on public.factory_productions;
create policy "factory production view" on public.factory_productions for select to authenticated
using (
  public.current_user_has_permission('factory_dashboard.view')
  or public.current_user_has_permission('factory_production.view')
  or public.current_user_has_permission('factory_production_reports.view')
  or public.current_user_has_permission('factory_batch_traceability.view')
);

drop policy if exists "factory production usage view" on public.factory_production_material_usage;
create policy "factory production usage view" on public.factory_production_material_usage for select to authenticated
using (
  public.current_user_has_permission('factory_production.view')
  or public.current_user_has_permission('factory_production_reports.view')
  or public.current_user_has_permission('factory_batch_traceability.view')
);

drop policy if exists "factory product movements view" on public.factory_product_stock_movements;
create policy "factory product movements view" on public.factory_product_stock_movements for select to authenticated
using (
  public.current_user_has_permission('factory_product_movements.view')
  or public.current_user_has_permission('factory_finished_goods.view')
  or public.current_user_has_permission('factory_dashboard.view')
  or public.current_user_has_permission('factory_batch_traceability.view')
);

drop policy if exists "factory production qc checkpoints view" on public.factory_production_qc_checkpoints;
create policy "factory production qc checkpoints view" on public.factory_production_qc_checkpoints for select to authenticated
using (
  public.current_user_has_permission('factory_production.view')
  or public.current_user_has_permission('factory_production_reports.view')
  or public.current_user_has_permission('factory_batch_traceability.view')
);
