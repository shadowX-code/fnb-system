# FeedX Production Readiness Audit

Date: 1 June 2026  
Scope: Static code/documentation audit plus local production build verification for the current FeedX staging codebase.

## Executive Decision

Recommendation: **NOT READY for production cutover yet.**

Reason: the application builds successfully and the major modules are now Supabase-backed, but production go-live should wait until the P0 release gates below are completed against the real production Supabase project: migration parity, RLS policy verification, storage bucket/policy verification, SMTP/auth onboarding verification, and full role-based UAT. No new feature work is required for those gates, but they must be completed before moving staging to production.

Production Supabase post-reset update on 1 June 2026:

- Production project ref verified: `oyfobxdoyfuzsodogpgs`.
- Production reset completed successfully.
- Remote migration parity confirmed: 67 local migrations / 67 remote migrations.
- Production auth users, employees, outlets, sales records, purchase records, and suppliers are currently empty after reset.
- Approved system defaults remain: roles, permissions, role permissions, UOM defaults, inventory categories, menu categories, and storage buckets.
- The three migration-seeded staging inventory rows were verified as test/demo data and removed from production.
- Production `inventory_items` count is now `0`.
- `dev` has not been merged to `main`; production deployment has not started.

Git/environment update:

- `FEEDX_RELEASE_CANDIDATE_REPORT.md` was created for the `dev` to `main` promotion.
- Local Supabase CLI was linked to production for reset execution; verify project ref before any future Supabase command.
- `supabase/.temp` files were removed from git tracking and must remain untracked before merging to `main`.
- Vercel branch mapping and environment variables require dashboard/CLI verification before merge.

Production auth onboarding hotfix on 2 June 2026:

- Root cause: the deployed production `employee-auth-onboarding` Edge Function was older than local source and still used `await adminClient.from("audit_logs").insert(...).catch(...)`.
- Supabase JS v2 PostgREST query builders do not expose `.catch()` in that runtime path, causing Generate Setup Link to fail with `adminClient.from(...).insert(...).catch is not a function`.
- Fix deployed: production Edge Function `employee-auth-onboarding` redeployed as version `6`.
- Local function also now accepts both env naming styles:
  - `PROJECT_URL` or `SUPABASE_URL`
  - `PROJECT_SERVICE_ROLE_KEY` or `SUPABASE_SERVICE_ROLE_KEY`
- Verification passed with temporary production users that were deleted after the test:
  - Generate Setup Link returned successfully.
  - Setup token was redeemable.
  - Password creation succeeded.
  - `complete_employee_password_setup()` succeeded.
  - Login with the newly created password succeeded.
- Temporary verification users cleaned up: `feedx.smtp.%@example.com` employees/auth users = `0`.
- Remaining auth configuration issue: Supabase redirected the invite token to `https://feedx-os.vercel.app` root instead of directly to `/setup-password`. The token flow works, but Auth URL configuration should still be reviewed so direct redirects land on `/setup-password`.

## Audit Summary

| Area | Status | Risk | Notes |
|---|---:|---:|---|
| Architecture | Conditional Pass | Medium | Centralized module registry and hash routes are in place. Inventory is still a large single page component and should be split after go-live. |
| Routes | Pass | Low | Active routes come from `config/modules.ts`; Stock Requests and centralized Data Import are removed from active navigation. |
| Permissions | Conditional Pass | High | Sidebar/direct route filtering uses registry permissions. Production roles/RLS must be verified with live accounts. |
| Authentication | Conditional Pass | High | Setup-link generation hotfix is deployed and verified. SMTP delivery and direct `/setup-password` redirect URL configuration still need Dashboard/provider verification. |
| Data Integrity | Conditional Pass | High | Core workflows are Supabase-backed, but production migration parity and seed/setup data must be confirmed. |
| Supabase Policies | Conditional Pass | High | RLS exists across migrations, but the production policy set was not live-tested in this audit. |
| Upload/Storage | Conditional Pass | High | Shared image upload standard exists; production buckets and storage policies must be verified. |
| Component Duplication | Conditional Pass | Medium | KPI/auth styles were centralized; Inventory Control remains too monolithic. |
| Technical Debt | Conditional Pass | Medium | Vite bundle warning, compatibility fallback paths, and limited automated tests remain. |
| Known Issues | Conditional Pass | Medium | See P0/P1/P2 list below. |

## Architecture

Current architecture:

- Frontend: React 19, Vite, Tailwind/CSS utilities, Recharts, Lucide icons.
- Backend: Supabase Auth, PostgREST tables, RLS policies, Storage, and Edge Function `employee-auth-onboarding`.
- Routing: hash-based route IDs managed through `config/modules.ts` and `src/app/routes.jsx`.
- RBAC: module registry generates permissions, sidebar visibility, route access, role matrix, and audit scopes.
- State: master/bootstrap data loads through services; module-specific operational workflows now primarily write/read Supabase.

