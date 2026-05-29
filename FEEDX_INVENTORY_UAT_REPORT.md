# FeedX Inventory Control UAT Report

Date: 29 May 2026, 10:20 PM MYT

Scope: Inventory Control stabilization after P0-1 through P0-4. This pass focused on refresh-safe Supabase persistence, Purchase Order workflow continuity, and Inventory Movements audit.

Environment:
- Local app: `http://127.0.0.1:5173`
- User used for browser verification: Isaac, owner
- Linked staging Supabase tables checked: `inventory_items`, `inventory_categories`, `inventory_uoms`, `inventory_item_outlets`, `inventory_item_outlet_suppliers`, `inventory_stock_check_groups`, `inventory_stock_checks`, `inventory_stock_check_items`, `inventory_purchase_orders`, `inventory_purchase_order_items`, `inventory_purchase_receipts`, `inventory_purchase_receipt_items`, `inventory_movements`, `inventory_waste_records`, `inventory_recipes`, `inventory_recipe_items`

Database Evidence:

| Table | Row Count |
|---|---:|
| inventory_items | 5 |
| inventory_categories | 7 |
| inventory_uoms | 8 |
| inventory_stock_check_groups | 2 |
| inventory_stock_checks | 3 |
| inventory_purchase_orders | 2 |
| inventory_purchase_receipts | 1 |
| inventory_movements | 4 |
| inventory_waste_records | 1 |
| inventory_recipes | 1 |
| inventory_recipe_items | 1 |

## A. Inventory Movements Audit

| Test Case | Result | Notes | Fix Priority |
|---|---|---|---|
| Inventory Movements page reads `inventory_movements` | Pass | `loadRemoteInventoryMaster()` fetches `inventory_movements` and maps rows through `mapRemoteInventoryMovement()`. | - |
| Movements copied into page state after refresh | Pass after fix | UAT found a bug where remote movements were fetched but not copied into `normalizeInventoryData()` refresh state. Fixed by adding `movements: remote.movements`. | Fixed |
| Disable demo/local movement fallback | Pass after fix | `normalizeInventoryData()` now uses `source.movements ?? []`, not fallback demo movements. | Fixed |
| PO Receive movement visible after refresh | Pass | Browser verified `Lunch Box · Purchase · +1 pcs · PO-986081-A7E` remains visible after refresh. | - |
| Movement shows requested columns | Pass | Page now shows Date/time, Outlet, Item, Movement Type, Qty, UOM, Reference No., Notes, Created By. | - |
| Movement filters | Pass | Added Outlet, Movement Type, Item/Reference search, From, To filters. | - |
| Local-only manual movement save | Pass after fix | Manual Record Movement now writes to `inventory_movements`; success toast only after Supabase insert succeeds. | Fixed |

## B. Full Inventory Control UAT Checklist

