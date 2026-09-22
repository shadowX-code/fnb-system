# Factory Runtime Route Coverage

This matrix records the data-bearing render paths that guard Factory route refactors. Each route must render at least one representative row or snapshot branch; a heading-only or empty-state test is not sufficient.

| Route | Representative data-bearing coverage | Test file |
| --- | --- | --- |
| Dashboard | KPI quantities, production summary, raw-material chart/table data | `FactoryDashboardPage.smoke.test.jsx` |
| Production Overview | Released, in-progress, and completed Job Orders; PB activity | `FactoryWorkspaceOperationalRoutes.smoke.test.jsx` |
| Job Order | Existing row plus Finished Good and Packaging SKU selection | `FactoryWorkspaceJobOrders.smoke.test.jsx` |
| Raw Material Receiving | Completed receiving document, supplier, item quantity | `FactoryWorkspaceOperationalRoutes.smoke.test.jsx` |
| Raw Material Inventory | Material balance, storage, category, image fallback, detail | `FactoryRawMaterialInventoryPage.smoke.test.jsx` |
| Raw Material Movements | Receiving, Production Usage, Stock Check Adjustment rows | `FactoryMovementPages.readOnly.test.jsx` |
| Raw Material Stock Check | Submitted stock check with a critical variance item | `FactoryWorkspaceOperationalRoutes.smoke.test.jsx` |
| Production Records | In-progress queue, completed PB, material usage, output | `FactoryWorkspaceOperationalRoutes.smoke.test.jsx` |
| Factory Reports | Recipe cost, PB reference, production usage, movement rows | `FactoryWorkspaceOperationalRoutes.smoke.test.jsx` |
| Batch Traceability | PB batch row and detail request | `FactoryTraceabilityAuditTrail.smoke.test.jsx` |
| Finished Goods | Grouped/table SKU, commercial fields, read-only detail | `FactoryFinishedGoodsPage.smoke.test.jsx` |
| Production Planning | SKU, Par, open Job aggregate, draft and Par action intents | `FactoryProductionPlanningPage.smoke.test.jsx` |
| Finished Goods Dispatch | Draft dispatch, Packaging SKU item total, customer | `FactoryWorkspaceOperationalRoutes.smoke.test.jsx` |
| Product Movements | Production PB, Dispatch, Stock Check and multi-batch rows | `FactoryMovementPages.readOnly.test.jsx` |
| Finished Goods Stock Check | Submitted finished-good count/variance row | `FactoryWorkspaceOperationalRoutes.smoke.test.jsx` |
| Product Recipes | Draft/active recipe, ingredients, linkage and detail | `FactoryProductRecipesPage.smoke.test.jsx` |
| Production SOP | Draft/active/legacy SOP, QC checkpoints and detail | `FactoryProductionSopPage.smoke.test.jsx` |
| Audit Trail | Normalized audit event, business reference and detail | `FactoryTraceabilityAuditTrail.smoke.test.jsx` |
| Locations | Active location, storage eligibility, and independent action permissions | `FactoryMasterDataActionIntents.test.jsx`, `FactoryStorageLocationsPage.permissions.test.jsx` |
| Suppliers | Active supplier and bounded create/edit/archive intents | `FactoryMasterDataActionIntents.test.jsx` |
| Customers | Active customer and bounded create/edit/archive intents | `FactoryMasterDataActionIntents.test.jsx` |
| MeSTI Cleaning of Area | Daily occurrence lifecycle, monthly matrix, direct Location/Requirement setup, responsible/verifier authority | `FactoryMestiCleaningPage.test.jsx`, `factoryMestiCleaningMigration.contract.test.js` |

When extracting or moving a Factory renderer, extend the matching data-bearing test before changing ownership. Any helper referenced only inside a populated row, card, modal, or conditional branch must be imported from a shared utility or defined locally.
