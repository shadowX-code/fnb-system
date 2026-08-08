# Factory Refactor Plan

Priority: P1 maintainability. This plan records behavior-preserving frontend ownership work only.

## Current Checkpoint

- `src/features/factory/pages/FactoryWorkspacePage.jsx` remains the orchestration point for centralized lifecycle workflows and master-data mutation modals.
- `src/services/factoryService.js` remains unchanged by this refactor checkpoint.
- Existing Factory permissions, RPC contracts, stock logic, numbering, and migrations are outside this plan.

## Completed

- Shared Factory utilities and display primitives, including `FeedXDatePicker` and `SearchableSelect`.
- Factory permission, master-data, and bounded navigation contexts.
- Raw Material Movements, Product Movements, Batch Traceability, and Audit Trail query/page ownership.
- Supplier, Customer, and Storage Location page extraction while retaining workspace-owned mutation authority.
- Production Planning pure model and Job Order draft utilities.
- Dashboard presentation helpers only; Dashboard query/page ownership remains centralized.
- Finished Goods commercial table and read-only detail presentation.
- Raw Material Inventory table and read-only detail presentation.

## Deferred Boundaries

- Production Planning full page/query ownership.
- Dashboard query and page ownership.
- Finished Goods full query ownership.
- Raw Material Inventory full query ownership.
- Lifecycle-heavy workflows: Job Orders, Production, Receiving, Dispatch, Finished Goods Stock Check, Raw Material Stock Check, Recipes, and SOPs.
- A domain split of `src/services/factoryService.js`.

## Extraction Rules

- Prefer a bounded domain file when adding Factory UI; do not add a new large renderer or query block to `FactoryWorkspacePage.jsx` when a domain boundary is available.
- Keep permission gates, authoritative RPC usage, mutation-refresh boundaries, and error behavior unchanged during extraction.
- Keep exactly one query authority and one mutation authority for every domain workflow.
- Do not use this refactor plan to change Factory business rules, permissions, database schema, migrations, or RPC contracts.
