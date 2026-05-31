# FeedX Recipe Module Audit

Date: 2026-05-31

## Scope

Audit coverage:
- Recipe Setup
- Recipe Storage
- Recipe Intelligence
- Product Analytics mapping readiness

## Executive Summary

Result: Conditional Pass

The Recipes & Usage module is functionally aligned with the new naming architecture (`recipe_code`, `recipe_name_en`, `recipe_name_cn`) and Supabase-backed recipe/ingredient persistence. The active staging schema still contains the original `inventory_recipes.recipe_name text not null` dependency, so the application must continue mirroring `recipe_name = recipe_name_en` until a final database cleanup migration removes or relaxes that legacy column.

Recipe Intelligence is structurally ready for Product Analytics mapping through `product_recipe_mappings`, but should not be treated as production decision support until a mapping management UI and at least 10 mapped recipes exist.

## 1. Database Schema

Table: `inventory_recipes`

Observed from migrations:

| Column | Current Role | Dependency |
| --- | --- | --- |
| `recipe_code` | Canonical recipe identity | Required, lower-case unique index |
| `recipe_name` | Legacy compatibility field | Still `text not null` from original schema |
| `recipe_name_en` | Canonical English recipe name | Required by current UI |
| `recipe_name_cn` | Canonical Chinese recipe name | Required by current UI |
| `selling_price` | Commercial pricing | Used for profit and margin |
| `recipe_photo_url` | Display photo | Optional |
| `outlet_id` | Outlet-scoped recipe ownership | Required by current workflow |

Actual dependency:
- `recipe_name` remains a database-level dependency because the original table created it as `text not null`.
- Current application writes `recipe_name = recipe_name_en` as a temporary compatibility bridge.

Final architecture:
- Canonical identity fields are `recipe_code`, `recipe_name_en`, and `recipe_name_cn`.
- `recipe_name` should remain only as a migration/read fallback until the final schema cleanup removes the NOT NULL requirement or drops the column after data migration.

## 2. Create/Edit Recipe Flow

Validation now expected before save:

| Rule | Status |
| --- | --- |
| `recipe_code` required | Pass |
| `recipe_code` duplicate check | Pass, checked against loaded recipes on blur and blocked before save |
| `recipe_name_en` required | Pass |
| `recipe_name_cn` required | Pass |
| `selling_price > 0` | Pass |
| At least 1 ingredient | Pass |
| Ingredient item required | Pass |
| Ingredient quantity > 0 | Pass |

Remaining hardening:
- Add server-side duplicate-code error translation to the exact UI message if the unique index rejects a race condition.
- Add a final schema migration to remove the legacy `recipe_name` NOT NULL dependency once staging data has been verified.

## 3. Costing Logic

Current formulas:
- Ingredient line base cost = `Qty Used × inventory_items.cost`
- Wastage cost = base cost × `Wastage %`
- Total recipe cost = ingredient base cost + wastage cost
- Profit = selling price - total recipe cost
- Margin % = `((Selling Price - Total Recipe Cost) / Selling Price) × 100`

Status:
- Recipe Cost, Profit, and Margin % update live in the Add/Edit Recipe modal.
- Empty ingredient states are handled with an empty state and Save remains disabled.
- Ingredient cost depends on `inventory_items.cost`; recipes with items missing cost will calculate those ingredients as RM0 until costs are configured.

## 4. Outlet Architecture

Current behavior:
- Recipes are outlet-linked through `inventory_recipes.outlet_id`.
- Add Recipe inherits the selected Recipes & Usage outlet.
- Ingredient selector only shows inventory items linked to the selected outlet.

Recommendation:
- Keep recipes outlet-linked for MVP and Recipe Intelligence Phase 1.

Reason:
- Ingredient availability is outlet-specific.
- Inventory item cost and supplier configuration can vary by outlet.
- Operational menu setup is currently managed at outlet level.

Future option:
- Add a master recipe/template layer later if HQ needs one canonical recipe that can be deployed to multiple outlets with outlet-level overrides.

## 5. Product Mapping Readiness

