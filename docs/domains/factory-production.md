# Factory Production

## Purpose And Scope

This domain owns Factory Production Planning, Production Overview, Job Orders, production execution, batches, Batch Traceability, and read-only MeSTI Finished Product Storage Control and Food Processing Control projections.

## Canonical Ownership

Current Factory production pages/services, migrations, RPCs, RLS, route contracts, and tests are authoritative.
Current implementation overrides historical refactor-phase assumptions.
Factory Warehouse owns physical raw and finished-goods movement.
Factory Master Data owns recipes/BOM, production SOP, and factory reference data.

## Core Entities

- Production plans, planned quantities, dates, and status
- Job Orders and their material/product requirements
- Production runs, execution steps, consumption, output, yield, and exceptions
- Equipment bindings pinned by the Production SOP and applied at production completion
- Batches, lot references, lineage, quality/traceability evidence, and linked SOP/version context
- Production overview and reporting read models

## Lifecycle And Business Rules

Planning establishes intended production and may create or feed Job Orders through current controlled workflows.
Job Orders move through defined preparation, release, execution, completion, and exception states.
The server owns protected quantity calculations, state transitions, material validation, output posting coordination, and traceability links.

Execution pins the product recipe/BOM and SOP/version context needed to preserve historical meaning.
Recipe requirement scaling starts from the saved recipe quantity and `recipe_usage_uom`, then uses the declared Raw Material conversion path to calculate the Raw Material storage UOM. Batch allocation and stock deduction use only that storage UOM. The completion authority repeats the standard-usage conversion for recipe-linked completions and rejects a missing or mismatched conversion rather than accepting a client-calculated substitute.
Completed production and batch evidence is immutable except through explicit correction or reversal contracts.
Production SOPs bind the canonical active Factory Equipment instances required by the controlled process. On completed production, the trusted completion authority creates idempotent After Production Cleaning evidence for each bound Equipment using the `production_id + equipment_id` identity, and freezes equipment, Location, batch, product, job order, SOP, and completion context so later master-data changes do not rewrite historical meaning.
Production Overview is a read model and does not own underlying lifecycle writes.

## Permissions, Snapshots, And Audit

Admin access requires production permissions and applicable factory/storage scope.
Protected transitions validate the caller and current state server-side.
Released/completed orders, pinned master-data versions, material consumption, outputs, exceptions, and batch lineage retain auditable evidence.

## Workflows And Integrations

Planners create and sequence production demand.
Operators or authorized supervisors release and execute Job Orders, record required evidence, and complete production.
Factory Master Data supplies products, BOM, SOP, suppliers/customers, and storage references.
Factory Warehouse validates and posts raw consumption, finished-goods receipt, movement, and dispatch context through established boundaries.

## Compatibility And Deferred Scope

Production Planning, Overview, Job Orders, Production, Batch Traceability, and Finished Product Storage Control are surfaces of this domain, not separate domains. Finished Product Storage Control is read-only: it projects exactly one canonical Finished Goods batch balance for each completed Production and does not create a MeSTI ledger or inventory movement.

Factory List UI Foundation V1 begins with Batch Traceability. Its shared filter rail, compact table treatment, status badge mapping, date display helper, row-detail action, pagination, and list states are presentation-only primitives: they must preserve each listing's existing query, service, permission, and detail authority contracts. Other Factory pages adopt the foundation only through deliberate follow-up migrations.

Completed Production records move to `awaiting_verification` and can be verified only through `factory_verify_production_record`. The completing actor cannot verify their own record, verification is idempotent, and it does not alter saved production or QC evidence. Food Processing Control is read-only: it projects completed Production, existing QC evidence, canonical output and expiry fields, and the completion and verification audit actors without creating a second processing or QC ledger.
Legacy plans may explain migration history but do not override active routes or contracts.
Machine telemetry, advanced finite-capacity scheduling, and external MES integration are deferred unless explicitly introduced.