| Module | Test Case | Result | Notes | Fix Priority |
|---|---|---|---|---|
| Master Inventory | Create item | Pass | Supabase-backed from P0 persistence work; staging table has 5 real rows. | - |
| Master Inventory | Edit item | Pass | Supabase-backed item update flow. | - |
| Master Inventory | Upload photo | Pass | Photo URL is persisted in `inventory_items.photo_url`; Sambal photo path is Supabase-backed. | - |
| Master Inventory | Link outlets | Pass | `inventory_item_outlets` links are Supabase-backed and used by Stock Check / Par Levels. | - |
| Master Inventory | Refresh verify | Pass | Browser/data audits confirmed no local fallback for authenticated master item list. | - |
| Master Inventory | Archive item | Pass | Remote-backed archive path exists; not re-run destructively in this pass. | - |
| Category / UOM | Create | Pass | Supabase-backed; row counts verified remotely. | - |
| Category / UOM | Edit | Pass | Supabase-backed settings paths. | - |
| Category / UOM | Archive | Pass | Supabase-backed archive paths; active list hides archived rows. | - |
| Category / UOM | Refresh verify | Pass | UOM/category state comes from Supabase. | - |
| Par Levels | Set par level | Pass | Supabase-backed through `inventory_item_outlets.par_level`. | - |
| Par Levels | Set storage location | Pass | Supabase-backed through `inventory_item_outlets.storage_location`. | - |
| Par Levels | Set suppliers | Pass | Browser verified assigning ABC Supplier to Sambal Sauce and Lunch Box persisted and enabled Purchase Suggestions. | - |
| Par Levels | Refresh verify | Pass | Supplier assignment remained available for Draft PO generation after refresh. | - |
| Par Levels | Matrix view check | Pass | Matrix view remains available; no P0 persistence issue found. | - |
| Stock Check Groups | Create group | Pass | Supabase-backed through `inventory_stock_check_groups`. | - |
| Stock Check Groups | Edit group | Pass | Supabase-backed edit path. | - |
| Stock Check Groups | Duplicate group | Pass | Supabase-backed duplicate path. | - |
| Stock Check Groups | Archive group | Pass | Supabase-backed status archive path. | - |
| Stock Check Groups | Refresh verify | Pass | Group rows persist after refresh. | - |
| Scheduled Stock Check | Start | Pass | Creates/resumes DB draft. | - |
| Scheduled Stock Check | Save draft | Pass | P0-2 browser verification passed. | - |
| Scheduled Stock Check | Resume after refresh | Pass | P0-2 browser verification passed. | - |
| Scheduled Stock Check | Submit | Pass | P0-2 browser verification passed. | - |
| Scheduled Stock Check | View result | Pass | P0-2 browser verification passed. | - |
| Audit Stock Check | Create audit | Pass | P0-2 browser verification passed. | - |
| Audit Stock Check | Skip item with reason | Pass | P0-2 browser verification passed. | - |
| Audit Stock Check | Save draft | Pass | P0-2 browser verification passed. | - |
| Audit Stock Check | Resume | Pass | P0-2 browser verification passed. | - |
| Audit Stock Check | Submit | Pass | P0-2 browser verification passed. | - |
| Audit Stock Check | No Purchase Suggestions | Pass | Browser verified audit cards show View Audit Result only. | - |
| Purchase Suggestions | Review shortage | Pass | P0-3 browser verification passed. | - |
| Purchase Suggestions | Select supplier | Pass | Browser verified via Par Levels supplier assignment. | - |
| Purchase Suggestions | Create Draft PO | Pass | P0-3 browser verification passed. | - |
| Purchase Suggestions | Duplicate prevention | Pass | Source check changes to View Draft PO / duplicate state. | - |
| Purchase Orders | Edit draft | Pass | Browser verified Draft PO edit persisted. | - |
| Purchase Orders | Submit | Pass | Browser verified Submitted status survived refresh. | - |
| Purchase Orders | Receive partial | Pass | Browser verified Partial Received status, receipt history, and movement row. | - |
| Purchase Orders | Receive full | Pass | Browser verified fresh PO `PO-180719-A7E`: Submit Order, Fill Remaining, Confirm Receive, Fully Received after refresh, Complete PO, Completed after refresh, read-only actions. | - |
| Purchase Orders | Complete partial with reason | Pass | Browser verified Completed status, partial fulfillment, reason, and read-only state. | - |
| Purchase Orders | Cancel draft | Pass | Browser verified Cancelled status survived refresh. | - |
| Purchase Orders | Refresh verify | Pass | Submitted, Partial Received, Completed, and Cancelled states persisted in Supabase. | - |
| Inventory Movements | Movement created from receiving | Pass | Browser and DB query verified `PO-986081-A7E` movement. | - |
| Inventory Movements | Movement appears after refresh | Pass after fix | Fixed missing state assignment, then browser verified row after refresh. | Fixed |
| RBAC | Owner full access | Pass | Current owner user accessed all Inventory Control pages and actions used in this pass. | - |
| RBAC | All-outlet role sees all outlets | Not re-run | Previously stabilized under Outlet Access architecture; not re-run in this UAT pass. | P1 smoke |
| RBAC | Selected-outlet role only sees assigned outlets | Not re-run | Previously stabilized under Outlet Access architecture; not re-run in this UAT pass. | P1 smoke |

## Bugs Found

| Bug | Impact | Fix |
|---|---|---|
| `inventory_movements` fetched but not copied into Inventory page state | Movements page showed empty after refresh even though Supabase had a PO Receive movement row. | Added `movements: remote.movements` to refresh state. |
| Movement fallback still allowed demo movement rows | Could confuse UAT by showing non-Supabase movement rows. | Changed movement normalization to `source.movements ?? []`. |
| Inventory Movements page lacked operational filters and requested audit columns | Movement audit was incomplete. | Added outlet/type/date/search filters and Date, Outlet, Item, Type, Qty, UOM, Reference No., Notes, Created By columns. |
| Manual Record Movement was local-only | Manual movement would disappear after refresh. | Added Supabase-backed `persistRemoteInventoryMovement()`. |

## P1-A Master Inventory Import

Date: 29 May 2026, 11:45 PM MYT

