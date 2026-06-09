# FeedX Development Log

Purpose: concise development history for meaningful FeedX development sessions. The master document remains the source of truth for final logic and architecture; release notes under `docs/releases/` document production releases.

## 2026-06-09

### Factory
- Refined Factory Finished Goods create/edit UX into a single-column, sectioned Product Information / Configuration / Notes form and removed finished-goods min-stock planning from the user-facing flow.

## 2026-06-08

### Duty Roster
- Added published Duty Roster snapshot retention so published/locked roster history keeps employee, position, department, outlet, shift and publish timestamp details after employee master data changes.
- Updated Duty Roster and Outlet Duty Roster views to show historical published snapshot staff, including resigned or terminated employees, while draft scheduling remains limited to current active outlet employees.
- Replaced the Outlet Duty Roster Working Staff and Unscheduled Days KPI cards with clickable Off Day, Annual Leave, and MC KPI detail drawers that respect outlet, month, group, position, employee search and published roster snapshots.
- Modernized Outlet Duty Roster monthly date cards with compact Staff Scheduled, Floor, Kitchen, OFF, AL, and MC chips plus status/today badges and a clearer View details affordance.
- Refined Outlet Duty Roster monthly calendar density by hiding zero-value chips and giving unscheduled days a lighter dashed No Schedule state.

### Purchase Comparison
- Changed the Purchase Comparison default View Mode to Supplier while keeping Category, Supplier, and Full selectable.

### Outlet P&L
- Simplified Revenue Trend and Net Profit Trend hover tooltips so each chart shows only its own month and two plotted series values.

### Inventory Control
- Added shorter business-facing Purchase Order references in `[OutletCode]-[YYMMDD]-[RunningNo]` format while preserving the existing internal PO system ID.

## 2026-06-03

### Product Sales Analytics
- Changed the Product Sales Analytics default reporting filter to the previous completed month while preserving manual month/year selection and existing compare-month behavior.

### Purchase Import
- Added supplier default-category auto-fill for purchase import rows with blank Category values, counting those rows as warnings while keeping rows failed when neither the upload nor supplier profile provides a valid category.

### Build Tooling
- Fixed Tailwind v4 build hangs by disabling automatic source detection and relying on explicit `@source` paths for app files.

## 2026-05-22

### People
- Stabilized Employees, Job Positions, Departments, Roles & Permissions, and Employee Login Access.
- Separated Employment Type, Employment Status, and System Access.
- Added Management workplace option for HQ/non-outlet staff.

### Duty Roster
- Stabilized roster settings, shift templates, outlet staff filtering, and time input UX.
- Kept resigned/terminated employees out of outlet-specific roster staff selection.

## 2026-05-24

### Asset Tracking
- Stabilized asset records, import workflow, inspections, activity display, and actor-name resolution.
- Simplified inspection UX to Setup, Checklist, and Review & Submit.

## 2026-05-26

### Inventory Control
- Completed persistence hardening for Master Inventory, Categories, UOM, Par Levels, Stock Check Groups, Stock Checks, Purchase Suggestions, Purchase Orders, Inventory Movements, Wastage, and Recipes.
- Removed local-only operational persistence paths from active Inventory Control modules.
- Added UAT and production-readiness documentation for Inventory workflows.

## 2026-05-28

### Recipes & Usage
- Added recipe costing foundation with recipe code, English/Chinese names, ingredient costs, selling price, margin, and recipe photos.
- Added Product Mapping workflow for Product Analytics products to recipes.

### Recipe Intelligence
- Added standalone Recipe Intelligence analytics page.
- Added mapping health, menu engineering matrix, gross profit trend, ingredient demand forecast, ingredient consumption, and ingredient cost trend foundations.

## 2026-05-30

### UI
- Standardized KPI typography, table density, sidebar typography, dark-mode semantic colors, and operational KPI card headers.
- Renamed Waste & Variance to Wastage and Purchase Categories to Supplier Categories in UI/navigation.

## 2026-06-01

### Production
- Completed Production readiness audit, production UAT checklist, and release-candidate reporting.
- Reset Production Supabase after approved disposable-data decision.
- Achieved migration parity 67/67 after Production reset.
- Removed migration-seeded test inventory rows from Production.
- Bootstrapped first Production owner user.

### Auth
- Audited Production SMTP readiness.
- Confirmed SMTP/setup email delivery was blocked pending configuration.
- Fixed Generate Setup Link Supabase v2 admin-client insert/update/upsert handling.

## 2026-06-02

### Production Operations
- Entered Production Operations Phase.
- Confirmed development governance: all development on `dev`, Production deploys from `main`, schema changes are migration-based, and Production Supabase changes require explicit approval.
- Added mandatory documentation enforcement: every completed development task must update the development log, business logic changes must update the master document, and production releases must update release notes before completion is reported.

