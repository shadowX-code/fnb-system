# Restaurant Legacy Correctness candidate

Isolated candidate: `d1a66246c79e2fd5ba661253507e2e3f8fedee3c`

Production base: `56029c15388dce0121454aec72bbe0313b7be70d`

Canonical Staging verification SHA: `90ba31e9f4005f3e13b26c308b2e38fdb51b7c44`

Frozen Batch A `152106443b9aeca4e72dc15ed558dbf84dafad72` and Batch B `c3d49099fa8d0f9b29762c021d02a3a57c460b2a` remain unchanged. No Production deployment or main merge.

## Included files

- `docs/domains/inventory-and-assets.md`
- `docs/domains/restaurant-finance-and-purchasing.md`
- `qa/restaurantLegacyReportingPermissions.sql`
- `src/features/sales-purchase/pages/DataHealthPage.jsx`
- `src/features/sales-purchase/pages/InventoryControlPage.jsx`
- `src/features/sales-purchase/pages/OutletPnlPage.jsx`
- `src/features/sales-purchase/pages/__tests__/InventoryGroupsLifecycle.test.jsx`
- `src/features/sales-purchase/pages/__tests__/InventoryParLevelsLifecycle.test.jsx`
- `src/features/sales-purchase/pages/__tests__/InventoryRecipePageLifecycle.test.jsx`
- `src/features/sales-purchase/pages/__tests__/InventoryWastePageLifecycle.test.jsx`
- `src/features/sales-purchase/pages/__tests__/LegacyFinancialTruthfulness.test.jsx`
- `src/services/__tests__/inventoryCompleteRead.test.js`
- `src/services/__tests__/outletPnlProjection.test.js`
- `src/services/inventoryCompleteRead.js`
- `src/services/outletPnlProjection.js`
- `src/services/reportingService.js`
- `supabase/migrations/20260927154339_restaurant_legacy_financial_read_permissions.sql`

## Release migration

Ordered manifest contains only `20260927154339_restaurant_legacy_financial_read_permissions.sql`.

This forward-only function-permission migration enables canonical financial Reporting reads for the existing Outlet P&L permission while retaining outlet scope and the separate Product Analytics reports permission. It changes no financial formulas, business records or grants. No Production business-data migration/backfill is required.

Staging applied migration ledger timestamp is `20260927160111`, named `restaurant_legacy_financial_read_permissions`; repository manifest timestamp is `20260927154339`. Preserve this mapping rather than rewriting ledger/history.

## Verification

- Nine focused test suites: 54 tests passed; isolated production build passed.
- Migration rehearsed locally against Reporting function definitions matching read-only Production fingerprints. P&L-only access, report-only product access, denial without permission, outlet isolation and missing-data null semantics passed.
- Candidate merges with frozen Batch A without conflicts; neither candidate was changed.
- Authenticated canonical Staging: Friends Corner saved January zero OpEx remains zero; missing February–May OpEx and EBITDA remain unavailable. Incomplete totals/charts do not imply zero or healthy EBITDA.
- Data Health retains source review and missing-expense warnings without Lock/Unlock, Frozen claims or fabricated audit actors.
- Inventory full reads paginate with exact count checks, deterministic ordering and explicit error/incomplete states. Active catalog read-back matched 56 database-active records. Existing Inventory lifecycle tests passed.
- Checked browser surfaces had no new warning/runtime error logs.

All five patch closure gates passed. No remaining blocker for this isolated patch; Production deployment still requires separate authorization.

This report is release evidence outside the isolated application candidate.