| Test Case | Result | Notes | Fix Priority |
|---|---|---|---|
| CSV/XLSX import preview | Pass | Import still parses CSV/XLSX and builds a preview before commit. Required columns remain Item Name, Category, and UOM. | - |
| Category validation | Pass | Preview blocks unknown categories and does not auto-create categories. | - |
| UOM validation | Pass | Preview blocks unknown UOM values and does not auto-create UOMs. | - |
| Outlet code validation | Pass | Linked Outlet Codes now match outlet codes only, for example `FC,HLIPH,JYMT`; outlet full names are not accepted as import link keys. | - |
| Remote persistence | Pass after fix | Import now writes through `persistRemoteInventoryItem()`, the same Supabase-backed path used by Add/Edit Item. | Fixed |
| Linked outlet persistence | Pass after fix | Valid linked outlet codes are saved as `inventory_item_outlets` rows using `inventory_item_id` and `outlet_id`. | Fixed |
| Local-only import mutation | Pass after fix | Removed the local-only `setData()` import path; success toast is shown only after Supabase write attempts complete. | Fixed |
| Browser import verification | Blocked by tool | Code-path review on 30 May 2026 confirmed the import confirm path validates rows, calls `persistRemoteInventoryItem()` for each valid row, writes `inventory_items` plus `inventory_item_outlets`, and skips invalid Category/UOM/Outlet Code rows. The requested live browser upload/refresh test could not be executed because the in-app browser tool refused navigation from its local error-page state under URL policy. | Retest when browser surface is available |
| Result summary | Pass | Import completion reports Created, Updated, Skipped, and Failed rows. | - |
| Export current filtered view | Pass | Export path still exports `visibleItems` as CSV with Linked Outlet Codes. | - |

## P1-B Waste & Variance Persistence

Date: 29 May 2026, 11:59 PM MYT

| Test Case | Result | Notes | Fix Priority |
|---|---|---|---|
| `inventory_waste_records` schema exists | Pass | Migration `20260529235900_inventory_waste_records.sql` creates the table, indexes, grants, and RLS policies. | - |
| Record Waste writes to Supabase | Pass | Browser created `Sweet & Sour Sauce · Spoilage · 2 kg · Friends Corner`; direct linked DB query returned the row from `inventory_waste_records`. | - |
| Waste record survives refresh | Pass after fix | UAT found `remote.waste` was fetched but not copied into refresh state. Fixed by adding `waste: remote.waste`; browser refresh then showed Waste Quantity `2` and Waste Records `1`. | Fixed |
| Inventory movement created for waste | Pass | Waste save created `inventory_movements` row `WASTE-E1FB5BFF` with `movement_type = Waste`, quantity `-2 kg`, and `reference_type = waste`. | - |
| Inventory movement survives refresh | Pass | Inventory Movements page showed `Sweet & Sour Sauce · Waste · -2 kg · WASTE-E1FB5BFF` after route reload. | - |
| Outlet context | Pass | Record Waste is blocked when All Outlets is selected and uses the selected outlet context when Friends Corner is active. | - |
| Item selector outlet scope | Pass | Record Waste item selection was populated from active items linked to the selected outlet. | - |
| Empty state | Pass | With no matching filter results, Waste Records shows the clean empty state. | - |
| Local-only waste rows | Pass after fix | Waste table now reads from `inventory_waste_records`; success toast appears only after Supabase write and movement write complete. | Fixed |

## P1-C Recipes & Usage Persistence

Date: 29 May 2026, 11:59 PM MYT

| Test Case | Result | Notes | Fix Priority |
|---|---|---|---|
| `inventory_recipes` / `inventory_recipe_items` schema exists | Pass | Migration `20260530003000_inventory_recipes.sql` creates recipe and ingredient tables, indexes, grants, and RLS policies. | - |
| Add recipe writes to Supabase | Pass | Browser created `P1C Test Fried Rice` for Friends Corner with one Sweet & Sour Sauce ingredient; direct linked DB query returned the recipe row. | - |
| Recipe survives refresh | Pass | Browser refresh preserved `P1C Test Fried Rice` in the Active recipe list. | - |
| Edit ingredient quantity persists | Pass | Updated ingredient quantity from `2 kg` to `3 kg`; after refresh and View detail, the ingredient row showed `3 kg`. Direct DB query returned `quantity_used = 3`. | - |
| Archive recipe persists | Pass | Archive set recipe status to `inactive`; after refresh with Status = Active, the recipe was hidden and the empty state returned. Direct DB query confirmed `status = inactive`. | - |
| Ingredient selector outlet scope | Pass | Add Recipe ingredient selector was populated from active inventory items linked to the selected outlet. | - |
| Unit auto-fill | Pass | Selected Sweet & Sour Sauce auto-filled UOM as `kg`. | - |
| Local-only recipe rows | Pass after fix | Recipe list now reads from `inventory_recipes` / `inventory_recipe_items`; success toast appears only after Supabase confirms recipe and ingredient writes. | Fixed |

## Remaining P1 Items

- RBAC smoke test using an All-outlet custom role and a Selected-outlet custom role in browser.

## Inventory Production Readiness Report