### Auth UI
- Refreshed public login/setup/reset visual system with dark futuristic Holographic Ring direction.
- Removed dashboard mockup, bottom logo bar, duplicate auth-card logo, and unsupported SSO-style visual clutter.
- Refined the auth hero visual to use `public/holographic-ring.webp` as the central image asset with green glow, dark edge masking, reduced red/magenta artifacts, and subtle particle/pulse motion.
- Fixed holographic asset integration so the hero visual blends as a light layer instead of rendering as a rectangular image block.
- Adjusted login layout hierarchy so hero copy is lighter and the holographic ring becomes the primary visual focal point.
- Enlarged the login holographic visual to better match the reference image proportion.
- Doubled the login holographic visual scale for a stronger command-center focal point.
- Landing login page refined with final holographic motion and updated brand logo asset.
- Cleaned up login holographic motion layers to remove heavy filled glow disks and keep only lightweight orbit, scan, beam, and particle effects.
- Removed fan/turbine-like rotating holographic layers so the login portal reads as a mostly static premium asset with subtle life.

### UI
- Replaced the sidebar brand icon with the new `public/logo-icon.jpg` asset while preserving FeedX wordmark, subtitle, spacing, and layout.

### Inventory Control
- Hid inactive inventory items from Par Levels, Stock Check item generation, Purchase Order item selectors, Inventory Movement selectors, Wastage selectors, and Recipe ingredient selectors while preserving inactive item visibility in Master Inventory for historical reference and reactivation.
- Fixed fresh Production empty-state handling so fetched UOMs and categories remain visible even when inventory items and stock check groups are empty.
- Added a friendly duplicate UOM code error message for Supabase `inventory_uoms_code_key` conflicts.

## 2026-06-03

### Factory
- Added Restaurant / Factory workspace switching to the shared FeedX shell.
- Registered Factory sidebar modules, route metadata, permissions, and audit scopes through the central module registry.
- Added Factory Phase 1A Supabase foundation for dashboard, job orders, raw materials, raw material receiving, raw material movements, finished goods, production, recipes, stock checks, SOP, RLS policies, and permissions.
- Implemented Phase 1A working UI for Factory Dashboard, Job Orders CRUD, and Raw Material Receiving CRUD.

### Documentation
- Updated the master document with Factory workspace architecture, Phase 1A scope, Factory tables, RLS approach, and current exclusions.

## 2026-06-04

### Factory
- Added Factory Phase 1B production execution workflow from Job Orders.
- Production completion now records batch/date/operator/times, actual produced quantity, good output, wastage, QC status, material usage, variance, raw material deductions, finished goods stock-in, product stock movement, and job order completion.
- Added production dashboard/activity updates and Production Records UI.
- Added Factory Phase 1C raw material and finished goods stock check workflows with Draft, Submitted, and Approved statuses.
- Stock check records now capture system quantity, physical count, variance quantity, variance percent, Normal/Warning/Critical variance status, and required reasons for Warning/Critical rows.
- Only approved stock checks apply inventory balance adjustments and create raw material or finished goods movement logs.
- Added dashboard stock check variance alerts and recent submitted/approved stock check activity.
- Added Factory Phase 1D Production SOP management with product SOP versions, process steps, control points, materials, equipment, estimated time, and QC checkpoint flags.
- Production completion can now reference the SOP version used and raw material lots used by actual material usage rows.
- Added production QC checkpoint snapshots separate from stock checks and a Batch Traceability view connecting batch, product, job order, production date, operator, raw material lots, finished goods stock-in, SOP and QC status.
- Added dashboard quick alerts for batches with Pending, Hold, or Failed QC status.
- Hardened Factory UAT readiness by making Factory data loading tab-scoped and permission-aware, adding scoped access warnings for optional blocked datasets, and gating Factory action buttons by existing permissions.
- Added Factory Phase 1E read-only Factory Reports and production analytics foundation.
- Factory Reports now includes Production Summary, Raw Material Usage, Recipe Standard vs Actual Usage, Production Yield, and Finished Goods Stock Movement reports.
- Added actual-usage costing calculations for raw material usage cost, cost per batch, and cost per finished unit using recorded/latest receiving unit cost where available.
- Added dashboard analytics cards for Production Yield %, Material Variance %, Estimated Production Cost, and Top Variance Raw Materials.
- Fixed Factory UAT blocker by exposing Batch Traceability as its own reachable Factory sidebar module and route (`factory_batch_traceability`) with dedicated view/export permissions.
- Added Batch Traceability RLS coverage for production, job order, material usage, QC checkpoint, and finished goods movement read data.
- Clarified Factory report costing/variance wording so RM0 cost-source gaps and mixed-UOM variance interpretation are visible to users.
- Added Factory Phase 1F recipe costing and raw material cost history foundation.
- Added read-only standard recipe cost rollup using recipe item quantities, wastage allowance, and latest raw material receiving cost.
- Added actual production cost comparison against standard recipe reference cost with variance RM and variance %.
- Added raw material cost trend reporting from receiving records, including supplier/date/unit cost movement.
- Added dashboard cost cards for highest cost increase material, most expensive product recipe, and actual-vs-standard cost variance.
- Added read-only RLS coverage for Factory Reports/Dashboard to load recipe and receiving cost source rows without granting mutation rights.
- Fixed Factory Owner/Admin RLS permission mismatch by hardening `current_user_has_permission()` protected-role bypass for both employees-linked and legacy user profile identities.
- Updated Factory Owner/Admin permission seeding to use case-insensitive role name matching for all `factory_%` permission codes.
- Turned Factory Finished Goods into a read-only warehouse management page with SKU listing, stock KPIs, filters, production/movement/batch detail and clear production-first empty states.
- Turned Factory Product Movements into a read-only movement history page showing movement type, product, quantity, batch/source context and movement date.
- Added read-only warehouse RLS coverage so Finished Goods and Product Movements users can load production headers for last production date and batch history.
- Upgraded Factory Finished Goods into a master-plus-warehouse page with Finished Goods product create/edit/archive, category create/edit/archive, SKU/UOM/min-stock/status/remarks fields, live balance context, and product detail history.
- Added Finished Good category persistence and RLS through `factory_finished_good_categories`.
- Updated production completion so finished goods stock-in requires an existing active Finished Goods master product instead of auto-creating a stock record during production.
- Refined Factory Finished Goods UX by moving category management into the Category modal, adding EN/CN/BM product names, requiring searchable category selection, removing the page refresh action, blocking archive when stock balance is above zero, and adding warehouse insight panels for stock distribution, top produced products, movement trend, batch summary and days coverage.

