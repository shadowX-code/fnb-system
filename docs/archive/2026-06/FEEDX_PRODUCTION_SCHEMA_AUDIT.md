# FeedX Production Schema Audit

Date: 1 June 2026  
Audit type: Read-only production Supabase schema audit  
Production Supabase project: `fnb-system`  
Production project ref: `oyfobxdoyfuzsodogpgs`

## Scope And Safety

Original schema audit was read-only. The approved post-reset cleanup on 1 June 2026 deleted only the three staging-seeded `inventory_items` rows listed below.

Commands not run during the original audit:

- `supabase db push`
- `supabase db reset`
- `truncate`
- `delete`
- `drop`
- Git merge from `dev` to `main`

Current production backup status per operator: confirmed.

Post-reset cleanup command scope:

- Deleted only:
  - Sambal Sauce / `RAW-SAM-001`
  - Takeaway Cup 12oz / `PKG-CUP-012`
  - Frozen Chicken Cut / `FRZ-CHK-001`
- No roles, permissions, role permissions, UOM defaults, inventory categories, menu categories, or storage buckets were deleted.

## Executive Summary

Original recommendation: **Reset production database, then apply the finalized migration set, with controlled production-only seed data.**

Post-reset status on 1 June 2026: **reset completed successfully**.

Reason:

- Production is linked correctly to `fnb-system` / `oyfobxdoyfuzsodogpgs`.
- Production contains a partial/legacy schema with real rows.
- Production remote migration history is effectively empty for the 67 local migrations.
- Production public schema is missing the current staging application tables for Inventory Control, Asset Tracking, Product Analytics, Duty Roster, Recipes, Recipe Intelligence, and several People/auth fields.
- Production Storage has no buckets.
- Incrementally pushing all local migrations onto this partial schema is high risk because early migrations create/alter tables that already partially exist in production but are not recorded in `supabase_migrations`.

Preferred path:

1. Keep the confirmed backup.
2. Export any production data that must be preserved.
3. Reset/clean production schema during an approved maintenance window.
4. Apply migrations from the finalized repo.
5. Seed only approved system defaults.
6. Re-import approved production business data if needed.

Post-reset cleanup update:

- `supabase db reset --linked --yes` was executed against production project ref `oyfobxdoyfuzsodogpgs`.
- `supabase migration list` confirmed remote/local parity: 67 local migrations and 67 remote migrations.
- The reset did not run `supabase/seed.sql`; no such seed file matched.
- The migration set created three staging/demo inventory rows through `20260529175237_seed_inventory_master_staging.sql`.
- Those rows were verified as test data, not system defaults, and were deleted from production:
  - Sambal Sauce / `RAW-SAM-001`
  - Takeaway Cup 12oz / `PKG-CUP-012`
  - Frozen Chicken Cut / `FRZ-CHK-001`
- Dependent item outlet links and operational child rows were checked and were already zero.
- Production `inventory_items` count is now `0`.
- Roles, permissions, role permissions, inventory UOMs, inventory categories, inventory menu categories, and storage buckets were retained.

Current recommendation after cleanup: **continue with production environment verification and production UAT before merging `dev` to `main` or deploying production**.

## Current Post-Reset Counts

Verified after cleanup on 1 June 2026:

| Table / Resource | Row Count |
|---|---:|
| `auth.users` | 0 |
| `public.employees` | 0 |
| `public.outlets` | 0 |
| `public.roles` | 10 |
| `public.permissions` | 134 |
| `public.role_permissions` | 288 |
| `public.inventory_items` | 0 |
| `public.inventory_uoms` | 8 |
| `public.inventory_categories` | 8 |
| `public.inventory_menu_categories` | 8 |
| `public.sales_records` | 0 |
| `public.purchase_records` | 0 |
| `storage.buckets` | 2 |

Storage buckets now present:

| Bucket | Public |
|---|---:|
| `asset-photos` | true |
| `inventory-item-photos` | true |

## Linked Project Verification

Local Supabase CLI link:

| Field | Value |
|---|---|
| Project name | `fnb-system` |
| Project ref | `oyfobxdoyfuzsodogpgs` |
| Organization slug | `hhtegwoptiyjuzgllkyb` |

Status: **Production linked**

## Existing Production Tables

### Public Schema

Production currently has 23 public base tables:

| Table | Row Count |
|---|---:|
| `public.alerts` | 0 |
| `public.audit_logs` | 128 |
| `public.departments` | 2 |
| `public.employees` | 2 |
| `public.import_batch_rows` | 10 |
| `public.import_batches` | 4 |
| `public.job_positions` | 2 |
| `public.month_locks` | 0 |
| `public.operating_expenses` | 19 |
| `public.outlet_tax_configs` | 1 |
| `public.outlets` | 5 |
| `public.permissions` | 63 |
| `public.purchase_categories` | 12 |
| `public.purchase_records` | 14 |
| `public.role_outlets` | 0 |
| `public.role_permissions` | 156 |
| `public.roles` | 3 |
| `public.sales_channels` | 6 |
| `public.sales_records` | 185 |
| `public.suppliers` | 10 |
| `public.tax_configs` | 0 |
| `public.user_outlets` | 0 |
| `public.user_profiles` | 1 |

