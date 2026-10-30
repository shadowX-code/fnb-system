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
Recipe requirement scaling starts from the saved recipe quantity and `recipe_usage_uom`, then uses the declared Raw Material conversion path to calculate the Raw Material storage UOM. Batch allocation and stock deduction use only that storage UOM. Operational material quantities are rounded to four decimal places at that boundary; the preview, allocation, variance, and trusted completion authority use the same value. The completion authority repeats the standard-usage conversion for recipe-linked completions and rejects a missing or mismatched conversion rather than accepting a client-calculated substitute.
Finished Goods output is pinned to the Job Order Packaging SKU's canonical `storage_location_id`. Completion requires that exact Location to be active and storage-enabled; it does not infer or substitute a destination from a Storage method label such as Freezer.
Completed production and batch evidence is immutable except through explicit correction or reversal contracts.
Production SOPs bind the canonical active Factory Equipment instances required by the controlled process. On completed production, the trusted completion authority creates idempotent After Production Cleaning evidence for each bound Equipment using the `production_id + equipment_id` identity. The occurrence date is the Production `end_date` under the Malaysia operational-date contract; `completed_at` remains audit metadata. The occurrence freezes equipment, Location, batch, product, job order, SOP, and completion context so later master-data changes do not rewrite historical meaning.
Production Overview is a read model and does not own underlying lifecycle writes.

## Permissions, Snapshots, And Audit

Admin access requires production permissions and applicable factory/storage scope.
Protected transitions validate the caller and current state server-side.
Released/completed orders, pinned master-data versions, material consumption, outputs, exceptions, and batch lineage retain auditable evidence.
Factory staff/operator/responsible-person selectors use the People-owned active `workplace = Factory` population when the selection semantically requires Factory workforce. Factory role permissions authorize Factory functionality but do not make Management or Restaurant employees Factory workforce.

## Workflows And Integrations

Planners create and sequence production demand.
Operators or authorized supervisors release and execute Job Orders, record required evidence, and complete production.
Factory Master Data supplies products, BOM, SOP, suppliers/customers, and storage references.
Factory Warehouse validates and posts raw consumption, finished-goods receipt, movement, and dispatch context through established boundaries.

## Compatibility And Deferred Scope

Production Planning, Overview, Job Orders, Production, Batch Traceability, and Finished Product Storage Control are surfaces of this domain, not separate domains. Finished Product Storage Control is read-only: it projects exactly one canonical Finished Goods batch balance for each completed Production and does not create a MeSTI ledger or inventory movement. Batch Traceability projects persisted Production Raw Material batch allocations with their receiving, supplier, and storage provenance; it never reconstructs historical usage from recipes or inventory, and explicitly reports unavailable allocation evidence for older production records.

Factory List UI Foundation V1 begins with Batch Traceability. Its shared filter rail, compact table treatment, status badge mapping, date display helper, row-action cluster, pagination, list states, and composable semantic table cells are presentation-only primitives: they must preserve each listing's existing query, service, permission, and detail authority contracts. List composition is `Page Header -> optional Summary -> optional view tabs -> Filter Bar -> active filter chips -> table -> pagination`; filter controls keep content-aware widths and whitespace rather than stretching. Keep up to three useful criteria inline when they fit comfortably; use the shared compact Filters popover only for lower-frequency criteria. Row actions keep lifecycle mutations visible, use the Eye icon for read-only detail, and place edit/archive/cancel/delete in an overflow menu only when such actions exist. Semantic cells supply consistent primary/secondary hierarchy, entity/date treatment, semantic dot text, soft labels, attention values, progress counts, and muted states; pages remain responsible for mapping their domain state to a semantic tone. The primitives resolve all surfaces, controls, table states, and floating layers through FeedX theme tokens in light and dark modes. Other Factory pages adopt the foundation only through deliberate follow-up migrations.

