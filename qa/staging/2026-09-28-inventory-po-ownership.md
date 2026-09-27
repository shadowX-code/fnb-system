# Inventory Phase 8 — PO workspace and restock ownership

Application commit: `b2ff66edf14fb35d9e12c8758fbe83dee328558a` (canonical Staging READY alias verified). Subsequent closure commit adds only the export contract and this evidence report.

## Boundary

InventoryControlPage: 5,299 → 4,525 lines. PO list/loading, filters, export, Draft editing, submit/confirm/cancel/complete orchestration and dialogs now belong to the PO workspace. Submitted Stock Check identity hands off to the PO-owned restock surface. No parent mutation/refresh callback is used. Shared Auth/UI/outlet/supplier context and read-only legacy Dashboard/Stock Check PO summaries remain legitimate parent inputs pending their later extraction.

No schema/migration/RLS or reservation change. Canonical PO Detail/Receiving files unchanged. Master no longer depends on parent PO workflow orchestration; its import/photo/link persistence and remaining broad bootstrap still need their own focused extraction assessment.

## Verification

- Build passed. Focused route, PO lifecycle/detail/Receiving/text, complete-read, scope/identity and reservation contracts: 65 passed. Added filtered-export contract subsequently passed with the 16-test lifecycle suite (66 total unique focused tests).
- Authenticated direct PO route, source Result → restock navigation, scoped search, date range (Today excludes older order; This Month restores it), outlet switching, close/reopen and refresh verified.
- New outlet pending read visibly removed previous outlet's PO rows. Unit tests cover late responses, same-scope retained refresh, incomplete child reads and identity/access changes.
- Desktop and narrower Admin layouts verified at measured DOM widths 1,800 and 1,280; document scroll width equalled viewport width. No browser error logs recorded.
- Existing eligible PO `FC-260924-003` opened canonical Receiving by identity; quantities/history/detail remained readable. Closed without posting. Existing Receiving and completion eligibility contracts reused rather than making unnecessary stock mutations.
- Copy Text reached canonical clipboard-blocked fallback with the correct supplier message and edited 7-unit quantity.
- Filtered export payload/dispatch verified by contract. The in-app browser download event did not deliver a file; no claim is made that a downloaded artifact was inspected.
- Historical duplicate headers are retained separately by the focused read contract. Unchanged reservation concurrency/idempotency authority retains its prior rehearsal evidence; focused reservation and stable retry payload contracts pass.

## Approved isolated fixture

Staging `ujkzdaaadnvcfayuldmh` verified before mutation. No Production/frozen candidate changes.

- Item: `d7d2d3f0-83cf-42db-a852-b4e01745025b`, QA-PH8-PO.
- Supplier: `11a8ecb5-6bc5-442d-8b73-3af571598d0f`.
- Group: `233747c0-c94a-421e-b7a7-532afcfcc4cd` (custom Monday/Closing).
- Submitted check: `7dae9d75-27ac-4ed9-834b-ca0de7a06aa0`.
- PO: `09915df9-f2e9-4bd8-9024-0ec78eb4fa84`, `FC-260927-01`.

Frozen PAR 10 and count 2 resolved to shortage/order 8. UI created one supplier Draft, immediately showed the existing reservation, edited to 7 with Remark, then cancelled with QA closure reason. Exactly one PO, one draft-created audit and one cancellation audit; command request evidence retained. Initial fixture attempts were transactionally rolled back by scheduling validation, not bypassed. Synthetic fixture variance was supplied as -8 (the result display interprets it as Excess); it was deliberately not rewritten after submission. Restock uses the authoritative frozen PAR/count, correctly yielding 8, not that display label. This is fixture-input evidence, not changed valuation/result authority.

Before/after submitted header hash: `797b0009e81f6297cb19ce8d1d7c2a95`.
Before/after submitted rows hash: `4593a7c4ab90adfdab1b3164ebf21c68`.

Cleanup: item/supplier/group inactive, item-outlet link inactive. Submitted check, cancelled PO, command/audit history retained. Zero fixture receipts and movements. No real stock balances changed.

Documentation Impact: Updated `docs/domains/inventory-and-assets.md`.