Current matching foundation:
- `product_recipe_mappings` connects Product Analytics product names to recipes.
- Matching priority remains:
  1. `recipe_code`
  2. `recipe_name_en`
  3. `recipe_name_cn`

Status:
- `recipe_code`, `recipe_name_en`, and `recipe_name_cn` are sufficient for Product Analytics mapping.
- Explicit mapping UI now exists in the Recipes & Usage Product Mapping tab.
- Mapping decisions support Pending, Mapped, and Ignored states.
- Ignored products persist in `product_recipe_mappings` with `status = ignored`, `recipe_id = null`, ignored metadata, and are excluded from coverage denominator and Recipe Intelligence.
- Coverage is calculated as Mapped / (Mapped + Pending), so intentional ignored POS items do not penalize mapping health.
- Recipe Intelligence now focuses on profit and ingredient planning instead of repeated margin/revenue cards:
  - Recipe Gross Profit Trend
  - Top Gross Profit Recipes
  - Ingredient Demand Forecast
  - Top 10 Ingredient Consumption - Monthly
  - Ingredient Consumption Trend - Monthly
- Ingredient analytics use mapped Product Analytics sales only. Pending products are excluded but flagged as mapping risk; Ignored products are excluded completely.
- Future notification hook: Product Analytics imports that introduce new Pending products should trigger a Notification Center task such as `Recipe mapping required`.

## 6. View Recipe Consistency

Current standard:
- Recipe BOM table uses `recipe_code` first, English name as primary, Chinese name as secondary.
- Recipe detail uses English name as primary and Chinese name as secondary for consistency.

## P0 Issues

| Issue | Status | Notes |
| --- | --- | --- |
| Create recipe fails because legacy `recipe_name` is NOT NULL | Fixed | App now mirrors `recipe_name = recipe_name_en` on create/update |
| Recipe code duplicate discovered only after Supabase error | Fixed | Inline duplicate check added on blur and rechecked before submit |
| Unique recipe create showed false duplicate error after save | Fixed in code | Root cause was post-save list refresh self-match before modal unmounted; duplicate validation is suppressed during save/close |
| Selling price allowed as blank/zero | Fixed | Selling price must be greater than 0 |

## Recipe Create Success UAT

Date: 2026-05-31

Status: Pass

Browser:
- Authenticated in-app browser at `http://127.0.0.1:5173/#inventory_recipes`.

Verified:
- Add Recipe opens correctly.
- Add Ingredient no longer shows `Qty must be greater than 0` immediately on a fresh row.
- Unique recipe code `UATTRY002` created successfully with no duplicate error flash; success toast appeared, modal closed, and the recipe appeared in the table.
- Existing recipe code `UATTRY002` was blocked; duplicate error appeared, modal stayed open, no success toast appeared, and no duplicate recipe was created.
- Rapid code entry `UATRAPID312` followed immediately by Save created successfully with no stale duplicate error after success.

Result:
- Recipe duplicate-code validation race is verified fixed in browser UAT.

## P1 Issues

| Issue | Recommendation |
| --- | --- |
| Legacy `recipe_name` still exists as NOT NULL | Add final schema migration after verifying all existing rows have `recipe_name_en` |
| Recipe detail title/name hierarchy needs full consistency review | Remediated for Recipe Detail modal; continue checking any future recipe surfaces |
| Mapping management is not yet operator-editable | Build Product ↔ Recipe Mapping UI before promoting intelligence decisions |
| Server-side race duplicate code could still occur | Translate unique-index errors into `Recipe code already exists.` |

## P2 Issues

| Issue | Recommendation |
| --- | --- |
| Master recipe architecture not present | Keep outlet recipes now; evaluate HQ recipe templates later |
| Ingredient costs rely on default item cost | Later support outlet-specific cost or weighted purchase cost |
| Recipe Intelligence chart confidence | Keep matrix hidden until at least 10 mapped recipes |

## Rollout Recommendation

Proceed with Recipe Setup and Costing Dashboard after UAT confirms recipe create/edit works on staging.

Do not promote Menu Engineering Matrix as production decision support until:
- Product mapping UI exists.
- At least 10 mapped recipes are configured.
- Product Analytics sales data is verified for the selected period.
