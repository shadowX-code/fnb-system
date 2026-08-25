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

## Permissions And Audit

Admin access requires the relevant finance, purchasing, import, supplier, or reporting permission plus outlet scope.
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
