# FeedX RBAC Action Permission Audit

Date: 2026-05-29

## Rule

- UI actions must check the exact module action permission key from the module registry.
- Protected owner/admin bypass can apply only where the action is explicitly protected by system policy.
- Role Management is the only current module with self-role and protected-role edit restrictions.
- No feature page should hardcode owner/admin access for ordinary create/edit/delete/import/export actions.

## Fixes Applied

### Roles & Permissions

Expected keys:

- View: `roles_permissions.view`
- Create: `roles_permissions.create`
- Edit: `roles_permissions.edit`
- Delete: `roles_permissions.delete`

Current implementation:

- Role edit entry points now check `roles_permissions.edit`.
- Legacy aliases map `roles.*` to `roles_permissions.*` and back while older permission rows still exist.
- Database migration `202605290004_roles_permissions_alias.sql` seeds canonical `roles_permissions.*` rows, backfills legacy/canonical assignments both ways, and updates Role Management RLS helpers to accept both key families during the transition.
- Disabled Edit Role now logs `[RoleDebug] Edit Role button` in development with current role, target role, own-role state, protected state, permission state, and disable reason.
- Disabled Edit Role now shows the exact reason in the Role View footer.

Role Management restrictions:

- Owner can edit all roles.
- Admin can edit all non-owner roles.
- Custom users with `roles_permissions.edit` can edit non-protected custom roles.
- Custom users cannot edit owner/admin/protected roles.
- Custom users cannot edit their own role.

### Inventory Control

Corrected broad grouped permission checks:

- Master Inventory import now checks `inventory_master.import`.
- Master Inventory export now checks `inventory_master.export`.
- Add Item checks `inventory_master.create`.
- Edit Item checks `inventory_master.edit`.
- Archive Item checks `inventory_master.delete`.
- Par Level configuration checks `inventory_par_levels.edit`.
- Par Levels export checks `inventory_par_levels.export`.
- Purchase Order submit checks `inventory_orders.submit`.
- Purchase Order receive checks `inventory_orders.receive`.
- Purchase Order complete checks `inventory_orders.complete`.
- Purchase Order cancel checks `inventory_orders.cancel`.
- Purchase Order draft edit checks `inventory_orders.edit`.
- Purchase Order export checks `inventory_orders.export`.
- Recipes export checks `inventory_recipes.export`.

## Canonical Action Map

| Module | Action | Expected Permission Key | Audit Status |
|---|---|---:|---|
| Employees | View | `employees.view` | Aligned |
| Employees | Create | `employees.create` | Aligned |
| Employees | Edit | `employees.edit` | Aligned |
| Employees | Deactivate | `employees.deactivate` | Aligned |
| Employees | Enable Login | `employees.enable_login` | Aligned |
| Employees | Reset Password | `employees.reset_password` | Aligned |
| Job Positions | View | `job_positions.view` | Aligned |
| Job Positions | Create | `job_positions.create` | Aligned |
| Job Positions | Edit | `job_positions.edit` | Aligned |
| Job Positions | Delete | `job_positions.delete` | Aligned |
| Departments | View | `departments.view` | Aligned |
| Departments | Create | `departments.create` | Aligned |
| Departments | Edit | `departments.edit` | Aligned |
| Departments | Delete | `departments.delete` | Aligned |
| Roles & Permissions | View | `roles_permissions.view` | Alias-supported; registry migration still recommended |
| Roles & Permissions | Create | `roles_permissions.create` | Fixed |
| Roles & Permissions | Edit | `roles_permissions.edit` | Fixed |
| Roles & Permissions | Delete | `roles_permissions.delete` | Fixed |
| Outlets | View | `outlets.view` | Aligned |
| Outlets | Create | `outlets.create` | Aligned |
| Outlets | Edit | `outlets.edit` | Aligned |
| Outlets | Delete | `outlets.delete` | Aligned |
| Data Import | View | `data_import.view` | Aligned |
| Data Import | Import | `data_import.import` | Aligned |
| Data Health | View | `data_health.view` | Aligned; month lock uses view because no lock/manage key exists |
| Sales Input | View | `sales_input.view` | Aligned |
| Sales Input | Create/Edit | `sales_input.create` / `sales_input.edit` | Aligned via write helper |
| Sales Channels | View/Create/Edit/Delete | `sales_channels.*` | Aligned |
| Tax Settings | View/Edit | `tax_settings.view` / `tax_settings.edit` | Aligned |
| Purchase Input | View | `purchase_input.view` | Aligned |
| Purchase Input | Create/Edit | `purchase_input.create` / `purchase_input.edit` | Aligned via write helper |
| Suppliers | View/Create/Edit/Delete | `suppliers.*` | Aligned |
| Suppliers | Deactivate | `suppliers.deactivate` or `suppliers.edit` | Alias/fallback used; registry lacks deactivate |
| Purchase Categories | View/Create/Edit/Delete | `purchase_categories.*` | Aligned |
| Operating Expenses | View/Create/Edit | `operating_expenses.*` | Aligned via write helper |
| Duty Roster | View/Create/Edit/Delete/Manage/Export | `duty_roster.*` | Aligned |
| Asset Tracking | View/Create/Edit/Delete/Manage/Export | `asset_tracking.*` | Aligned |
| Inventory Dashboard | View | `inventory_dashboard.view` | Aligned |
| Master Inventory | View/Create/Edit/Delete/Import/Export | `inventory_master.*` | Fixed |
| Inventory Categories | View/Create/Edit/Delete | `inventory_categories.*` | Aligned |
| Par Levels | View/Edit/Export | `inventory_par_levels.*` | Fixed |
| Stock Check Groups | View/Create/Edit/Delete | `inventory_groups.*` | Aligned |
| Stock Check | View/Create/Edit/Review/Audit/Export | `inventory_stock_check.*` | Aligned |
| Purchase Orders | View/Create/Edit/Submit/Receive/Complete/Cancel/Export | `inventory_orders.*` | Fixed |
| Inventory Movements | View/Create/Export | `inventory_movements.*` | Aligned |
| Waste & Variance | View/Create/Manage/Export | `inventory_waste.*` | Aligned |
| Recipes & Usage | View/Create/Edit/Delete/Manage/Export | `inventory_recipes.*` | Fixed |

## Remaining Follow-Up

- Migrate the module registry from legacy `roles.*` to canonical `roles_permissions.*` so the matrix, route guard, and service catalog all use the same role-permission module key without aliases.
- Consider adding explicit `data_health.lock` / `data_health.unlock` or `data_health.manage` if month locking should not be controlled by `data_health.view`.
- Consider adding `suppliers.deactivate` to the module registry if supplier deactivation should be separate from edit.
