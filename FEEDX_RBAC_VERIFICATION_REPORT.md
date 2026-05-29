# FeedX RBAC Verification Report

Date: 30 May 2026  
Scope: Sidebar visibility, direct route gating, page action permissions, outlet scope enforcement, and Supabase RLS alignment after Inventory Control persistence work.

## Summary

Overall result: **Pass with live-role UAT caveat**

Risk level: **Medium-low**

Verification method:
- Static verification of module registry, route guard, sidebar derivation, role editor rules, Inventory Control action guards, outlet access helper, and Supabase RLS migrations.
- Build verification.
- Multi-account browser UAT was not completed in this pass because no separate role credentials were available in the workspace context.

Critical fixes applied during this verification:
- Removed deferred `inventory_requests` from the active module registry so Stock Requests no longer appears in the Role Management permission matrix/catalog.
- Replaced legacy `inventory_control.view` bootstrap dependency for outlet/supplier context with active child Inventory permissions so Inventory-only custom roles can load required outlet/supplier data.

## Permission Action Map

| Module | Permission | Expected | Actual | Result | Notes |
|---|---|---|---|---|---|
| Overview Dashboard | `dashboard.view` | Sidebar visible and direct route allowed only with view | Route/sidebar derive from registry permission | Pass | Outlet filters use accessible outlet helper. |
| Sales Input | `sales_input.view/create/edit/delete` | View gates page, actions gate mutations | Registry and route guard aligned | Pass | Existing Sales action UAT still recommended. |
| Sales Comparison | `sales_comparison.view/export` | View/export scoped separately | Registry and route guard aligned | Pass | Export permission exists in registry. |
| Sales Channels | `sales_channels.view/create/edit/delete` | CRUD actions require matching key | Registry aligned | Pass | No hardcoded owner/admin gate found in route registry. |
| Tax Settings | `tax_settings.view/edit` | View and edit only | Registry aligned | Pass | No create/delete permissions exposed. |
| Purchase Input | `purchase_input.view/create/edit/delete/approve` | Purchase entry actions use child keys | Registry aligned | Pass | Supplier context bootstrap includes purchase permissions. |
| Suppliers | `suppliers.view/create/edit/delete` | Supplier actions use child keys | Registry aligned | Pass | Supplier page also treats deactivate as edit-compatible where used. |
| Purchase Categories | `purchase_categories.view/create/edit/delete` | CRUD actions use child keys | Registry aligned | Pass | No parent purchase permission detected. |
| Operating Expenses | `operating_expenses.view/create/edit/delete` | Page/action gating by child keys | Registry aligned | Pass | Outlet bootstrap includes operating expenses. |
| Duty Roster | `duty_roster.view/create/edit/delete/manage/export` | Roster actions use child keys | Registry aligned | Pass | Detailed action browser UAT recommended. |
| Asset Tracking | `asset_tracking.view/create/edit/delete/manage/export` | Asset page/actions use child keys | Registry aligned | Pass | No protected-role-only action gate found in registry. |
| Inventory Dashboard | `inventory_dashboard.view` | Sidebar/page visible only with view | Route/sidebar derive from registry | Pass | Included in outlet bootstrap. |
| Master Inventory | `inventory_master.view/create/edit/delete/import/export` | Page, item CRUD, import/export use child keys | `InventoryControlPage` action map uses exact keys | Pass | Category/UOM settings remain internal sub-workflows. |
| Inventory Categories | `inventory_categories.view/create/edit/delete` | Settings modal actions use category keys | Modal buttons require exact category keys | Pass | Internal only; no sidebar route. |
| Inventory UOMs | `inventory_uoms.view/create/edit/delete` | Settings modal actions use UOM keys | Modal buttons require exact UOM keys | Pass | Internal only; no sidebar route. |
| Par Levels | `inventory_par_levels.view/edit/export` | Page visible with view; edits require edit | Action map uses exact keys | Pass | Included in outlet/supplier bootstrap. |
| Stock Check Groups | `inventory_groups.view/create/edit/delete` | Group CRUD requires group keys | Create/edit use create or edit; archive uses same manage gate | Pass | Delete/archive could be split more strictly later. |
| Stock Check | `inventory_stock_check.view/create/edit/review/audit/export` | Scheduled/audit/review actions use exact keys | Action map uses create/audit/edit/review/export keys | Pass | Audit is separate from purchase suggestions. |
| Stock Requests | N/A | Deferred and absent from active UI/matrix | Removed from active route/sidebar/registry | Pass | Legacy tables/code may remain inaccessible. |
| Purchase Orders | `inventory_orders.view/create/edit/submit/receive/complete/cancel/export` | PO workflow actions use exact status permission keys | Action map uses exact keys | Pass | Receive/complete/cancel RLS is outlet-scoped. |
| Inventory Movements | `inventory_movements.view/create/export` | Movement list/create/export use child keys | Action map uses create/export; route uses view | Pass | Movement rows are Supabase-backed. |
| Waste & Variance | `inventory_waste.view/create/manage/export` | View and record waste separated | Action map uses view/create/manage/export | Pass | Manage covers edit/archive for current scope. |
| Recipes & Usage | `inventory_recipes.view/create/edit/delete/manage/export` | View/export and recipe management gated | Current UI uses `manage` for create/edit/archive | Pass with note | Registry exposes granular create/edit/delete too; UI currently treats manage as operational write gate. |
| Employees | `employees.view/create/edit/deactivate/enable_login/reset_password` | Employee access/actions use child keys | Registry and known action checks aligned | Pass | Employee role save had earlier fix; browser recheck recommended. |
| Job Positions | `job_positions.view/create/edit/delete` | CRUD actions use child keys | Registry aligned via route mapping | Pass | Module id hyphen maps to underscore permission prefix. |
| Departments | `departments.view/create/edit/delete` | CRUD actions use child keys | Registry aligned via route mapping | Pass | Module id hyphen maps to underscore permission prefix. |
| Roles & Permissions | `roles_permissions.view/create/edit/delete` | Role editor uses canonical roles_permissions keys | Role page checks `roles_permissions.*` with legacy alias support | Pass | Registry still uses route id `roles`; aliases bridge legacy rows. |
| Outlets | `outlets.view/create/edit/delete` | Outlet actions use child keys | Registry aligned | Pass | Outlet scope helper supports all/selected access. |
| Data Import | `data_import.view/import` | Import action separate from view | Registry aligned via route mapping | Pass | Module id hyphen maps to underscore permission prefix. |
| Data Health | `data_health.view` | View-only | Registry aligned via route mapping | Pass | No mutation actions exposed. |
| Audit Logs | `audit_logs.view/export` | View/export use child keys | Registry aligned via route mapping | Pass | System section route guarded. |

