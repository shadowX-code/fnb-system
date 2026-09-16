# Factory Warehouse

## Purpose And Scope

This domain owns Factory Finished Goods, Dispatch, product movements and stock checks, Raw Material Receiving, raw inventory, raw movements, raw stock checks, and the Factory physical-cash Petty Cash ledger.

## Canonical Ownership

Current Factory warehouse services, migrations, lifecycle authorities, RLS, route contracts, and tests are authoritative.

## Finished Product Storage Control Projection

Factory MeSTI Finished Product Storage Control is a read-only report over canonical completed Production rows and their `factory_finished_good_batch_balances` entries. It uses the completed Production actor and timestamp, Packaging SKU, Finished Good family, batch opening quantity, canonical storage location, manufacturing date, and expiry already captured by the Finished Goods workflow. It never creates or mutates warehouse inventory, movements, batches, or a duplicate MeSTI storage ledger.
Restaurant inventory remains a separate domain.
Factory Production owns production execution and batch creation; Factory Master Data owns products, storage, suppliers, and customers.

## Core Entities

- Raw material receipts, lots, storage state, balances, and movement evidence
- Raw issues/returns/transfers/adjustments and stock-check evidence
- Finished-goods receipts, lots/batches, balances, and movement evidence
- Dispatch orders, allocations, picks, shipments, confirmations, and exceptions
- Warehouse locations and inventory/read-model projections

## Lifecycle And Business Rules

Raw receiving validates supplier/reference, material, quantity, lot, and storage context before accepted stock becomes available. New Receiving selection and trusted saves require an active canonical Supplier ↔ Raw Material link; there is no fallback to all materials for an unlinked Supplier. Changing Supplier requires an explicit confirmation before incompatible draft rows are cleared. Completion freezes the selected material's Acceptance Procedure and Control Methods on every item, posts canonical stock evidence, and moves the document to Awaiting Verification. A separately permitted active employee verifies the document; the receiving actor cannot self-verify, and verification evidence is immutable and retry-safe. Existing historical receipts remain visible regardless of their current master-data link state.
Raw and finished-goods balances are server-derived from canonical posted evidence or established read models.
Transfers, issues, returns, adjustments, and stock checks use controlled lifecycle paths. A positive Finished Goods Stock Check variance may credit a valid existing batch or, where no batch exists, create one traceable `adjustment` reconciliation batch only on approval. The reconciliation batch is linked to the Stock Check and SKU; it is never represented as Factory Production. Draft and submitted checks preserve only the proposed reconciliation intent and do not change inventory. Approval posts exactly one ledger movement per variance item through the canonical Finished Goods balance authority.

Production consumption and output are coordinated with Factory Production without duplicating stock ownership.
Raw Material balances, batches, allocations, and deductions remain in each material's storage UOM. Recipe usage UOM and package-content metadata are consumed through the Factory Production conversion contract; Warehouse does not infer or backfill package factors from receipt or historical BOM quantities.
Dispatch reserves and moves eligible finished goods through the defined allocation and confirmation states. Dispatch allocation availability is the authoritative batch-balance projection filtered to active, storage-enabled Factory Locations; display taxonomy such as Room Temperature, Chiller, or Freezer does not alter eligibility. Batches without a canonical storage location remain unavailable for Dispatch until reconciled.
Completed warehouse movements and dispatch evidence are not silently rewritten; corrections use explicit adjustment, reversal, or superseding evidence.

## Petty Cash Ledger

Factory Petty Cash records physical operational cash only. Its current and running balances are projections of Posted immutable `Cash In`, `Expense`, and signed `Adjustment` rows; no independently editable balance is stored. Drafts remain editable/deletable, while a correction to a Posted transaction creates one linked, Posted reversal Adjustment and preserves the original row.

References use the Malaysia business date and a transaction-locked daily `PC<YYMMDD>-<NN>` sequence. Expense Categories are active/inactive master records with retained historical references. Receipts are optional private image/PDF objects exposed through short-lived signed URLs to users with Petty Cash view access. All mutations use permission-checked trusted RPCs and write audit evidence.

Petty Cash does not create or modify Receiving, inventory, supplier payable, Recipe costing, Production, General Ledger, Accounts Payable, Profit and Loss, or bank-reconciliation records. Future physical cash counts may create explicit Adjustment evidence; they must not rewrite ledger history.

## Permissions, Snapshots, And Audit

Admin access requires the relevant raw material, finished goods, stock, or dispatch permission plus scope.
Trusted authorities validate state, quantity, storage, and actor server-side.
Receipts, movements, checks, allocations, dispatch confirmations, and corrections retain traceable evidence and pinned references where required.

## Workflows And Integrations

Warehouse users receive raw materials, manage storage and movements, perform stock checks, receive production output, prepare dispatch, and confirm movement or shipment states.
Factory Production requests/records consumption and output through established contracts.
Factory Master Data supplies materials, products, storage-enabled Factory Locations, supplier, customer, recipe, and unit references.

## Compatibility And Deferred Scope

Finished Goods, Dispatch, Raw Material, movement, inventory, and stock-check pages remain grouped under Factory Warehouse.
Do not merge restaurant and factory stock authorities because of similar labels.
Carrier integrations, barcode automation, and third-party WMS synchronization are deferred unless current contracts introduce them.