Strengths:

- Central module registry is the source of truth for active sidebar/routes/permissions.
- Protected owner/admin role behavior is documented.
- Operational history display uses employee display helpers to avoid raw UUIDs.
- Business date helpers and explicit business-date rules were added for inventory workflows.

Risks:

- `InventoryControlPage.jsx` remains a very large module containing Master Inventory, Par Levels, Stock Check, Purchase Orders, Movements, Wastage, Recipes, Product Mapping, and Recipe Intelligence.
- Some service files retain schema-compatibility fallback paths. These should not mask production schema drift after go-live.
- No automated end-to-end or unit test suite is currently present in `package.json`.

## Routes And Navigation

Active route source:

- `config/modules.ts`
- `src/app/routes.jsx`

Active primary modules:

- Overview: Dashboard, Outlet P&L, S&P Dashboard, Product Analytics, Sales Comparison, Purchase Comparison, Alerts & Insights, Outlet Duty Roster
- Sales: Sales Input, Sales Channels, Tax Settings
- Purchases: Purchase Input, Suppliers, Supplier Categories
- Operations: Operating Expenses, Duty Roster, Asset Tracking, Outlets, Data Health
- Inventory Control: Dashboard, Master Inventory, Par Levels, Stock Check Groups, Stock Check, Purchase Orders, Inventory Movements, Wastage, Recipes & Usage, Recipe Intelligence
- People: Employees, Job Positions, Departments, Roles & Permissions
- System: Audit Logs

Route decisions confirmed:

- Overview Dashboard is now labeled Dashboard; URL/route id remains unchanged.
- Waste & Variance is now Wastage in UI/navigation/docs.
- Purchase Categories is now Supplier Categories in UI/navigation/docs.
- Recipe Intelligence is standalone under Inventory Control.
- Recipes & Usage contains Recipe BOM setup and Product Mapping only.
- Central Data Import page is removed from active navigation; Sales/Purchase imports live inside Sales Input and Purchase Input.
- Stock Requests is deferred/out of MVP and not active in module registry/sidebar.

## Permissions And RBAC

Current permission pattern:

- Sidebar visibility is filtered by route permission.
- Direct route access redirects to an accessible route when the user lacks permission.
- Owner/admin protected roles bypass matrix checks.
- Role Management blocks users from editing their own role permissions and from assigning permissions/outlets outside scope.
- Recipe Intelligence currently uses `inventory_recipes.view` through route override rather than a separate `recipe_intelligence.view` permission.

Production risk:

- RBAC must be tested with real production roles: owner/admin, all-outlet manager, selected-outlet manager, and limited outlet staff.
- RLS must match UI permission assumptions. UI gating alone is not sufficient.

## Authentication

Implemented:

- Supabase Auth email/password login.
- Forgot Password redirects to `/setup-password`.
- Invite/setup-password temporary sessions are blocked from entering the app until password setup completion.
- `complete_employee_password_setup()` RPC activates employee access after password update.
- Sidebar Change Password flow verifies current password before update.
- Login, Forgot Password, Setup Password, and Reset Password share the refreshed FeedX auth visual system.

Production release gates:

- Verify Supabase Auth Site URL and redirect URLs for production domain.
- Verify SMTP sender and email template links.
- Deploy and smoke-test `employee-auth-onboarding` Edge Function in production.
- Verify setup link, forgot password, refresh-before-password, direct-dashboard-block, password completion, logout, and login with new password.

## Data Integrity

Supabase-backed workflows documented/implemented:

- Sales Input and Purchase Input including module-level import.
- Product Analytics upload/reporting.
- Suppliers and Supplier Categories.
- Operating Expenses.
- Duty Roster.
- Asset Tracking, Asset Import, inspections, maintenance, and activity.
- Inventory Control core: Master Inventory, Categories, UOM, Par Levels, Stock Check Groups, Stock Check, Purchase Suggestions, Purchase Orders, Inventory Movements, Wastage, Recipes & Usage, Product Mapping, Recipe Intelligence.
- People: Employees, Job Positions, Departments, Roles & Permissions, login access lifecycle.
- Audit Logs.

Data integrity release gates:

- Apply all migrations to production in order.
- Verify required seed/setup records: outlets, roles, permissions, sales channels, supplier categories, inventory seed where needed, storage buckets.
- Verify no authenticated production workflow depends on browser-local operational records.
- Verify imports create `import_batches` and `import_batch_rows` where schema is available.

## Supabase Policies

High-value tables requiring explicit production verification:

