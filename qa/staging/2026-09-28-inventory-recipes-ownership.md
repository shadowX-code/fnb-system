# Inventory Phase 5 — Recipes / Product Mapping

Base: `5d5a9d8d981f85b03b22bfad2e53e45888e29f6a`.
Canonical Staging only; frozen release candidates and Production unchanged.

## Ownership

`InventoryRecipesPage` receives Auth, UI notifications and canonical outlets only.
It owns scoped reads, filters, workspace selection, commands, forms, detail, clone,
photo orchestration, menu categories, export and refresh. Product Analytics/mapping
loads only on opening Mapping. Clone source recipes load on demand across accessible
outlets. Parent falls from 8,225 to 6,521 lines (1,704 net reduction).

Recipe normalization/display and the common sales/mapping projection converge on
`inventoryRecipeReadModel`; persistence still uses the existing lifecycle RPC/service.
Recipe Intelligence analytics remain in the parent. Its period labels are preserved
by a regression test. Phase 6 should establish an analytics-owned scoped loader,
not recreate mapping persistence or recipe projection.

## Verification

- 42 focused tests: complete-read behavior; atomic scoped replacement; obsolete
  response/refresh rejection; mapping failure versus empty; lazy mapping reads;
  trusted create/edit commands; clone ingredients; archive/error behavior;
  projection labels; export CSV through the existing download owner.
- Production build passes (existing bundle-size warning).
- Authenticated Staging: direct Recipes entry, outlet/search isolation, create,
  persisted photo/detail, cross-outlet Clone, ingredient edit, refresh/read-back,
  category create/edit/deactivate/reactivate, Mapping map/unmap/ignore/restore,
  route transition to Intelligence and back.
- Desktop/narrow viewport: document scroll width equals viewport width (1800/1025
  CSS px respectively); filters wrap, metrics adapt, table scroll stays contained.
- Browser download event is not delivered by the in-app browser; Export action was
  invoked, and filename/Unicode CSV generation is covered by the focused contract.

## Approved isolated fixture and cleanup

- Ingredient `1b265d79-52ca-4364-86bd-f950b3c485b2`, SKU `QA-RCP-P5-20260928`:
  RM2.50 / pcs. Retired; all three fixture links inactive; zero inventory movements.
- Target `e39d2d9e-0c45-4cd0-a0e8-400a69d9c37d`: 2 pcs + 10% wastage = RM5.50.
  QA Demo outlet; photo persists. Archived/inactive after QA.
- Clone `bf0a40e0-c955-4c0d-af23-3fce84380fd6`: Friends Corner; cross-outlet
  source visible; 3 pcs + 10% = RM8.25, then edit to 4 pcs + 10% = RM11.00.
  Archived/inactive after QA. No real recipe or balance modified.
- Category `8c37409a-01c1-46e8-a1a1-dadc71cc40f2` inactive after lifecycle QA.
- Synthetic mapping report `62b6b9c8-31cc-490f-9014-8c78a68aaa63` and its sole
  item removed after mapping reset; no remaining fixture mapping. Existing reports
  unchanged. This was disposable mutable analytics input, not official/business data.
- Three canonical recipe lifecycle request records retained: target create,
  clone create, clone edit; distinct request IDs and one result per operation.
  Recipe/ingredient/photo evidence retained with inactive masters. No audit or
  lifecycle request history deleted. No schema/migration change.