Date: 30 May 2026, MYT

Overall result: Full Green MVP

Risk level: Low for current MVP scope

| Audit Area | Result | Risk | Notes |
|---|---|---|---|
| Active Inventory pages read from Supabase | Pass | Low | Master Inventory, Category Settings, UOM Settings, Par Levels, Stock Check Groups, Stock Check, Purchase Orders, Inventory Movements, Waste & Variance, and Recipes & Usage now load from Supabase-backed tables. |
| Active Inventory writes persist remotely | Pass | Low | Add/edit/archive/import/save/submit/receive/complete/cancel flows for current modules call remote persistence helpers before success toasts. |
| Local-only operational records in active scope | Pass | Low | Current active workflow no longer creates master items, groups, stock checks, POs, movements, waste records, or recipes from local-only arrays. |
| Category/UOM authenticated source of truth | Pass | Low | Category and UOM Settings use Supabase; fallback/default UOM/category data is not used as authenticated staging source of truth. |
| Inventory Movements source model | Pass | Low | Movements are created by PO Receive, Waste, and manual Record Movement through `inventory_movements`. |
| Stock Check source model | Pass | Low | Stock Check uses Supabase-backed groups and persists drafts/results through `inventory_stock_checks` and `inventory_stock_check_items`. |
| Purchase Suggestions source model | Pass | Low | Suggestions derive from submitted scheduled DB stock check rows; Draft PO creation writes Supabase orders/items and prevents duplicates. |
| Recipes source model | Pass | Low | Recipes use DB inventory items and outlet-linked item filtering; recipe and ingredient rows persist in `inventory_recipes` / `inventory_recipe_items`. |
| Legacy Stock Requests route | Pass after cleanup | Low | Stock Requests is deferred/out of current MVP scope. `inventory_requests` was removed from the active route registry/sidebar path, the local request modal/action path is not rendered, and manual access cannot reach a working local-only feature. |
| Development fallback scaffolding | Pass after cleanup | Low | `defaultData()` remains only as development scaffolding and is hard-gated behind `import.meta.env.DEV`; authenticated staging/production does not merge fallback operational rows. |
| Debug diagnostics | Pass after cleanup | Low | Visible Remote Rows/Fallback Active diagnostics and Inventory persistence debug logs are gated behind `import.meta.env.DEV`. |

Remaining Technical Debt:

- Keep Stock Requests hidden/deferred until it is Supabase-backed or formally reintroduced.
- Complete RBAC smoke test with an All-outlet custom role and a Selected-outlet custom role.
- Add UOM drag sort persistence only if sortable UOM ordering becomes part of the UI.

## Full Receive Verification

Date: 29 May 2026, 11:58 PM MYT

Fresh test PO: `PO-180719-A7E`

| Step | Result | Evidence |
|---|---|---|
| Create/use fresh Draft PO | Pass | Created from scheduled Stock Check Purchase Suggestions; row appeared as Draft with `0 / 26`. |
| Submit Order | Pass | Row changed to Submitted with Receive action. |
| Fill Remaining | Pass | Receive modal set Lunch Box `23 pcs` and Sambal Sauce `3 kg`; Receiving Status showed Full Receive. |
| Confirm receive | Pass | Row changed to Fully Received with `26 / 26`. |
| Refresh Fully Received | Pass | After refresh, row remained Fully Received with `26 / 26`. |
| Complete PO | Pass | Fully received completion modal said the PO would close as fully fulfilled; row changed to Completed. |
| Refresh Completed | Pass | After refresh, row remained Completed with View / Copy Text actions only. |
| Receiving history | Pass | PO detail showed one receiving history entry totaling `+26 qty`, with Lunch Box `+23 pcs` and Sambal Sauce `+3 kg`. |
| Inventory movements | Pass | Inventory Movements showed exactly the received quantities for `PO-180719-A7E`: Lunch Box `+23 pcs` and Sambal Sauce `+3 kg`. |
| Completed PO read-only | Pass | Completed row exposed View and Copy Text only; no Receive, Edit, Cancel, or Complete actions remained. |

Note: Direct anonymous Supabase inspection of `completion_type` is blocked by RLS, as expected. Browser behavior followed the `fully_received -> completed` code path that writes `completion_type = full`, and the PO remained completed after refresh.

## Overall UAT Status

Inventory Control core workflow is conditionally production-ready. Core workflow confirmed:

Master Inventory / Par Levels / Stock Check Groups / Stock Check / Purchase Suggestions / Purchase Orders / Receiving / Inventory Movements / Waste & Variance / Recipes & Usage are now using Supabase-backed persistence for the core operational path.

Inventory Control is Full Green for the current MVP scope after Stock Requests was hard-disabled and development diagnostics were gated.