Completed Production records move to `awaiting_verification` and can be verified only through `factory_verify_production_record`. Role Settings permission `factory_production.verify` is the canonical verification authority, verification is idempotent, and it does not alter saved Production or QC evidence. Food Processing Control projects completed Production, canonical output and expiry fields, and the completion and verification audit actors without creating a second processing or QC ledger. Its QC status is derived from the exact SOP version pinned to the Production: an SOP with no QC points is `No QC Required`; `Evidence unavailable` is reserved for a pinned SOP that required QC but whose expected evidence cannot be resolved.
Legacy plans may explain migration history but do not override active routes or contracts.
Machine telemetry, advanced finite-capacity scheduling, and external MES integration are deferred unless explicitly introduced.
# Operational completion attribution

Completed Production is attributed to its recorded `end_date` and `end_time` in `Asia/Kuala_Lumpur`. `completed_at` remains audit metadata for when the completion was recorded, and is not used for operational daily or monthly reporting.

## Monthly Production Performance

Production Overview consumes the read-only, RLS-preserving `factory_get_production_monthly_performance(date)` projection with `factory_production.view` authority. It uses the canonical operational completion function, never Planning quantities or audit timestamps. A completed Job Order counts once (the latest completed Production record if legacy replay rows exist). Actual output uses the canonical actual-output field precedence; only mass units (kg or converted g) contribute to kg totals, never packs or assumed litre density.

Productivity is eligible actual kg divided by summed valid recorded JO-hours from Production start to end. Missing, zero or negative durations are excluded along with their output from this ratio; the monthly ratio is weighted by summed hours, not averaged daily ratios. Overlapping JO durations remain JO-hours, not factory operating hours, OEE or target efficiency.

The trend averages the latest seven days with completed production, carrying up to six prior production days across month boundaries. Limited history uses the available days; a window with unresolved output is unavailable. Past dates without production are zero, future dates are unmeasured, and missing output is explicitly incomplete. Records without a complete Production End are disclosed as unattributed historical runs and are not assigned an invented date. Existing operational KPIs, pipeline and Recent Activity are independent and unchanged.

All three chart modes open the same Daily Production drill-down. Each day includes the exact deduplicated completed runs contributing to its totals in the monthly snapshot, with canonical output, recorded pack quantity, Production start/end and valid JO duration. Detail identity joins retain source-table RLS; the projection does not elevate access or recalculate dates in the client. Closing detail preserves the selected month and chart mode, and existing completed Job Order result navigation remains the detail owner.

The monthly Dashboard operational wrapper materializes its inherited base analytics snapshot once per call before projecting operational completion overlays. It remains a security-invoker read under source RLS, with the existing permission checks, reporting definitions and Malaysia-time attribution. Reusing the snapshot avoids repeated analytics evaluation; it does not cache data across calls or extend API timeouts.

## External Agent read projections

Navigation-scoped agents can inspect saved execution/QC/material records and the canonical operational pipeline through the Gateway. The pipeline and Planning open-order aggregate share their existing read authority with Admin and never call due-release or other mutations. Completed-production MeSTI projections reuse the canonical QC requirement/evidence status and batch quantity/UOM/date authorities with personal fields removed. Pinned-SOP or ambiguous batch gaps remain unavailable. Production Reports exposes permission-gated source records; current UI costing/yield calculations are not copied into a competing backend calculation. Gateway policy and scope are owned by `../architecture/trusted-authorities.md`.

### Production Reports ownership

Production Reports originated in Factory Phase 1A (`f48a7105d`, 4 June 2026). Its active hidden human route `/factory/production/reports` (retained `/factory/reports` route identity), `FactoryWorkspaceRoutes` dispatch, `FactoryWorkspaceRuntime.renderReports`, scoped `factoryService` loaders and human `factory_production_reports.view/export` permissions remain. It renders existing costing, yield, usage and movement calculations and has active role assignments. It is not dead code and is not an independent sidebar module.

The Gateway maps its four saved-input resources to Production Overview (`factory_job_orders`): `production_records` and `material_usage` require Production Records; `product_movements` requires Product Movements; `receiving_costs` requires Raw Material Receiving. Relationship grants and field policies are unchanged. There is no separate agent Production Reports permission or catalog entry. Existing machine executable operations must be identical before and after migration; source grants remain mandatory. Calculated report summaries remain a Limited capability on Production Overview. Human routes, shared reporting read authorities and applied migration history are preserved.