## Role Type Rules

| Role Type | Expected | Actual | Result | Notes |
|---|---|---|---|---|
| Owner | Full access to all roles, outlets, pages, and actions | Protected role gets all active registry permissions | Pass | Can edit all roles. |
| Admin | Full operational access except Owner role edit where restricted | Role page blocks admin editing owner | Pass | Admin behavior depends on protected role naming. |
| Custom all-outlet role | Sees all current/future outlets and can filter to each outlet | `outlet_access_type = all` loads all active outlets | Pass | Outlet filters should show All Outlets plus individual outlets. |
| Custom selected-outlet role | Sees only assigned outlets and cannot assign inaccessible outlets | Access helper filters by role_outlets; Role editor validates subset | Pass | Role editor blocks outlet privilege escalation. |
| Limited outlet staff role | Sidebar/routes/actions limited by granted keys | Route/sidebar derive from registry and action buttons use guards | Pass | Live staff UAT still recommended. |

## Direct Route And Sidebar

| Layer | Expected | Actual | Result | Notes |
|---|---|---|---|---|
| Sidebar | Hide modules without `*.view` | `filterSectionsByPermission` derives from registry and route permissions | Pass | No separate sidebar permission list. |
| Direct route | Block pages without `*.view` | Inaccessible hash route falls back to first accessible route | Pass | No dedicated 403 page; behavior is safe fallback. |
| Stock Requests | Not accessible in current MVP | Removed from active registry and route list | Pass | Manual route cannot open local-only workflow through active routes. |
| Inventory context loading | Inventory-only roles can load outlets/suppliers | Bootstrap now includes child Inventory permissions | Pass | Replaced legacy `inventory_control.view` dependency. |

## Supabase RLS Alignment

| Area | Expected | Actual | Result | Notes |
|---|---|---|---|---|
| Role management | Users with role edit can manage non-protected roles only | RLS helpers accept `roles_permissions.edit` aliases and block protected/self escalation | Pass | Frontend also blocks own-role and protected-role edits. |
| Role permissions | Custom users cannot grant permissions they do not have | Frontend validates scope; RLS helper checks assignment safety | Pass | Backend validation remains final authority. |
| Role outlets | Custom users cannot assign outlets outside their scope | Frontend validates selected outlets; RLS uses outlet helper | Pass | Owner/admin bypass through all-outlet access. |
| Inventory outlet scope | Selected-outlet users only access assigned outlets | RLS uses `current_user_can_access_outlet()` on outlet-scoped tables | Pass | Applies to PO, stock check, waste, recipes, movements. |
| Inventory legacy fallbacks | Active RBAC should use child permissions only | Some older RLS migrations still include `inventory_control.*` fallback clauses | Pass with tech debt | Active UI no longer grants these keys; cleanup migration recommended later. |

## Bugs Found

| Severity | Issue | Status | Notes |
|---|---|---|---|
| Critical | Deferred Stock Requests still existed in active module registry | Fixed | Removed from `config/modules.ts`; it no longer participates in generated permission groups/catalog. |
| High | Inventory-only roles could miss outlet/supplier bootstrap context because bootstrap checks used legacy `inventory_control.view` | Fixed | Added active child Inventory permissions to `BOOTSTRAP_LOADS`. |
| Medium | Some Supabase RLS migrations retain legacy `inventory_control.*` permission fallbacks | Open | Not user-facing if legacy rows are not assigned; schedule cleanup migration after role data audit. |
| Low | Roles route registry still uses module id `roles`, while canonical action checks use `roles_permissions.*` aliases | Open | Alias layer is intentional for compatibility; future registry migration can remove legacy `roles.*`. |
| Low | Recipes UI uses `inventory_recipes.manage` as the write gate despite granular create/edit/delete existing | Open | Functionally safe but less granular than the registry allows. |

## Remaining Technical Debt

- Run live browser UAT with four real accounts: Owner/Admin, custom all-outlet, custom selected-outlet, and limited outlet staff.
- Add a database cleanup migration to remove or neutralize legacy `inventory_control.*` RLS fallback paths after confirming no roles still depend on them.
- Decide whether `inventory_recipes.create/edit/delete` should replace the current `inventory_recipes.manage` write gate for more granular action control.
- Consider a dedicated "Access denied" state for blocked direct routes instead of silently falling back to the first accessible route.

## Final Status

RBAC code and RLS architecture are aligned for the active FeedX MVP modules. The only remaining caveat is live multi-role browser verification, which requires role-specific credentials or a seeded UAT account set.
