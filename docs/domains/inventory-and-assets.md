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

Restaurant Stock Check drafts (scheduled and audit) are saved through `inventory_save_stock_check`; a submitted check and its item evidence are immutable. The server owns request idempotency, outlet/group validation, submission time and actor, and a completed scheduled check's group timestamp. Audit draft deletion uses `inventory_delete_stock_check_draft` and records server audit evidence. Stock Check completion records a count; it does not itself post an inventory movement or adjust a balance. The private `inventory_authority` cores accept a server-derived Admin or future Crew employee actor, while the current public wrappers enforce Admin Auth, permission and outlet scope. Existing historical rows remain readable.

The Audit Stock Check Result pins the canonical Master Inventory unit cost into each item evidence row at submission, only when a cost was explicitly configured and the item's count UOM matches the cost UOM. This read-only snapshot supports Stock Value (`Actual × unit cost`) and signed Variance Value (`(Actual − Par) × unit cost`) without changing inventory movement authority. Audit shortage/excess display and quantity variance likewise derive from the immutable Actual and Par counts, rather than assuming that all historical Admin/Crew evidence used the same stored variance sign. Earlier submitted results have no recoverable historical cost snapshot; missing, default-unconfirmed, or unit-mismatched costs display `—`, never an invented RM0. Headline valuation is for the complete submitted Audit and remains incomplete rather than silently summing only known-cost rows; result-table filters do not change it.

Stock Check Groups is an outlet-scoped configuration surface; due/completed state and last-check evidence belong to Stock Check execution. Group status stores `active`, `inactive`, or `archived`. The existing quick deactivation writes `inactive`, not `archived`; explicit archived/reactivated status changes currently use the Group edit form. No separate restore lifecycle command exists.

The Crew Inventory read projections remain token/outlet-scoped and side-effect free. The mobile catalog exposes the canonical active inventory item's `photo_url` for recognition thumbnails; Stock Check summaries expose their persisted `updated_at` and first counted `cover_item_id` for compact draft presentation. These are read-only display fields, not new item-image or Stock Check authorities.

Asset creation and lifecycle transitions use the existing asset authorities.
Status, location, assignment, and retirement history must remain traceable.
Inventory and asset records are related operational concerns but retain their own entity lifecycles.

### Asset Tracking Application Read Boundary

`assetTrackingService` remains the approved Asset Tracking application boundary for Supabase reads and lifecycle RPC intent. `loadOutletTrackingData` owns the concurrent five-collection list/summary/activity read set; its consumers must not recreate a divergent route-level query bundle. Imports use `asset_import_row`; the browser must not create an independent movement-log import path.

Asset availability and physical condition are separate canonical projections. Availability is derived from quantity and the configured minimum as **Available**, **Low Quantity**, or **Missing**; zero quantity is **Missing**, never also Low Quantity. Physical condition remains **Good**, **Needs Attention**, **Under Maintenance**, **Damaged** (legacy-compatible), or **Disposed**. The shared Asset read-model selector is the sole source for availability, condition, summary counts, quick filters, and list presentation, preventing filter/count drift. It also supplies the semantic activity labels for imported, adjusted, inspected, maintained, and archived assets. Maintenance eligibility is derived from the category setting plus the per-asset `maintenance_override`; Admin editor entry points share the same form state and validation rules.

Inspection item and evidence reads are constrained to inspection headers already returned under the current outlet/RLS scope. Actor display lookup is a limited Asset service projection; it is not a page-level employee-directory query. Direct Admin condition edits remain a deployed compatibility boundary; inspection draft persistence and archival use their scoped server-authoritative lifecycle paths.

Asset lifecycle history is append-only for ordinary clients: assets are archived rather than deleted, and movement, maintenance, inspection, item, and evidence rows are written only by trusted lifecycle authorities. Draft inspections may be resumed or archived through their canonical RPC; finalized inspection headers, items, and evidence are immutable. Database triggers enforce asset/outlet consistency for lifecycle children, and each successful lifecycle request records server-derived audit evidence in the same transaction.

Asset imports may update only an unambiguous same-outlet match: asset code is the preferred identity, while duplicate name-only matches are rejected for explicit resolution. Asset master photos normalize supported camera/library sources (including iPhone HEIC/HEIF where the browser can decode them) into cache-versioned WebP source, 1200x900 display, and 400x300 thumbnail variants. The display variants use an EXIF-aware, user-selected 4:3 framing transform; they do not alter asset content. Crew and Admin render thumbnail -> display -> source -> Asset icon. Photo replacement stages the entire new bundle, persists its references, then best-effort removes the prior bundle; a failed record save cannot delete the currently referenced photo. Inspection evidence remains immutable single-source evidence and is never normalized through the master-photo pipeline.

The optional-field query fallbacks in the Asset service remain intentional compatibility debt until every supported environment is proven to have the corresponding deployed schema. They must stay contained in the service; no page-level fallback or legacy-field branching is permitted.

### Crew Mobile Asset Execution

Restaurant Asset Tracking remains the only asset source of truth. Crew Mobile receives a minimum-safe, token-bound outlet projection through `crew_asset_mobile`; it never receives direct table access or Admin cost, supplier, purchase, or unrestricted audit metadata. `Add Assets`, `Adjust Assets`, and `Perform Asset Inspections` are independent per-account Crew Access capabilities. Any one capability permits the Assets read surface, while each mutation authority verifies its own capability again on the server.

