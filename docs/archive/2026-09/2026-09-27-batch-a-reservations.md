# Batch A prospective PO reservation release

Production baseline: `56029c15388dce0121454aec72bbe0313b7be70d`.
Application patch retained from Batch A `6da4f6ca868689d38ecd1f8e62188a1ced48dc4f`.

## Ordered migration manifest

Apply only these migrations, in this order, against that baseline:

1. `20260924001607_restaurant_inventory_authority_foundation.sql`
2. `20260924092947_purchase_order_business_number.sql`
3. `20260924093140_purchase_order_business_number_overflow_guard.sql`
4. `20260924112642_stock_check_audit_cost_snapshot.sql`
5. `20260927131345_employee_compliance_employee_registry.sql`
6. `20260927151034_restaurant_po_source_reservations.sql`

Do **not** apply `20260924003727_restaurant_inventory_source_po_uniqueness.sql` to this Production baseline. It is retained as already-applied Staging ledger history, not included in this release manifest. The forward reservation migration replaces its backstop without requiring historical duplicate cleanup. Do not blindly push every repository migration.

## Verification

The complete six-migration sequence succeeded against an isolated restored Production schema containing exact read-only exports of the seven duplicate pairs. Original columns were compared before/after migration and after lifecycle probes across Stock Checks, count items, POs, PO lines, receipts, receipt lines, movements and lifecycle requests. All 14 historical POs, 8 receipts, 36 movements and 22 request records remained unchanged. Persisted business numbers matched the previously reconstructed historical Admin display numbers.

Authenticated canonical creation races produced one PO; owner-level insert races independently tested the database backstop. Same-request retry returned the same result and one request record. Different eligible suppliers/source checks remained allowed. Cancelling one historical sibling did not release the other sibling's claim; this probe was rolled back. Canonical cancellation and replacement remained supported. Client roles cannot access or forge reservations.

Rehearsal runner: `qa/staging/restaurantPoReservationRehearsal.mjs`. Its scoped Production evidence inputs remain outside the application release; it accepts no remote database connection. The local schema replay uses the normal migration-owner schema privileges.

No Production mutation, deployment or main merge. Payroll candidate remains frozen; no Payroll code or QA changed.

Canonical Staging forward migration and authenticated-role canonical create/retry/duplicate rejection passed in a rolled-back disposable transaction. Staging retained 13 original POs, with no disposable outlet left behind. The migration ledger timestamp was aligned to repository version `20260927151034` after the migration tool assigned its application-time timestamp.

Isolated candidate verification: 19 focused test files / 105 tests passed; production build passed (existing bundle-size warning only); `git diff --check` passed. `src`, `package.json` and `package-lock.json` are byte-identical to the prior Batch A candidate. No Payroll/Factory application changes were introduced by this patch.