- `employees`, `roles`, `role_permissions`, `role_outlets`, `departments`, `job_positions`
- `outlets`, `sales_records`, `purchase_records`, `suppliers`, `purchase_categories`, `sales_channels`, `operating_expenses`
- `product_analytics_reports`, `product_analytics_items`, `product_recipe_mappings`
- `asset_items`, `asset_categories`, `asset_inspections`, `asset_inspection_items`, `asset_maintenance_records`
- `inventory_items`, `inventory_categories`, `inventory_uoms`, `inventory_item_outlets`, `inventory_par_levels`, `inventory_item_outlet_suppliers`
- `inventory_stock_check_groups`, `inventory_stock_checks`, `inventory_stock_check_items`
- `inventory_purchase_orders`, `inventory_purchase_order_items`, `inventory_purchase_receipts`, `inventory_purchase_receipt_items`
- `inventory_movements`, `inventory_waste_records`, `inventory_recipes`, `inventory_recipe_items`, `inventory_menu_categories`
- `audit_logs`, `import_batches`, `import_batch_rows`

RLS verification rule:

- For each table: owner/admin full access, all-outlet role all scoped outlet rows, selected-outlet role assigned outlets only, view-only role cannot write, no-permission role blocked.

## Upload And Storage

Documented FeedX image upload standard:

- Allowed: JPG/JPEG, PNG, WebP.
- Max source upload: 5MB.
- Client-side optimization: longest side max 1920px, WebP around 80% quality, optimized version only.
- Target storage size: approximately 0.5MB-2MB.
- Replacing images should remove old storage files when safely owned/unreferenced.

Current buckets:

- `inventory-item-photos`: inventory item photos, recipe photos, waste evidence.
- `asset-photos`: asset photos, maintenance photos, asset inspection evidence.

Production release gates:

- Verify buckets exist in production.
- Verify read/write/delete policies for permitted roles.
- Verify old-object cleanup for replacement flows.
- Verify image upload on Employees if used by production profile/avatar flow.

## Component Duplication

Improved:

- Shared KPI typography/header direction.
- Shared FeedX auth shell for login/reset/setup.
- Shared employee display helper for operational actor names.
- Shared image upload helper.

Remaining:

- Inventory Control page should be split into domain components/services after production stabilization.
- Several custom table/KPI implementations remain outside fully shared components.
- Asset service contains schema compatibility fallbacks that should be removed after production schema parity is confirmed.

## Technical Debt

P1/P2 debt:

- Large Vite chunk warning remains; introduce route-level code splitting after go-live.
- Add automated tests for auth guard, RBAC route filtering, import validation, inventory save paths, and purchase order receiving.
- Remove schema compatibility fallbacks once production migrations are locked.
- Centralize remaining toast/error wording and destructive confirmation patterns.
- Split `InventoryControlPage.jsx` into maintainable submodules.
- Add production monitoring for Supabase API errors, storage failures, and Edge Function failures.

## P0 Issues

P0 release gates before production:

1. **Production RLS/policy behavior not live-tested after reset.**  
   Execute the RBAC/UAT matrix with real production roles before go-live.

2. **Production storage upload/read/delete flows not browser-tested after reset.**  
   Buckets exist, but image upload policies and replacement cleanup still need live verification.

3. **Production auth SMTP delivery and direct redirect target not fully verified.**  
   Generate Setup Link works after Edge Function version `6`, including password creation and login. SMTP delivery remains blocked pending provider/Dashboard checks, and Supabase currently redirects invite tokens to `https://feedx-os.vercel.app` root instead of directly to `/setup-password`.

4. **Full production UAT checklist not yet executed.**  
   Use `FEEDX_PRODUCTION_UAT_CHECKLIST.md` before final cutover.

## P1 Issues

- Add automated smoke tests for core routes and auth states.
- Code-split major pages to resolve Vite large chunk warning.
- Remove production schema fallback branches once migrations are verified.
- Split Inventory Control into smaller components.
- Add monitoring/error reporting for Supabase failures and storage upload failures.
- Verify import history UX for Sales/Purchase after role permission changes.

## P2 Issues

- Improve remaining export placeholders and export formatting.
- Add downloadable import error reports.
- Add richer audit-log drilldowns.
- Add more granular `recipe_intelligence.view` permission if the business wants analytics separated from recipe setup.
- Standardize remaining module table layouts into shared components.

## Build Verification

Command: `npm run build`

Status: **Pass** on 1 June 2026.

Known build warning: Vite reports chunks larger than 500 kB after minification. This is not a functional blocker but is a P1 performance improvement.

## Documentation Gaps Found

- Production readiness and UAT checklist did not previously exist as release-governance documents.
- Master document needed an explicit current production readiness section tying together naming, auth, RBAC, storage, and release-gate expectations.
- Production deployment checklist should be kept separate from feature UAT reports so staging feature completion is not confused with production cutover readiness.