Crew additions create one active, outlet-derived canonical asset with active-category validation, a server-set initial condition, Crew creator attribution, lifecycle idempotency, and audit evidence. Admin and Crew creation share the same field semantics: name, active category, initial quantity, and the canonical Asset unit vocabulary are required; photo, asset code, the existing free-text Asset location, and description are optional. New creation always stores minimum quantity as zero; minimum quantity and operational remark remain post-create/Admin concerns so historical values stay compatible without duplicating description. A no-photo creation uses the standard lifecycle RPC. A photo-inclusive Crew creation stages its media bundle under one request identity and commits the Asset plus all three photo references through one server transaction; any known upload/finalization failure cleans staging and leaves no visible Asset. A same-request replay returns the original result without duplicate Asset or media records. `Manage Asset Details` is an independent Crew capability for name, description, location, and master-photo presentation only; it cannot alter quantity, condition, category, maintenance, or lifecycle. Direct Crew adjustments change quantity only and preserve physical condition. Crew inspections remain the canonical reconciliation path: they record expected and counted quantities, condition and evidence, and atomically create a movement only when the count differs. A Crew member may cancel only their own resumable inspection draft through the token-bound archive authority; it records an immutable lifecycle event while completed inspections, evidence, and Asset state remain untouched. Draft saves do not upload photo evidence, so cancelling a draft leaves no draft-only Storage object. The Crew Activity view is a read-only, outlet-scoped projection of canonical movements and completed inspections, not a separate event source. Crew cannot manage maintenance, disposal, archival, categories, imports, or exports.

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

The business-facing PO No. is `inventory_purchase_orders.business_po_no`, assigned once by the database at creation and immutable thereafter. Existing three-digit Admin display numbers were frozen during the forward-only migration; new numbers start with a two-digit per-prefix/UTC-day suffix, expanding past 99 rather than wrapping. A private atomic counter and unique index protect concurrent creation. `po_no` remains a technical compatibility field, not a Crew display formatter. Admin and Crew read the same persisted number; Crew's opaque-session projection includes it in both list and detail.

Draft PO persistence and completed Stock Check suggestion conversion use trusted commands; the latter creates supplier drafts atomically and validates source, shortage line, supplier link and duplicate eligibility under a source lock. Submit, supplier confirmation, cancellation and completion use `inventory_transition_purchase_order` with server-derived state, time, scope, retry identity and audit evidence. An unconfirmed, unreceived Submitted PO may use the same trusted transition core to return to Draft for correction; the PO ID is retained, prior submission and return-to-Draft remain in audit history, and resubmission creates new submission evidence. Admin requires PO edit permission; Crew requires the existing outlet-scoped PO management capability. Supplier-confirmed or received POs cannot return to Draft. Receiving retains `inventory_receive_purchase_order` as the receipt and Purchase movement authority through the same private actor-explicit lifecycle core. Crew receives no direct table grants for these lifecycles.

Crew Inventory Gateway adds token-bound outlet Stock Check, Purchase Order and attention reads plus narrow Crew wrappers around those same private lifecycle cores. Reads never create checks, orders, receipts or movements. Fixed-outlet Crew is restricted to its Employee workplace outlet; Management must supply a currently Role-authorized outlet and hold the matching outlet Special Access grant. The four independent grants are Perform Stock Check, Create Audit Stock Check, Create / Manage Purchase Orders and Receive Purchase Orders. Crew may submit and supplier-confirm a PO, but cancellation and manual closure remain Admin-only. Crew receipt posting still uses the canonical Purchase receipt and Inventory movement transaction, with the employee actor recorded separately from Admin Auth.

The Crew mobile Operations surface consumes that gateway for Required/Audit/History counts, manual or Stock Check-sourced PO drafts, supplier confirmation, Copy Text and partial/full receiving. It never creates parallel Task, Stock Check or PO records. `crew_inventory_mobile_catalog` is a read-only, token-bound creation-choice projection for the outlet's active categories, items and suppliers; it does not grant item-master mutation or bypass any command validation. The Stock Check detail/history projection also exposes the current canonical Master Inventory image when one remains available, including for inactive items, without changing immutable count evidence. `crew_outlet_scope` exposes fixed-outlet inventory grants for action visibility, while every read and mutation still independently revalidates the opaque session, outlet and capability server-side. The PO text uses the same pure formatter as Admin.

Scheduled Stock Check occurrences use the outlet's server-side Kuala Lumpur business date and configured group schedule: Due, In Progress (persisted draft), Completed (submitted), or Skipped; an unresolved occurrence becomes Missed after its business date. Required and Home expose only current Due/In Progress occurrences. Historical drafts are read as Missed and cannot be saved or submitted after their date; missed schedule runs without a persisted check are read-derived History entries, not fabricated count records. Crew may skip only a currently Due occurrence through an outlet/capability-checked, idempotent command that records actor, business date, server time, and optional controlled reason. Skipped evidence is terminal and immutable; it neither counts stock nor creates a purchase suggestion or movement. History includes completed scheduled checks, Skipped, Missed, and completed Audit checks, including recently submitted Audits with older check dates. Audit remains count/control evidence only and is never a PO source. Existing completed counts and product-image presentation remain unchanged.

After a completed scheduled Stock Check, Crew's completion result uses the existing token-bound PO suggestion projection to offer a direct review of eligible Par-level gaps. That projection also supplies counted quantity, Par quantity and source-linked PO identifiers for display and re-entry; it is not a second suggestion calculator. Crew reviews supplier grouping, item inclusion and requested quantities before invoking the existing atomic source-check-to-draft command. The command retains all source, supplier, duplicate and race checks; no PO is submitted automatically. Audit checks remain ineligible, and a source already represented by a PO resolves to that canonical order rather than creating another.

## Compatibility And Deferred Scope

Inventory Control and Asset Tracking pages are surfaces within this domain, not separate documentation domains.
Do not merge Factory warehouse state into restaurant inventory solely because both represent stock.
Advanced costing, predictive ordering, or external warehouse integration remains deferred unless introduced by current contracts.
