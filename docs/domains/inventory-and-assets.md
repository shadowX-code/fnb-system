# Inventory And Assets

## Purpose And Scope

This domain owns restaurant inventory state, controlled movements and reconciliation, recipe/usage relationships used for stock operations, and physical asset lifecycle management.

## Canonical Ownership

Current inventory and asset services, lifecycle RPCs, migrations, RLS, and tests are authoritative.
Factory raw material and finished-goods stock belong to `factory-warehouse.md`.
Factory recipes and BOM belong to `factory-master-data.md`.

## Core Entities

- Restaurant inventory items, locations, balances, and movement evidence
- Receipts, issues, transfers, adjustments, and stock checks
- Reconciliation periods, requests, and canonical stock projections
- Restaurant recipes and usage mappings that affect inventory interpretation
- Assets, assignments or location state, lifecycle events, and audit history

## Lifecycle And Business Rules

Stock changes occur through established lifecycle authorities that validate scope, quantities, state, and retry identity.
The canonical balance is server-derived from accepted evidence or the established read model; the browser must not manufacture final stock.
Corrections use explicit adjustments or controlled reversal behavior rather than rewriting posted history.

Asset creation and lifecycle transitions use the existing asset authorities.
Status, location, assignment, and retirement history must remain traceable.
Inventory and asset records are related operational concerns but retain their own entity lifecycles.

### Asset Tracking Application Read Boundary

`assetTrackingService` remains the approved Asset Tracking application boundary for Supabase reads and lifecycle RPC intent. `loadOutletTrackingData` owns the concurrent five-collection list/summary/activity read set; its consumers must not recreate a divergent route-level query bundle. Imports use `asset_import_row`; the browser must not create an independent movement-log import path.

Asset availability and physical condition are separate canonical projections. Availability is derived from quantity and the configured minimum as **Available**, **Low Quantity**, or **Missing**; zero quantity is **Missing**, never also Low Quantity. Physical condition remains **Good**, **Needs Attention**, **Under Maintenance**, **Damaged** (legacy-compatible), or **Disposed**. The shared Asset read-model selector is the sole source for availability, condition, summary counts, quick filters, and list presentation, preventing filter/count drift. It also supplies the semantic activity labels for imported, adjusted, inspected, maintained, and archived assets. Maintenance eligibility is derived from the category setting plus the per-asset `maintenance_override`; Admin editor entry points share the same form state and validation rules.

Inspection item and evidence reads are constrained to inspection headers already returned under the current outlet/RLS scope. Actor display lookup is a limited Asset service projection; it is not a page-level employee-directory query. Direct Admin condition edits remain a deployed compatibility boundary; inspection draft persistence and archival use their scoped server-authoritative lifecycle paths.

Asset lifecycle history is append-only for ordinary clients: assets are archived rather than deleted, and movement, maintenance, inspection, item, and evidence rows are written only by trusted lifecycle authorities. Draft inspections may be resumed or archived through their canonical RPC; finalized inspection headers, items, and evidence are immutable. Database triggers enforce asset/outlet consistency for lifecycle children, and each successful lifecycle request records server-derived audit evidence in the same transaction.

Asset imports may update only an unambiguous same-outlet match: asset code is the preferred identity, while duplicate name-only matches are rejected for explicit resolution. Asset photo replacement stages the new object, persists the new database reference, then best-effort removes the prior object; a failed record save cannot delete the currently referenced photo.

The optional-field query fallbacks in the Asset service remain intentional compatibility debt until every supported environment is proven to have the corresponding deployed schema. They must stay contained in the service; no page-level fallback or legacy-field branching is permitted.

## Permissions, Snapshots, And Audit

Admin access requires inventory or asset permissions and outlet/record scope.
Protected mutation functions validate the actor server-side and expose only intended grants.
Posted movements, stock-check outcomes, lifecycle requests, and asset transitions retain immutable or append-only evidence as defined by current contracts.

## Workflows And Integrations

Admins configure items and locations, record operational movement intent, perform stock checks, reconcile differences, and manage assets.
Purchasing can supply receipt context but does not own stock posting.
Restaurant finance may consume valuation or usage projections without taking inventory write ownership.
People/RBAC supplies identity and scope.

The Purchase Orders route owns a focused authenticated read model for PO headers, lines, receipts, receipt items, and the inventory-item/outlet context required by its existing actions. It does not wait for unrelated Inventory Master metadata such as item-supplier links; full Inventory Control reads remain the owner for the other inventory routes. The PO read paginates canonical rows and verifies its header count so a row-limit cannot silently truncate the list.

## Compatibility And Deferred Scope

Inventory Control and Asset Tracking pages are surfaces within this domain, not separate documentation domains.
Do not merge Factory warehouse state into restaurant inventory solely because both represent stock.
Advanced costing, predictive ordering, or external warehouse integration remains deferred unless introduced by current contracts.