### Documentation
- Updated the master document with Factory Phase 1B execution rules, variance threshold, actual-usage stock deduction rule, Recipe BOM separation, Phase 1C stock check approval rules, Phase 1D SOP/QC/batch traceability rules, Phase 1E reports/costing rules, Phase 1F recipe costing/cost history rules, Finished Goods Master and warehouse visibility/UX rules, the Batch Traceability route/RBAC UAT fix, Owner/Admin Factory RLS alignment, and functional-vs-placeholder Factory module status.

## 2026-06-05

### Factory
- Linked Factory Job Orders to active Finished Goods Master products through `finished_good_id`, replacing free-text product planning for new job orders.
- Updated Job Orders UX with Finished Good searchable selection, planning KPI cards, requested planning columns, locked completed/cancelled edit behavior, and active Finished Good validation.
- Updated Production Records so ready jobs are limited to planned/in-progress Job Orders and completion starts from the selected Job Order with Finished Good, target quantity, UOM, recipe and SOP references auto-filled where available.
- Hardened production completion so finished goods stock-in uses the selected active Finished Goods master product, creates the production/material/movement records, updates the Job Order to completed, and preserves batch traceability.
- Completed Factory Product Recipes with Finished Good-linked recipe management, draft/active/archived lifecycle, BOM material rows, one-active-recipe guardrails, and recipe activation/archive actions.
- Production completion now prefills material usage from the active Finished Good recipe where available, scaling standard usage by job target quantity while leaving actual usage editable for stock deduction and variance tracking.
- Completed Factory Raw Material Inventory as a master-plus-inventory page with Raw Material create/edit/archive, category create/edit/archive, multilingual EN/CN/BM names, code, default UOM, min stock, preferred supplier, storage location, status and remarks.
- Updated Raw Material Receiving so stock-in must select an active Raw Material Master record instead of using free-text material creation; UOM and storage location default from the selected material where available.
- Added Raw Material Inventory KPIs, filters, low-stock/recent-receiving/recent-consumption panels, recipe-based can-produce estimates and raw material detail history for receiving, consumption, stock checks and cost trend.
- Added Factory Raw Material category persistence/RLS through `factory_raw_material_categories` and extended raw material RLS coverage for inventory, receiving, movements, stock checks, product recipes and production usage.

### RBAC
- Added explicit `sales_input.import` and `purchase_input.import` permissions so Sales Input and Purchase Input imports can be enabled independently from create/edit access.
- Updated import workflow permission checks and `import_batches` / `import_batch_rows` RLS coverage so module imports require the owning module import permission, while preserving Owner/Admin protected-role behavior.
- Added Recipe Intelligence `view` and `manage` permissions, routed Recipe Intelligence through its own view permission, and guarded Product Mapping decisions with Recipe Intelligence manage access.
- Improved the Role Management permission matrix scrolling so action headers remain visible while reviewing long permission tables.
- Fixed Purchase Import unknown-supplier review so the selected default category for a newly created supplier resolves blank-category purchase rows during preview and final import rebuild.
- Added a follow-up Sales/Purchase import RLS migration after confirming staging still has `202606050001` pending; Sales import batch writes require `sales_input.import`, and Purchase import batch writes require `purchase_input.import`.
- Fixed Sales Import history row display so View Imported Rows shows normalized sales channel names and matching channel amounts instead of reading uploaded amount columns as channel labels.
- Scoped embedded Purchase Import to the Purchase Input selected outlet, added target-outlet validation and banner copy, kept month/year file-derived for multi-month imports, and filtered recent import history by selected outlet across months.
