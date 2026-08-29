# Restaurant Finance And Purchasing

## Purpose And Scope

This domain owns outlet financial input, purchasing records, supplier-facing purchasing workflows, period reporting, and the controls that preserve historical financial meaning.
It groups related finance pages under one business authority rather than documenting each report or input screen separately.

## Canonical Ownership

Current services, migrations, trusted RPCs, and financial contract tests are authoritative.
The domain owns sales records, purchase records, sales channels, purchase categories, outlet tax configuration, operating expenses, supplier purchasing relationships, purchase orders, import batches, data health, alerts, and financial period snapshots.
Inventory receipt and stock movement ownership belongs to `inventory-and-assets.md`, even when initiated by purchasing.

## Core Entities

- Outlets and outlet-scoped configuration
- Sales and purchase records and their source/import metadata
- Sales channels, suppliers, categories, and purchase orders
- Tax configuration history and operating expenses
- Import batches, row validation, and correction evidence
- Financial periods, snapshots, reports, alerts, and analytics projections

## Lifecycle And Business Rules

Financial records begin as controlled manual or imported inputs and feed canonical period projections.
Imports validate and normalize data through the established batch authorities; partial browser-owned writes must not replace that lifecycle.
Period snapshot authorities freeze the business state required for reproducible reporting.
Later configuration or master-data edits must not silently rewrite historical period meaning.

Server authority owns protected totals, tax treatment, period calculations, snapshot state, and multi-write import behavior.
Reporting and analytics are read models over canonical finance and purchasing evidence.
Alerts may identify risk but do not become an alternative source for underlying values.

Current operational P&L semantics are explicit: Financial Revenue is the sales-channel aggregation (channel amounts less recorded adjustments); `purchase_based_cogs` is the matching-period `purchase_records` total; operating expenses are separately recorded; and Net Profit is server-derived as `revenue - purchase_based_cogs - opex`. These are management reporting projections over source records, not an accounting ledger or a substitute for inventory valuation. There is no month-close/finalization authority: missing source evidence is not RM0 and makes the financial period incomplete.

The canonical Reporting read boundary is the authenticated, outlet-scoped server contract exposed through `reportingService`. Its monthly financial contract returns each source as an amount plus `present`/`missing` state and returns `complete` only when Revenue, purchase-based COGS, and OpEx are all present. The yearly/YTD dataset reuses that monthly contract for a fixed January–December grid; missing or future months remain null, and incomplete years are explicitly YTD/incomplete rather than finalized yearly P&L.

Product Analytics remains a separate authority: completed product-sales reports/items provide product ranking only, never Financial Revenue. Rankings preserve category/product/variant identity; Top 10 is sales revenue descending, and Lowest 10 is ascending after excluding non-positive sales. Missing or incomplete Product Analytics data does not block a financial report.

The Restaurant Admin `Reports` module is the current Reporting consumer. It uses `reports.view`, requires an explicitly selected accessible outlet, and generates a Monthly Profit or Yearly/YTD P&L poster preview only when the Admin selects Generate. The fixed-ratio React/HTML posters consume the `reportingService` dataset without direct Supabase queries or financial recomputation. Incomplete financial inputs and unavailable product data remain visible states, rather than being coerced to RM0 or blocking financial output.

Staging-only poster QA uses a deterministic, explicitly labelled `QA Demo — Reporting Posters` outlet and ordinary Staging source evidence (sales, purchase, expense, and completed Product Analytics records). The guarded seed and verifier scripts refuse any Supabase target other than the canonical Staging ref and verify the existing Reporting RPC outputs; they do not become a Reporting authority, a browser mock mode, a Production runtime dependency, or a source of Production business data.

PNG/PDF export, report history/snapshots, sharing, scheduling, AI insights, and final poster-designer styling remain deferred. `reports.export` remains reserved for that future controlled export action.

## Permissions And Audit

Admin access requires the relevant finance, purchasing, import, supplier, or reporting permission plus outlet scope. Reporting reads and the Reports page require `reports.view`; `reports.export` is reserved for a future controlled export action.
Cross-outlet comparisons must return only outlets visible to the caller.
Material imports, snapshot transitions, configuration changes, and protected purchasing actions retain business audit evidence.

## Workflows And Integrations

Admins configure source data, enter or import records, resolve validation issues, operate purchase orders, and review period outcomes.
There is no direct Crew mobile mutation surface owned by this domain.
Purchasing may hand off accepted quantities to inventory through existing contracts.
People/RBAC supplies identity and scope; product analytics and dashboards consume canonical read models.

## Compatibility And Deferred Scope

Legacy report labels or routes may remain compatibility entry points but do not define separate domains.
Do not infer accounting-ledger, banking, payroll, or external ERP scope unless current contracts explicitly introduce it.