## Factory Label Printing (Staging)

Completed Job Orders expose Print Labels for completed Production batches. This is additive label evidence; it never changes Production, the Job Order lifecycle, packaged output, stock or calculations. A Production is one authoritative Packaging SKU/batch; the batch selector exposes multiple completed records without inventing mixed-size allocations. Initial label quantity is bounded by `actual_pack_qty`, never estimated/target output. Missing manufacturing/end date, expiry, batch or packaged quantity requires explicit confirmation and an evidence reason, saved only with the label. Recorded facts cannot be overridden. Production expiry wins over later label shelf-life settings; an approved label rule applies only when recorded expiry is absent.

The first queued label freezes `factory_label_snapshots` (one per Production), approved SKU label content/configuration, exact assigned template version, canonical product-family defaults with label-only display overrides and the recorded Production title retained as provenance, dates, batch, quantity authority and confirmation provenance. The initial monochrome raster is reused for subsequent original labels and reprints, so browser fonts/master changes cannot rewrite history. Every original allocation consumes the batch allowance even after failure; recovery is an explicit reprint. Request fingerprints, per-batch locking and stable request IDs prevent duplicate submissions and over-allocation. The browser retains unresolved submission intent per operator/Job Order for retry across modal close/reload.

`factory_label_context`, `factory_label_enqueue`, `factory_label_claim`, `factory_label_report`, and `factory_label_resolve` are trusted authorities. Tables have RLS, no client table grants, and immutable template/config/snapshot/event evidence. View requires Job Order and Production view permissions; print uses `factory_production.complete`; reprint and physical confirmation/recovery use `factory_production.verify`. Actors are derived from active canonical employee/Auth links. No new production authority or role-assignment mutation is introduced.

States are Queued → Printing → Sent / Failed / Unknown. Confirmed is a supervisor's recorded physical inspection, never transport acceptance. Exclusive 10-minute claims serialize each device; expired claims become Unknown. Unknown blocks further device claims pending review. Native errors and interrupted submissions are held for inspection, never automatically resent. Sent may proceed through the bridge, but remains unconfirmed physical output. A controlled reprint references the original job, preserves its pixels, and records the reason and new quantity. Queued work may be cancelled to Failed; live Printing cannot be cancelled. Inspect/clear held Windows spooler work before resolving or reprinting uncertain output. Append-only print events retain server timestamps and actors.

The Windows 10/11 per-user background bridge uses outbound HTTPS with normal Supabase Auth, active employee/permission checks on each RPC, DPAPI session/journal custody and a single-instance mutex. Driver/GDI spooler is the default; modular bitmap TSPL via Windows RAW is available only when hardware/driver compatibility is verified. No Labelife dependency, cloud printer commands, inbound listener or service key is used. The installer, local calibration, offline handling and D520 limitations are documented in [`tools/windows-print-bridge/README.md`](../../tools/windows-print-bridge/README.md). Bridge registration/printer inventory/status is in `factory_label_devices`; it authenticates as its registering operator, and existing employee access controls revoke that authority.

The web feature and bridge endpoint are restricted to the exact Staging Supabase project. Hardware acceptance remains pending: D520 Bluetooth queue/driver availability, Windows 10/11 native execution, media dimensions/margins/orientation, TSPL/polarity support, scanning, bulk/paper-out behavior and physical quantity. A BLE-only D520 without a Windows queue requires a hardware-specific transport. Software verification does not imply those capabilities are proven.

Label setup is centralized under Factory Settings → Label Management. Draft edits and shared-template publication cannot change printing; new unsnapshotted batches consume only published SKU configurations and their explicitly pinned template versions. Read-only dynamic MFG/EXP, batch and actual packaged quantities remain Production-owned. Existing frozen snapshots and the Print Bridge/print-job lifecycle remain the operational authority.
