-- Inventory child-module RBAC permission sync
-- Inventory Control is a sidebar grouping only; active permissions live on child modules.

insert into public.permissions (code, module, description)
values
  ('inventory_dashboard.view', 'Inventory Dashboard', 'View Inventory Dashboard.'),

  ('inventory_master.view', 'Master Inventory', 'View Master Inventory.'),
  ('inventory_master.create', 'Master Inventory', 'Create Master Inventory.'),
  ('inventory_master.edit', 'Master Inventory', 'Edit Master Inventory.'),
  ('inventory_master.delete', 'Master Inventory', 'Delete Master Inventory.'),
  ('inventory_master.import', 'Master Inventory', 'Import Master Inventory.'),
  ('inventory_master.export', 'Master Inventory', 'Export Master Inventory.'),

  ('inventory_categories.view', 'Inventory Categories', 'View Inventory Categories.'),
  ('inventory_categories.create', 'Inventory Categories', 'Create Inventory Categories.'),
  ('inventory_categories.edit', 'Inventory Categories', 'Edit Inventory Categories.'),
  ('inventory_categories.delete', 'Inventory Categories', 'Delete Inventory Categories.'),

  ('inventory_par_levels.view', 'Par Levels', 'View Par Levels.'),
  ('inventory_par_levels.edit', 'Par Levels', 'Edit Par Levels.'),
  ('inventory_par_levels.export', 'Par Levels', 'Export Par Levels.'),

  ('inventory_groups.view', 'Stock Check Groups', 'View Stock Check Groups.'),
  ('inventory_groups.create', 'Stock Check Groups', 'Create Stock Check Groups.'),
  ('inventory_groups.edit', 'Stock Check Groups', 'Edit Stock Check Groups.'),
  ('inventory_groups.delete', 'Stock Check Groups', 'Delete Stock Check Groups.'),

  ('inventory_stock_check.view', 'Stock Check', 'View Stock Check.'),
  ('inventory_stock_check.create', 'Stock Check', 'Create Stock Check.'),
  ('inventory_stock_check.edit', 'Stock Check', 'Edit Stock Check.'),
  ('inventory_stock_check.review', 'Stock Check', 'Review Stock Check.'),
  ('inventory_stock_check.audit', 'Stock Check', 'Audit Stock Check.'),
  ('inventory_stock_check.export', 'Stock Check', 'Export Stock Check.'),

  ('inventory_orders.view', 'Purchase Orders', 'View Purchase Orders.'),
  ('inventory_orders.create', 'Purchase Orders', 'Create Purchase Orders.'),
  ('inventory_orders.edit', 'Purchase Orders', 'Edit Purchase Orders.'),
  ('inventory_orders.submit', 'Purchase Orders', 'Submit Purchase Orders.'),
  ('inventory_orders.receive', 'Purchase Orders', 'Receive Purchase Orders.'),
  ('inventory_orders.complete', 'Purchase Orders', 'Complete Purchase Orders.'),
  ('inventory_orders.cancel', 'Purchase Orders', 'Cancel Purchase Orders.'),
  ('inventory_orders.export', 'Purchase Orders', 'Export Purchase Orders.'),

  ('inventory_movements.view', 'Inventory Movements', 'View Inventory Movements.'),
  ('inventory_movements.create', 'Inventory Movements', 'Create Inventory Movements.'),
  ('inventory_movements.export', 'Inventory Movements', 'Export Inventory Movements.'),

  ('inventory_waste.view', 'Waste & Variance', 'View Waste & Variance.'),
  ('inventory_waste.create', 'Waste & Variance', 'Create Waste & Variance.'),
  ('inventory_waste.manage', 'Waste & Variance', 'Manage Waste & Variance.'),
  ('inventory_waste.export', 'Waste & Variance', 'Export Waste & Variance.'),

  ('inventory_recipes.view', 'Recipes & Usage', 'View Recipes & Usage.'),
  ('inventory_recipes.create', 'Recipes & Usage', 'Create Recipes & Usage.'),
  ('inventory_recipes.edit', 'Recipes & Usage', 'Edit Recipes & Usage.'),
  ('inventory_recipes.delete', 'Recipes & Usage', 'Delete Recipes & Usage.'),
  ('inventory_recipes.manage', 'Recipes & Usage', 'Manage Recipes & Usage.'),
  ('inventory_recipes.export', 'Recipes & Usage', 'Export Recipes & Usage.')
on conflict (code) do update
set module = excluded.module,
    description = excluded.description;

insert into public.role_permissions (role_id, permission_id)
select roles.id, permissions.id
from public.roles
cross join public.permissions
where roles.name in ('owner', 'admin')
  and permissions.code like 'inventory\_%' escape '\'
on conflict do nothing;
