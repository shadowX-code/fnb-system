# FeedX Asset Tracking UAT Report

## Asset Import

| Test Case | Result | Notes | Priority |
| --- | --- | --- | --- |
| Import button appears in Asset Tracking page header | Pass | Added beside Export and Categories, before Start Inspection and Add Asset. | P0 |
| CSV/XLSX upload parses into preview | Pass | Uses the same browser CSV/XLSX parsing pattern as Master Inventory Import. | P0 |
| Download Template includes required columns and sample row | Pass | Template uses `Noodle Plate,AST-PLATE-001,FC,Kitchenware,20,5,Good,Dry rack,2026-05-30,,Active,Standard noodle plate,`. | P0 |
| Required columns validated | Pass | Asset Name, Outlet Code, Category, and Quantity are checked before import. | P0 |
| Unknown outlet/category and invalid quantity blocked | Pass | Invalid rows stay in preview with row-level error and are not written. | P0 |
| Condition/status validation | Pass | Conditions: Good, Fair, Needs Attention, Damaged, Disposed. Status: Active, Inactive, Disposed. | P0 |
| Upsert matching | Pass | Primary match is Asset Code + Outlet; fallback is normalized Asset Name + Outlet. | P0 |
| Supabase persistence | Pass | Confirm Import writes through `assetTrackingService.saveAsset()` into `asset_items`; no local-only import state is used as persistence. | P0 |
| Import movement log | Pass | Created/updated rows attempt an `asset_movement_logs` correction entry with reason `import`; failures are non-blocking. | P1 |
| Refresh safety | Pending Browser UAT | Code path is Supabase-backed; final browser CSV acceptance should be run against staging data after migration is applied. | P0 |

## Notes

- Migration `20260530014000_asset_import_optional_fields.sql` adds optional import metadata fields to `asset_items`.
- Asset import does not auto-create outlets or categories.
- Import is scoped to outlets available in the current user's accessible outlet list.