### Auth Schema

Auth tables are present.

Auth user count:

| Metric | Count |
|---|---:|
| `auth.users` | 2 |

### Storage Schema

Storage system tables are present.

Storage buckets:

| Bucket | Status |
|---|---|
| Production storage buckets | None found |

Query result: `storage.buckets` returned 0 rows.

## Storage Bucket Gap

Current staging code expects production-ready storage buckets/policies for image workflows.

Expected buckets from the FeedX upload standard:

- `inventory-item-photos`
- `asset-photos`

Potential future/optional bucket depending on final implementation:

- employee photos/avatar bucket, if employee profile images are enabled separately.

Production currently has no buckets, so image upload workflows will fail until buckets and policies are created by migration or setup script.

Affected workflows:

- Master Inventory item photos
- Recipe photos
- Wastage evidence photos
- Asset photos
- Asset maintenance photos
- Asset inspection evidence
- Purchase receiving evidence if enabled through the shared image upload standard

## Remote Migration History Status

`supabase migration list` output showed all 67 local migrations with blank Remote entries.

Observed:

- Local migrations: 67
- Remote migration entries matched to local migrations: 0
- `supabase_migrations` schema table list query returned no rows.

Interpretation:

- Production schema was likely created manually or from an older baseline outside the current migration history.
- The database has tables and data, but the current migration ledger does not recognize local migrations as applied.
- Running `supabase db push --linked` incrementally may attempt to apply early migrations against pre-existing tables and can fail or create inconsistent state.

## Local Migration Inventory

Local migration count: 67

Local migration files:

```text
202605110001_core_dependency_baseline.sql
202605120001_company_user_rbac.sql
202605150001_align_rbac_with_module_registry.sql
202605150002_core_persistence_tables.sql
202605150003_fix_core_persistence_grants_and_guards.sql
202605150004_fix_sales_purchase_outlet_persistence.sql
202605150005_complete_sales_purchase_master_persistence.sql
202605170001_import_batches.sql
202605170002_supplier_contact_fields.sql
202605180001_import_integrity_safety.sql
202605180002_temp_password_access_state.sql
202605180003_normalize_employee_access_state.sql
202605190001_employee_rbac_master_data_rls.sql
202605190002_transaction_records_rls_repair.sql
202605190003_full_rbac_rls_repair.sql
202605190004_employee_auth_onboarding.sql
202605190005_sales_records_unique_channel_period.sql
202605220001_operating_expenses_outlet_pnl.sql
202605230001_duty_roster.sql
202605230002_protected_role_permission_bypass.sql
202605230003_duty_roster_setup_guard.sql
202605230004_duty_roster_settings.sql
202605230005_outlet_duty_roster_overview.sql
202605230006_shift_template_sort_order.sql
202605240001_asset_tracking.sql
202605240002_role_outlet_scope_enforcement.sql
202605240003_outlet_management_scope.sql
202605240004_supplier_outlet_assignments.sql
202605240005_supplier_directory_performance_indexes.sql
202605240006_rollback_supplier_directory_performance_indexes.sql
202605240007_product_analytics.sql
202605250001_asset_tracking_ui_fields.sql
202605250002_asset_inspection_v2.sql
202605250003_asset_inspection_draft_resume.sql
202605250004_asset_condition_simplification.sql
202605250005_asset_inspection_condition_submit_fix.sql
202605250006_asset_category_maintenance_enabled.sql
202605250007_asset_maintenance_records.sql
202605250008_asset_maintenance_v2_fields.sql
202605280001_asset_condition_status_final.sql
202605280002_inventory_outlet_config.sql
202605290001_inventory_child_permission_sync.sql
202605290002_role_management_rls_scope.sql
202605290003_role_outlet_access_type.sql
202605290004_roles_permissions_alias.sql
202605290005_inventory_uoms.sql
20260529175237_seed_inventory_master_staging.sql
20260529180300_cleanup_staging_inventory_master_seed.sql
20260529181500_inventory_item_outlet_link_edit_fix.sql
20260529193000_inventory_stock_check_groups.sql
20260529194500_inventory_stock_check_persistence_fields.sql
20260529203000_inventory_purchase_order_workflow_persistence.sql
20260529235900_inventory_waste_records.sql
20260530003000_inventory_recipes.sql
202605300100_people_employee_outlet_scope.sql
202605300110_inventory_stock_check_checker_identity.sql
20260530014000_asset_import_optional_fields.sql
202605310001_inventory_item_default_cost.sql
202605310002_inventory_recipe_enhancements.sql
202605310003_inventory_recipe_selling_price.sql
202605310004_inventory_waste_evidence_storage_policy.sql
202605310006_asset_inspection_checked_by_employee.sql
202605310007_inventory_recipe_names.sql
202605310008_product_recipe_mappings.sql
202605310009_employee_employment_structure.sql
202605310010_employee_password_setup_completion.sql
202605310011_product_recipe_mapping_status.sql
```

