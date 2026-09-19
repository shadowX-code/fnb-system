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

Asset imports may update only an unambiguous same-outlet match: asset code is the preferred identity, while duplicate name-only matches are rejected for explicit resolution. Asset master photos retain an untouched `original_image_url` and derive cache-versioned 4:3 presentation variants: `image_url` is the approximately 1200x900 display asset and `thumbnail_url` is the approximately 400x300 list asset. Variants use EXIF-aware contain rendering on a neutral canvas, never crop or cosmetically modify the asset, and fall back display/thumbnail -> original -> Asset icon. Photo replacement stages the entire new bundle, persists its references, then best-effort removes the prior bundle; a failed record save cannot delete the currently referenced photo. Inspection evidence remains immutable single-source evidence and is never normalized through the master-photo pipeline.

The optional-field query fallbacks in the Asset service remain intentional compatibility debt until every supported environment is proven to have the corresponding deployed schema. They must stay contained in the service; no page-level fallback or legacy-field branching is permitted.

### Crew Mobile Asset Execution

Restaurant Asset Tracking remains the only asset source of truth. Crew Mobile receives a minimum-safe, token-bound outlet projection through `crew_asset_mobile`; it never receives direct table access or Admin cost, supplier, purchase, or unrestricted audit metadata. `Add Assets`, `Adjust Assets`, and `Perform Asset Inspections` are independent per-account Crew Access capabilities. Any one capability permits the Assets read surface, while each mutation authority verifies its own capability again on the server.

Crew additions create one active, outlet-derived canonical asset with active-category validation, a server-set initial condition, Crew creator attribution, lifecycle idempotency, and audit evidence. Admin and Crew creation share the same field semantics: name, active category, initial quantity, and the canonical Asset unit vocabulary are required; photo, asset code, the existing free-text Asset location, and description are optional. New creation always stores minimum quantity as zero; minimum quantity and operational remark remain post-create/Admin concerns so historical values stay compatible without duplicating description. The optional initial master photo uses a token-bound Edge upload plus a narrowly time-bounded attachment authority. It uploads the preserved source with display and thumbnail variants under one stable request identity; a photo retry resumes the same Asset creation rather than creating another Asset. It is not a general Crew master-edit path. Direct Crew adjustments change quantity only and preserve physical condition. Crew inspections remain the canonical reconciliation path: they record expected and counted quantities, condition and evidence, and atomically create a movement only when the count differs. The Crew Activity view is a read-only, outlet-scoped projection of canonical movements and completed inspections, not a separate event source. Crew cannot edit an Asset after creation, nor manage maintenance, disposal, archival, categories, imports, or exports.

Inspection drafts are owned by the current Crew employee and outlet. Completion atomically writes canonical item/evidence rows, quantity corrections, condition, last-inspection state, activity, and audit. Required evidence uploads are mediated by the token-bound `crew-asset-evidence` Edge Function; the Crew browser receives no Storage write authority. Task-to-Asset deep linking is deliberately deferred until Tasks defines a canonical Asset evidence reference contract.

## Permissions, Snapshots, And Audit

Admin access requires inventory or asset permissions and outlet/record scope.
Protected mutation functions validate the actor server-side and expose only intended grants.
Posted movements, stock-check outcomes, lifecycle requests, and asset transitions retain immutable or append-only evidence as defined by current contracts.

## Workflows And Integrations

Admins configure items and locations, record operational movement intent, perform stock checks, reconcile differences, and manage assets. Specially authorized Crew may view its current outlet assets, add an outlet-scoped asset, record operational quantity adjustments, and execute canonical inspections from Crew Mobile; these actions remain visible to Admin with Crew actor attribution.
Purchasing can supply receipt context but does not own stock posting.
Restaurant finance may consume valuation or usage projections without taking inventory write ownership.
People/RBAC supplies identity and scope.

The Purchase Orders route owns a focused authenticated read model for PO headers, lines, receipts, receipt items, and the inventory-item/outlet context required by its existing actions. It does not wait for unrelated Inventory Master metadata such as item-supplier links; full Inventory Control reads remain the owner for the other inventory routes. The PO read paginates canonical rows and verifies its header count so a row-limit cannot silently truncate the list.

## Compatibility And Deferred Scope

Inventory Control and Asset Tracking pages are surfaces within this domain, not separate documentation domains.
Do not merge Factory warehouse state into restaurant inventory solely because both represent stock.
Advanced costing, predictive ordering, or external warehouse integration remains deferred unless introduced by current contracts.