## Comparison Against Local Migrations

### Tables Present In Production

Production has the early/core tables needed for:

- roles/permissions
- employees
- departments/job positions
- outlets
- suppliers
- purchase categories
- sales channels
- sales records
- purchase records
- operating expenses
- import batches
- audit logs
- month locks

### Major Current-App Tables Missing From Production

Based on the current local migration set and app modules, production is missing current tables for:

Inventory Control:

- `inventory_items`
- `inventory_categories`
- `inventory_uoms`
- `inventory_item_outlets`
- `inventory_par_levels`
- `inventory_item_outlet_suppliers`
- `inventory_stock_check_groups`
- `inventory_stock_check_group_categories`
- `inventory_stock_checks`
- `inventory_stock_check_items`
- `inventory_purchase_orders`
- `inventory_purchase_order_items`
- `inventory_purchase_receipts`
- `inventory_purchase_receipt_items`
- `inventory_movements`
- `inventory_waste_records`
- `inventory_recipes`
- `inventory_recipe_items`
- `inventory_menu_categories`

Asset Tracking:

- `asset_items`
- `asset_categories`
- `asset_condition_templates`
- `asset_inspections`
- `asset_inspection_items`
- `asset_inspection_evidence`
- `asset_maintenance_records`
- related asset movement/activity fields/tables from migrations

Duty Roster:

- `duty_roster_shifts`
- `shift_templates`
- `roster_periods`
- `roster_position_groups`
- related duty roster configuration tables

Product Analytics / Recipe Intelligence:

- `product_analytics_reports`
- `product_analytics_items`
- `product_recipe_mappings`

People/Auth Enhancements:

- Some current employee access/employment fields may be missing even though `employees` exists.
- Production has legacy `user_profiles`, indicating older auth/profile architecture is still present.

Storage:

- `inventory-item-photos` bucket missing.
- `asset-photos` bucket missing.

## Data Preservation Notes

Production currently contains existing rows:

- 2 employees
- 2 auth users
- 5 outlets
- 10 suppliers
- 185 sales records
- 14 purchase records
- 19 operating expenses
- 128 audit logs
- 4 import batches / 10 import batch rows
- role/permission baseline data

If these are real production records, export them before any reset and plan a controlled re-import into the finalized schema.

If these are old test/bootstrap records, confirm they can be discarded after backup before reset.

## Recommendation

Recommended approach: **Reset database then apply migrations**, not incremental migration.

Rationale:

- Remote migration history is blank for all current local migrations.
- Existing production schema is partial and does not match the current application.
- Applying migrations incrementally to a partial unmanaged schema is likely to fail or leave duplicate/legacy structures.
- Storage buckets are absent.
- The current app expects many tables that production does not have.

Required before reset:

1. Confirm backup restore test or at least backup download.
2. Export production rows that must be preserved.
3. Review and separate staging/demo seed migrations before production apply.
4. Create a production seed plan:
   - roles
   - permissions
   - required app settings
   - UOM defaults
   - approved category defaults
   - approved sales channels / supplier categories if needed
5. Decide whether current 5 outlets, 10 suppliers, employees, sales, purchases, and operating expenses are real and must be migrated.

Do not seed:

- staging/test employees
- staging/test outlets
- staging/test inventory
- staging/test recipes
- staging/test sales/purchases/product analytics
- staging photos
- staging auth users

## If Incremental Migration Is Required Anyway

Incremental migration is not recommended. If it is required to preserve production records in place:

1. Create a production schema diff against local expected schema.
2. Write a custom reconciliation migration instead of applying all migrations blindly.
3. Mark historical migrations carefully only after manually verifying equivalent schema.
4. Add missing tables/columns/policies/buckets incrementally.
5. Test every current module against production with a non-owner selected-outlet role.

This path is slower and higher risk than reset/apply/re-import.

## Next Actions

1. Confirm whether current production rows are real or disposable.
2. Decide reset window.
3. Review staging/demo seed migrations for production safety.
4. Build a production seed script that excludes test/demo operational data.
5. After approval, run production schema reset/apply process.
6. Execute `FEEDX_PRODUCTION_UAT_CHECKLIST.md`.
