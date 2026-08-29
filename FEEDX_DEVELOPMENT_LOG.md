# FeedX Development Log

Purpose: milestone changelog for meaningful FeedX development sessions. This file preserves delivery history but is not architecture or current-system authority. Current code and migrations take precedence, followed by tests/contracts and the canonical documentation routed from `docs/README.md`. Release notes under `docs/releases/` document Production releases.

## Late August 2026 — Crew Mobile Operations, Cash, And Localized Content

- Completed the durable Crew task execution baseline: versioned task definitions and scheduled assignment produce token-bound mobile work, canonical completion evidence, controlled reset/redo, and roster-aware schedule visibility.
- Added the outlet/date Cash Checkout authority with server-derived count, variance, opening/retained cash, collection, append-only ledger, controlled handover receiver/confirmation, and bounded checkout-history read model.
- Established the Crew localized-content layer for SOP, onboarding, and task content with source ownership, provider-bound translation, deterministic fallback, and frozen localized snapshots. Crew Mobile now consumes the shared localization and mobile read-model foundation without changing source-domain authority.

## Late August 2026 — Delivery, Security, And Documentation Governance

- Established canonical `main`/`dev` branch and worktree hygiene, including guarded canonical Staging promotion from clean `dev` only and explicit Production approval boundaries.
- Restored Guest AI as a bounded, independently developed workspace on `guest-ai/dev`; only stable milestones integrate into current `dev`, preserving newer FeedX work and canonical Staging ownership.
- Hardened Crew Access outlet/session authority: Employee Master workplace remains canonical, mismatched or stale Crew outlet context fails closed, and authority changes revoke affected Crew sessions with audit evidence.
- Established the canonical documentation system: Context governs development and documentation impact, System Master maps the ecosystem, domain/architecture docs own current knowledge, and the legacy Master remains historical reference.

## Late August 2026 — Reporting Foundation

- Added the authenticated, outlet-scoped Reporting read contracts for monthly financials and completed Product Analytics product rankings, with `reportingService` as the sole browser access layer for future monthly, yearly/YTD, and poster consumers.
- Established explicit financial semantics: Financial Revenue is sales-channel aggregation, `purchase_based_cogs` is monthly purchase evidence, and server-derived Net Profit is Revenue minus purchase-based COGS and OpEx. Source absence remains distinct from explicit RM0; a period is complete only when all three sources are present.
- Added fixed 12-month yearly/YTD assembly with null missing/future months, present-month totals, and no implied month-close/finalization authority. Poster UI, generated exports, and report history remain intentionally out of scope.
- Restored the canonical environment linkage: `dev` Git Integration deploys to the verified `fnb-system-staging` Vercel project, whose internal deployment label does not redefine FeedX business environment; canonical Supabase linkage is explicitly `fnb-system-staging`, never Production. Applied and authenticated-RPC/RLS-verified the Reporting read-contract migration on Staging.

## Late August 2026 — Reporting Preview Foundation

- Added the Restaurant Admin `Reports` module with permission-gated, outlet-scoped Monthly Profit and Yearly/YTD P&L poster previews. Filter changes are intentionally draft-only until an Admin selects Generate.
- Established separate fixed-ratio React/HTML poster canvases that consume only the canonical `reportingService` datasets. They retain missing versus RM0, complete/incomplete, product-unavailable, and 12-month/YTD semantics without adding export, history, snapshot, share, scheduling, or AI-insight scope.

## 2026-08-13

### Crew Leave Entitlement / Balance v1
- Added outlet-scoped calendar-year Leave policies, durable employee/type entitlements, join-date proration, capped/expiring carry forward and immutable Manager adjustments.
- Used, pending and available days are server-derived from existing approved and pending Leave evidence. Pending requests reserve balance; approval converts that reservation to used leave; rejection/cancellation releases it. Full days use inclusive calendar dates and half days use 0.5 without inferred weekend/public-holiday exclusions.
- Rebuilt Crew Mobile My Leave with Annual/Medical/Unpaid balance cards plus Available / Requested / After validation, and extended Admin Leave with Requests, Balances and Settings while preserving the existing controlled approval and Duty Roster projection lifecycle.
- Applied Staging-only migrations `20260813132950_crew_leave_entitlement_balance_v1.sql` and `20260813135311_crew_leave_entitlement_lifecycle_guard.sql`. The forward guard preserves historical grants while preventing new grants for resigned/terminated employees.
- Real rollback-only Staging verification passed 15/15 for proration, pending reservation/release, approval consumption, insufficient balance, adjustment audit, carry-forward cap/expiry, lifecycle retention, own-data isolation and direct-table denial. Existing Leave/Roster regression remained 15/15.
- Added an idempotent Staging-only five-Crew QA seed with full, near-exhausted, pending, approved-used and unlimited scenarios. No Production resource was touched.

### Crew Availability + Shift Swap v1 — intentionally withdrawn
- Availability, temporary exceptions, specific-Crew swaps, open cover, manager Shift Requests and Roster availability warnings were intentionally withdrawn before Production.
- The applied Staging migration `20260813061304_crew_availability_shift_swap_v1.sql` remains immutable in migration history. Forward-only migrations `20260813071558_remove_crew_availability_shift_swap_v1.sql` and `20260813072908_remove_crew_availability_shift_swap_qa_sessions.sql` remove its feature-specific authorities, tables, grants, permissions, Roster metadata and deterministic QA seed sessions.
- Existing immutable Roster publication rows were not rewritten or deleted. Duty Roster ownership, published revision architecture, Leave projection, Attendance, Daily Operations and Performance remain active.
- Status: **Deferred / not currently required**. The feature is not part of the active FeedX product surface.

### Crew Duty Roster Ownership & Integration
- Moved Duty Roster product ownership to Crew → Workforce while retaining the Restaurant route as a compatibility entry into the same page, services, tables and trusted lifecycle authorities.
- Added canonical `crew_roster.view/manage/publish` permissions with legacy permission compatibility and outlet-scoped authenticated policies; Admin roster RPCs are no longer anon-executable.
- Added immutable publication revisions and token-bound `crew_my_roster` so Crew Mobile receives only its own latest Published schedule; Draft edits never replace the last published employee view until Republish.
- Integrated scheduled outlet/time/position evidence with Crew Attendance and Daily Operations, plus a private versioned Performance evidence adapter without changing the Performance formula or finalized results.
- Preserved OFF, MC and Annual Leave as manual roster entry types only. No Leave Request, approval, entitlement, document or availability workflow was inferred or added.
- Added secure multi-outlet-by-date scheduling: managers must have both the target roster Outlet and employee Home Outlet in scope; published Crew reads resolve the scheduled Outlet per date.
- Applied Staging-only migrations `20260813030000`–`20260813030003`; `30001` corrected an established snapshot validation SQL defect, `30002` enabled scoped multi-outlet scheduling, and `30003` corrected its runtime result-variable ambiguity.
- Added a dedicated QA roster seed at `scripts/seedCrewRosterQaData.sql`; it targets only explicit Staging QA identities and publishes through the production lifecycle RPCs.

## 2026-08-11

### Crew Journey Phase B — Backend Closed
- Applied Crew Journey migrations `202608110006` through `202608110020` to `fnb-system-staging` only.
- Completed Staging verification for immutable quiz scoring and strict validation, safe learning serialization, pinned SOP acknowledgement gating, exact sequential availability, direct-write RLS denial, and Crew ownership isolation.
- Deferred hardening debt remains separately tracked: three Phase A utility search-path warnings, an unrelated public migration-report RLS warning, and frontend bundle-size optimization.
- Phase B UI implementation is now deployed to Staging: Crew Learn uses only token-bound safe RPCs, Admin draft CRUD uses authenticated RLS, and lifecycle migrations `202608110021`, `20260811171948`, and `20260811172049` supply controlled publish/new-version authorities, outlet-scoped RLS predicates, and published-content guards.
- Phase B UI implementation is the next phase; no Production deployment was performed.

## 2026-08-12

### Crew Journey Phase B — Staging QA Demo Data
- Created a reusable, Staging-only QA seed at `scripts/seedCrewLearningQaData.sh` and `scripts/seedCrewLearningQaData.sql`; the runner refuses any linked Supabase project other than `ujkzdaaadnvcfayuldmh`.
- Seeded and published three acknowledgement-required SOPs (Welcome & Goodbye, Personal Grooming, and Workstation Cleanliness) through the existing SOP lifecycle authority.
- Seeded and published the sequential `New Crew Onboarding` Journey (3 modules, 5 lessons, 4 quizzes) and the non-sequential `Service Refresher` Journey through the existing Journey lifecycle authority.
- Assigned `New Crew Onboarding` to the clearly labelled Staging-only `Test` Crew employee solely through `assign_crew_journey`; its immutable snapshot pins all three published SOP versions.
- Added rollback-only anonymous Crew RPC verification at `scripts/verifyCrewLearningQaData.sql`. It verifies the safe payload, sequential availability, SOP acknowledgement visibility and quiz submission without retaining a session, attempt, acknowledgement or learning progress.
- No Production data, schema, migration, or deployment was changed.

### Crew Foundation — Phase A
- Added Crew as FeedX's third workspace with a desktop admin navigation for Dashboard, Crew Employees, and Attendance. Restaurant and Factory routes and their lifecycle ownership remain unchanged.
- Established a one-to-one `crew_access` extension of the canonical Employee Master Record. It deliberately does not reuse or alter Admin Access fields (`auth_user_id`, role, access state, or Admin last login).
- Added protected Crew passcode lifecycle authority: normalized mobile sign-in, bcrypt-hashed four-digit passcodes, common-passcode rejection, one-time temporary-passcode responses, session revocation on reset/disable, throttled failures and temporary lockouts.
- Added mobile-first Crew Home, clock in/out, attendance history and Me profile at `#crew`; Phase A stores attendance time only and intentionally excludes location verification, payroll and OT.
- Added Employee Directory Admin Access / Crew Access separation and Crew Access actions for users with `crew_employees.manage`.

### Crew Foundation — Phase A.1 GPS Geofence
- Added append-only Crew geofence migration `202608110002_crew_attendance_geofence.sql`. Outlet is the attendance-location source of truth through disabled-by-default location verification, latitude, longitude and a configurable 25–2,000m radius; no outlet receives fabricated coordinates or automatic enablement.
- Crew clock in now records GPS latitude/longitude, browser accuracy, calculated Haversine distance, GPS verification result and a required exception reason when a configured geofence cannot be verified. Clock out attempts GPS capture but never blocks ending a shift; unavailable/outside clock-out evidence is marked as an exception for review.
- Removed the original two-argument clock RPC in the follow-up migration so an older client cannot bypass the geofence contract. Current session validation rechecks active Crew Access and employment state on every request.
- Scoped Crew Access and Attendance admin reads/actions to the existing outlet-scope authority. Original GPS evidence remains immutable; no manual attendance correction workflow exists in Phase A.1, so there is no silent overwrite path.
- Deferred stronger verification methods (Wi-Fi, QR, NFC, beacon, selfie/face recognition) and all payroll/OT logic. The verification method vocabulary reserves their future addition without enabling them.
- Added Crew self-service Change Passcode through an active opaque session. It verifies the current passcode, applies the same weak-passcode rules, revokes all prior sessions, and immediately returns a fresh session without exposing any hash.

### Crew Foundation — Phase A Security Hardening
- Added forward-only migration `202608110003_crew_foundation_security_hardening.sql`; it explicitly revokes PostgreSQL default `PUBLIC EXECUTE` from every Crew helper/RPC before granting only the intended Admin or mobile roles.
- Internal helpers, including employee-to-outlet and session-to-employee resolution, have no client execution boundary. Admin access management remains authenticated-only plus its existing in-function permission/outlet validation; mobile RPCs remain explicitly anon/authenticated only because they require an opaque Crew token.
- Fixed expired lock recovery under the existing row lock and made successful login begin a fresh failure window. Disabled or resigned/terminated access cannot be automatically restored.
- Allowed authorized Admins to revoke Crew Access for resigned/terminated employees before eligibility checks for enable/reset, preserving security cleanup.
- Added database-level GPS evidence constraints for non-negative accuracy/distance, mutually exclusive verified/exception states, and reason consistency while retaining valid nullable legacy evidence.

## 2026-08-10

### Duty Roster Trusted Lifecycle Freeze
- Replaced browser-owned week-level roster lifecycle sequences with transactional `save_roster_week_snapshot`, `copy_roster_week`, `publish_roster_week`, `unpublish_roster_week`, and `lock_roster_week` RPCs.
- Added the shared `duty_roster_lifecycle_requests` request-ID/fingerprint ledger and a compatible week advisory-lock namespace; Copy Week takes source and destination locks in deterministic order.
- The server now derives the actor from `auth.uid()`, validates outlet access and permissions, preserves matching roster UUIDs, derives published snapshots, and returns canonical period/row state for refresh.
- Duty Roster lifecycle architecture is frozen at a 13/13 focused-test baseline. Deferred P2 debt: stale-editor last-write-wins, undefined cross-outlet employee-overlap policy, isolated single-draft-shift CRUD, and read/render performance only when production volume requires it.

### Sales / Purchase Monthly Snapshot Authority
- Replaced browser-owned monthly Sales and Purchase multi-step persistence with `save_sales_period_snapshot` and `save_purchase_period_snapshot` trusted RPCs.
- Added one shared request ledger with request-ID reuse, payload-fingerprint conflict protection, authenticated actor/outlet validation, and per-period advisory locks.
- Both snapshot RPCs update canonical matching rows in place, insert missing rows, delete omitted rows atomically, and preserve existing UUIDs; the remaining stale-editor last-write-wins behavior is P2 product concurrency debt.
- Monthly snapshot verification baseline: 11/11 focused tests passing.

### Data Import Lifecycle Authority
- Moved active Sales and Purchase import persistence behind the request-bound trusted lifecycle: begin request, row apply, and server-derived finalization; the browser no longer owns target writes, row-history writes, or batch completion.
- Added canonical request/batch and row identities for retry/idempotency, including payload-conflict protection and independent row outcomes for intentional `partial_failed` imports.
- Added trusted Purchase supplier/category preparation with canonical UUID mapping, normalized duplicate protection, server-side create permissions, actor attribution, and outlet validation.
- Added service, migration, and mounted Data Import coverage for new/existing masters, permissions, preparation rejection/retry, partial completion, and Sales regression. Data Import baseline: 21/21 focused tests passing.
- Deferred large CSV/XLSX parsing and high-row-count RPC optimization as P2 performance work; no lifecycle integrity gap remains.

### Inventory Structural Freeze
- Completed Inventory trusted lifecycle authority through request-ID-idempotent Supabase RPCs for Receiving, Waste, Transfer, Stock Check, Purchase Order, Manual Movement, and Recipe persistence.
- Established extracted presentation ownership for Wastage, Movement History, Manual Movement, Purchase Order list/detail, and Stock Check Groups while retaining one broad Inventory read/refresh authority in `InventoryControlPage`.
- Hardened Par Levels without extraction: `inventory_par_levels.edit` now gates UI and parent persistence callbacks; per-item/outlet sequencing prevents stale save responses or stale failures from overwriting the normalized local snapshot, while unrelated configurations continue saving concurrently.
- Recorded the Inventory structural freeze rules and post-launch debt: normalization/broad-read coupling, Stock Check/Master/Recipe complexity, Groups save concurrency, centralized PO Edit/Receive modals, and configuration CRUD review remain deliberately centralized until materially changed and covered by focused tests.

## 2026-08-08

### Factory Structural Refactor Closeout
- Froze Factory frontend structure after extracting domain pages and the remaining high-value modal/form surfaces: Job Orders, Production Execution, Dispatch, Stock Checks, batch allocation, and their presentation helpers.
- `FactoryWorkspacePage` is now the lifecycle/orchestration hub: it retains permissions, route/modal coordination, listing/refresh plumbing, notifications, and trusted lifecycle mutation callbacks; extracted components own presentation and local form/read state.
- Confirmed one Job Orders listing authority through the stable listing bridge and one shared Operational Jobs read model through `FactoryOperationalJobsContext` / `useFactoryProductionOverviewQuery`.
- Retained server/RPC authority for stock, batch, receiving, dispatch, production completion, and stock-check effects. Removed only the unreachable legacy direct-DML tail from `factoryService.saveStockCheck`; active stock-check saves remain RPC-backed.
- Lifecycle gates: Job Orders, Production Execution, Receiving, Dispatch, Product/Raw Stock Checks, operational route smoke, and RPC contract tests; Factory baseline is 153 passing tests. Next phase is staging operational acceptance.
- Known post-launch debt: factoryService internal split behind its stable facade, Production history dual-read review, combined Vitest/JSDOM operational-route runner behavior, Completed View Result permission design, React key warnings, and compatibility cleanup after data-migration confidence.

### Factory V1 - Staging Signed Off
- Delivered the Factory workspace from planning through traceable warehouse execution: Production Planning, Job Orders, Production Start/QC/Complete, Raw Material Receiving, Finished Goods Dispatch, Stock Checks, and Batch Traceability.
- Added exact Raw Material receiving-batch allocation for Production usage, FEFO allocation, Finished Goods batch creation, batch-aware Dispatch, and Product/Raw Material movement ledgers.
- Established official Factory business-number formats for Job Orders, Production Batches, Receiving, Raw Material internal batches, Dispatches, and Stock Checks; PRD and recipe/SOP codes remain internal historical compatibility fields.
- Added Recipe/BOM and Production SOP versioning, Factory Audit Trail, Finished Goods commercial fields, and current Factory analytics and operational views.
- Hardened Factory trusted RPC and RLS boundaries through migration `202608050031_factory_permission_boundary_hardening.sql`.
- Completed Owner, Operator, and read-only staging smoke coverage for the approved Factory V1 scope. See `docs/audits/FACTORY_V1_STAGING_SIGNOFF.md` for the concise certification record.

## 2026-06-18

### Factory
- Factory Phase 1 UAT Round 1 passed for Raw Material Receiving, Product Recipes / BOM, Job Orders, Complete Production, Finished Goods Balance, Finished Goods Dispatch, and Product Movements.
- Documented the Phase 2 traceability gap: Batch Traceability does not yet trace Dispatch -> Customer by production batch because dispatch currently records customer/SKU quantity without batch allocation. Phase 2 requires Dispatch Batch Allocation: Production Batch -> Dispatch Qty -> Customer.
- Refined the Product Recipes / BOM page wording, table labels, lifecycle action buttons and read-only detail view so recipe setup reads as a clean BOM workflow instead of a technical production-standard form.
- Added archived recipe restore behavior: archived Product Recipes return as draft versions for review, preserving the original BOM while keeping activation as the only path back to production defaults.
- Refined Finished Goods Dispatch into a Dispatch History / Create Dispatch tab workflow, keeping dispatch creation embedded on the page while preserving modal-based View/Edit for existing drafts and completed records.
- Added Factory Customers under the Factory System sidebar with create/edit/archive master data for dispatch destinations, replacing free-text customer entry for new finished goods dispatches.
- Added a production-safe migration for `factory_customers`, `factory_finished_good_dispatches.customer_id`, Factory customer permissions/RLS, and DB-side `DYYMMDD-01` dispatch number generation through `factory_create_finished_good_dispatch(...)` with an advisory transaction lock.
- Updated dispatch history to show Dispatch No., Customer, Items, Total Dispatch, Status, Date and Actions, avoiding misleading "SKU units" wording for mixed packaging quantities.

## 2026-06-16

### Factory
- Refactored Factory Job Order planning to select the parent Finished Good first, capture Target Production Qty/UOM, filter Packaging SKUs by that Finished Good, and estimate pack quantity from the selected SKU pack size using supported g/kg and ml/L conversions.
- Moved new Production Standard / BOM setup toward parent Finished Good logic through `factory_product_recipes.product_family_id` while keeping legacy SKU-linked standards readable for compatibility.
- Updated Production completion to capture Actual Pack Qty for finished-goods SKU stock-in while using Actual Output Qty to scale standard material usage and variance checks.
- Added additive Factory migrations for parent-level Production Standards, production pack/output quantity persistence, and production-quantity-first Job Order RPC validation without renaming existing `finished_good_id` compatibility references.
- Refined Complete Production into a final confirmation flow with auto-generated batch numbers, Actual Pack Qty as the stock-in result, calculated Actual Output Qty, and recipe-locked material usage rows when an active Production Standard / BOM exists.

## 2026-06-09

### Factory
- Refined Factory Finished Goods create/edit UX into a single-column, sectioned Product Information / Configuration / Notes form and removed finished-goods min-stock planning from the user-facing flow.
- Standardized Factory form label typography to normal-case FeedX data-entry styling across Factory forms, replacing KPI-style uppercase/tracked labels with 10.5px semibold gray labels.
- Replaced Factory create/add action plus icons with semantic lucide icons for Finished Goods, categories, receiving, job orders, recipes, SOPs, stock checks and material rows.
- Refined Factory Raw Material create/edit UX into a simple single-column form, renamed Raw Material Code to SKU Code, removed CN/BM names, Min Stock Level and Preferred Supplier from the user-facing form, and replaced free-text storage location entry with managed Storage Location selectors.
- Added inline required-field validation, first-invalid-field focus/scroll, and footer helper errors for Factory Raw Material and Finished Good master forms.
- Added Factory Storage Locations under the Factory System sidebar with create/edit/archive master data, RLS-backed permissions, and storage-location selection for Raw Materials, Finished Goods, and Raw Material Receiving.
- Refined Factory Raw Material Receiving into a page-based Receiving History / Receive Raw Material tab workflow for supplier delivery documents with multiple raw material item rows, default UOM/location from selected raw material, per-row inline validation, and no receiving cost fields.
- Added Factory Suppliers under the Factory System sidebar with create/edit/archive supplier master data for raw material receiving, replacing free-text supplier entry for new receiving documents.
- Moved multi-row Raw Material Receiving saves into a single Supabase RPC transaction so the batch header, item rows, raw material balance adjustments and movement logs commit or roll back together.
- Optimized the Raw Material Receiving item table for warehouse speed by using a compact material picker overlay, reducing visible row columns, showing UOM/location as context badges, and moving Add Item Row into the table header.

## 2026-06-08

### Duty Roster
- Added published Duty Roster snapshot retention so published/locked roster history keeps employee, position, department, outlet, shift and publish timestamp details after employee master data changes.
- Updated Duty Roster and Outlet Duty Roster views to show historical published snapshot staff, including resigned or terminated employees, while draft scheduling remains limited to current active outlet employees.
- Replaced the Outlet Duty Roster Working Staff and Unscheduled Days KPI cards with clickable Off Day, Annual Leave, and MC KPI detail drawers that respect outlet, month, group, position, employee search and published roster snapshots.
- Modernized Outlet Duty Roster monthly date cards with compact Staff Scheduled, Floor, Kitchen, OFF, AL, and MC chips plus status/today badges and a clearer View details affordance.
- Refined Outlet Duty Roster monthly calendar density by hiding zero-value chips and giving unscheduled days a lighter dashed No Schedule state.

### Purchase Comparison
- Changed the Purchase Comparison default View Mode to Supplier while keeping Category, Supplier, and Full selectable.

### Outlet P&L
- Simplified Revenue Trend and Net Profit Trend hover tooltips so each chart shows only its own month and two plotted series values.

### Inventory Control
- Added shorter business-facing Purchase Order references in `[OutletCode]-[YYMMDD]-[RunningNo]` format while preserving the existing internal PO system ID.

## 2026-06-03

### Product Sales Analytics
- Changed the Product Sales Analytics default reporting filter to the previous completed month while preserving manual month/year selection and existing compare-month behavior.

### Purchase Import
- Added supplier default-category auto-fill for purchase import rows with blank Category values, counting those rows as warnings while keeping rows failed when neither the upload nor supplier profile provides a valid category.

### Build Tooling
- Fixed Tailwind v4 build hangs by disabling automatic source detection and relying on explicit `@source` paths for app files.

## 2026-05-22

### People
- Stabilized Employees, Job Positions, Departments, Roles & Permissions, and Employee Login Access.
- Separated Employment Type, Employment Status, and System Access.
- Added Management workplace option for HQ/non-outlet staff.

### Duty Roster
- Stabilized roster settings, shift templates, outlet staff filtering, and time input UX.
- Kept resigned/terminated employees out of outlet-specific roster staff selection.

## 2026-05-24

### Asset Tracking
- Stabilized asset records, import workflow, inspections, activity display, and actor-name resolution.
- Simplified inspection UX to Setup, Checklist, and Review & Submit.

## 2026-05-26

### Inventory Control
- Completed persistence hardening for Master Inventory, Categories, UOM, Par Levels, Stock Check Groups, Stock Checks, Purchase Suggestions, Purchase Orders, Inventory Movements, Wastage, and Recipes.
- Removed local-only operational persistence paths from active Inventory Control modules.
- Added UAT and production-readiness documentation for Inventory workflows.

## 2026-05-28

### Recipes & Usage
- Added recipe costing foundation with recipe code, English/Chinese names, ingredient costs, selling price, margin, and recipe photos.
- Added Product Mapping workflow for Product Analytics products to recipes.

### Recipe Intelligence
- Added standalone Recipe Intelligence analytics page.
- Added mapping health, menu engineering matrix, gross profit trend, ingredient demand forecast, ingredient consumption, and ingredient cost trend foundations.

## 2026-05-30

### UI
- Standardized KPI typography, table density, sidebar typography, dark-mode semantic colors, and operational KPI card headers.
- Renamed Waste & Variance to Wastage and Purchase Categories to Supplier Categories in UI/navigation.

## 2026-06-01

### Production
- Completed Production readiness audit, production UAT checklist, and release-candidate reporting.
- Reset Production Supabase after approved disposable-data decision.
- Achieved migration parity 67/67 after Production reset.
- Removed migration-seeded test inventory rows from Production.
- Bootstrapped first Production owner user.

### Auth
- Audited Production SMTP readiness.
- Confirmed SMTP/setup email delivery was blocked pending configuration.
- Fixed Generate Setup Link Supabase v2 admin-client insert/update/upsert handling.

## 2026-06-02

### Production Operations
- Entered Production Operations Phase.
- Confirmed development governance: all development on `dev`, Production deploys from `main`, schema changes are migration-based, and Production Supabase changes require explicit approval.
- Added mandatory documentation enforcement: every completed development task must update the development log, business logic changes must update the master document, and production releases must update release notes before completion is reported.

### Auth UI
- Refreshed public login/setup/reset visual system with dark futuristic Holographic Ring direction.
- Removed dashboard mockup, bottom logo bar, duplicate auth-card logo, and unsupported SSO-style visual clutter.
- Refined the auth hero visual to use `public/holographic-ring.webp` as the central image asset with green glow, dark edge masking, reduced red/magenta artifacts, and subtle particle/pulse motion.
- Fixed holographic asset integration so the hero visual blends as a light layer instead of rendering as a rectangular image block.
- Adjusted login layout hierarchy so hero copy is lighter and the holographic ring becomes the primary visual focal point.
- Enlarged the login holographic visual to better match the reference image proportion.
- Doubled the login holographic visual scale for a stronger command-center focal point.
- Landing login page refined with final holographic motion and updated brand logo asset.
- Cleaned up login holographic motion layers to remove heavy filled glow disks and keep only lightweight orbit, scan, beam, and particle effects.
- Removed fan/turbine-like rotating holographic layers so the login portal reads as a mostly static premium asset with subtle life.

### UI
- Replaced the sidebar brand icon with the new `public/logo-icon.jpg` asset while preserving FeedX wordmark, subtitle, spacing, and layout.

### Inventory Control
- Hid inactive inventory items from Par Levels, Stock Check item generation, Purchase Order item selectors, Inventory Movement selectors, Wastage selectors, and Recipe ingredient selectors while preserving inactive item visibility in Master Inventory for historical reference and reactivation.
- Fixed fresh Production empty-state handling so fetched UOMs and categories remain visible even when inventory items and stock check groups are empty.
- Added a friendly duplicate UOM code error message for Supabase `inventory_uoms_code_key` conflicts.

## 2026-06-03

### Factory
- Added Restaurant / Factory workspace switching to the shared FeedX shell.
- Registered Factory sidebar modules, route metadata, permissions, and audit scopes through the central module registry.
- Added Factory Phase 1A Supabase foundation for dashboard, job orders, raw materials, raw material receiving, raw material movements, finished goods, production, recipes, stock checks, SOP, RLS policies, and permissions.
- Implemented Phase 1A working UI for Factory Dashboard, Job Orders CRUD, and Raw Material Receiving CRUD.

### Documentation
- Updated the master document with Factory workspace architecture, Phase 1A scope, Factory tables, RLS approach, and current exclusions.

## 2026-06-04

### Factory
- Added Factory Phase 1B production execution workflow from Job Orders.
- Production completion now records batch/date/operator/times, actual produced quantity, good output, wastage, QC status, material usage, variance, raw material deductions, finished goods stock-in, product stock movement, and job order completion.
- Added production dashboard/activity updates and Production Records UI.
- Added Factory Phase 1C raw material and finished goods stock check workflows with Draft, Submitted, and Approved statuses.
- Stock check records now capture system quantity, physical count, variance quantity, variance percent, Normal/Warning/Critical variance status, and required reasons for Warning/Critical rows.
- Only approved stock checks apply inventory balance adjustments and create raw material or finished goods movement logs.
- Added dashboard stock check variance alerts and recent submitted/approved stock check activity.
- Added Factory Phase 1D Production SOP management with product SOP versions, process steps, control points, materials, equipment, estimated time, and QC checkpoint flags.
- Production completion can now reference the SOP version used and raw material lots used by actual material usage rows.
- Added production QC checkpoint snapshots separate from stock checks and a Batch Traceability view connecting batch, product, job order, production date, operator, raw material lots, finished goods stock-in, SOP and QC status.
- Added dashboard quick alerts for batches with Pending, Hold, or Failed QC status.
- Hardened Factory UAT readiness by making Factory data loading tab-scoped and permission-aware, adding scoped access warnings for optional blocked datasets, and gating Factory action buttons by existing permissions.
- Added Factory Phase 1E read-only Factory Reports and production analytics foundation.
- Factory Reports now includes Production Summary, Raw Material Usage, Recipe Standard vs Actual Usage, Production Yield, and Finished Goods Stock Movement reports.
- Added actual-usage costing calculations for raw material usage cost, cost per batch, and cost per finished unit using recorded/latest receiving unit cost where available.
- Added dashboard analytics cards for Production Yield %, Material Variance %, Estimated Production Cost, and Top Variance Raw Materials.
- Fixed Factory UAT blocker by exposing Batch Traceability as its own reachable Factory sidebar module and route (`factory_batch_traceability`) with dedicated view/export permissions.
- Added Batch Traceability RLS coverage for production, job order, material usage, QC checkpoint, and finished goods movement read data.
- Clarified Factory report costing/variance wording so RM0 cost-source gaps and mixed-UOM variance interpretation are visible to users.
- Added Factory Phase 1F recipe costing and raw material cost history foundation.
- Added read-only standard recipe cost rollup using recipe item quantities, wastage allowance, and latest raw material receiving cost.
- Added actual production cost comparison against standard recipe reference cost with variance RM and variance %.
- Added raw material cost trend reporting from receiving records, including supplier/date/unit cost movement.
- Added dashboard cost cards for highest cost increase material, most expensive product recipe, and actual-vs-standard cost variance.
- Added read-only RLS coverage for Factory Reports/Dashboard to load recipe and receiving cost source rows without granting mutation rights.
- Fixed Factory Owner/Admin RLS permission mismatch by hardening `current_user_has_permission()` protected-role bypass for both employees-linked and legacy user profile identities.
- Updated Factory Owner/Admin permission seeding to use case-insensitive role name matching for all `factory_%` permission codes.
- Turned Factory Finished Goods into a read-only warehouse management page with SKU listing, stock KPIs, filters, production/movement/batch detail and clear production-first empty states.
- Turned Factory Product Movements into a read-only movement history page showing movement type, product, quantity, batch/source context and movement date.
- Added read-only warehouse RLS coverage so Finished Goods and Product Movements users can load production headers for last production date and batch history.
- Upgraded Factory Finished Goods into a master-plus-warehouse page with Finished Goods product create/edit/archive, category create/edit/archive, SKU/UOM/min-stock/status/remarks fields, live balance context, and product detail history.
- Added Finished Good category persistence and RLS through `factory_finished_good_categories`.
- Updated production completion so finished goods stock-in requires an existing active Finished Goods master product instead of auto-creating a stock record during production.
- Refined Factory Finished Goods UX by moving category management into the Category modal, adding EN/CN/BM product names, requiring searchable category selection, removing the page refresh action, blocking archive when stock balance is above zero, and adding warehouse insight panels for stock distribution, top produced products, movement trend, batch summary and days coverage.

### Documentation
- Updated the master document with Factory Phase 1B execution rules, variance threshold, actual-usage stock deduction rule, Recipe BOM separation, Phase 1C stock check approval rules, Phase 1D SOP/QC/batch traceability rules, Phase 1E reports/costing rules, Phase 1F recipe costing/cost history rules, Finished Goods Master and warehouse visibility/UX rules, the Batch Traceability route/RBAC UAT fix, Owner/Admin Factory RLS alignment, and functional-vs-placeholder Factory module status.

## 2026-06-05

### Factory
- Linked Factory Job Orders to active Finished Goods Master products through `finished_good_id`, replacing free-text product planning for new job orders.
- Updated Job Orders UX with Finished Good searchable selection, planning KPI cards, requested planning columns, locked completed/cancelled edit behavior, and active Finished Good validation.
- Updated Production Records so ready jobs are limited to planned/in-progress Job Orders and completion starts from the selected Job Order with Finished Good, target quantity, UOM, recipe and SOP references auto-filled where available.
- Hardened production completion so finished goods stock-in uses the selected active Finished Goods master product, creates the production/material/movement records, updates the Job Order to completed, and preserves batch traceability.
- Completed Factory Product Recipes with Finished Good-linked recipe management, draft/active/archived lifecycle, BOM material rows, one-active-recipe guardrails, and recipe activation/archive actions.
- Production completion now prefills material usage from the active Finished Good recipe where available, scaling standard usage by job target quantity while leaving actual usage editable for stock deduction and variance tracking.
- Completed Factory Raw Material Inventory as a master-plus-inventory page with Raw Material create/edit/archive, category create/edit/archive, multilingual EN/CN/BM names, code, default UOM, min stock, preferred supplier, storage location, status and remarks.
- Updated Raw Material Receiving so stock-in must select an active Raw Material Master record instead of using free-text material creation; UOM and storage location default from the selected material where available.
- Added Raw Material Inventory KPIs, filters, low-stock/recent-receiving/recent-consumption panels, recipe-based can-produce estimates and raw material detail history for receiving, consumption, stock checks and cost trend.
- Added Factory Raw Material category persistence/RLS through `factory_raw_material_categories` and extended raw material RLS coverage for inventory, receiving, movements, stock checks, product recipes and production usage.

## 2026-06-14

### Factory
- Refined Factory Job Order and Production into a clearer MES-style flow: Recipe reference -> Job Order draft -> Release -> Start Production -> Complete Production -> inventory movement and traceability.
- Added database-side, concurrency-safe Job Order numbering with `JOYYMMDD-001` format through `factory_create_job_order(...)`.
- Updated Job Order statuses to `draft`, `released`, `in_progress`, `completed`, and `cancelled`, with legacy `planned` rows mapped to `released`.
- Added Job Order release/start metadata and RPCs so Start Production captures only operator/date/time/remarks while completion remains responsible for output, actual material usage, QC, inventory deduction, finished goods stock-in, and traceability.
- Hardened production completion so only In Progress Job Orders can complete, a Job Order cannot complete twice, Finished Good must match the Job Order, and inventory movements are created only during completion.
- Locked Job Order direct editing to Draft only; Released, In Progress, Completed, and Cancelled orders are advanced only through lifecycle actions or viewed read-only.
- Updated production material usage validation so any actual-vs-standard variance requires a reason in both the completion UI and database RPC.
- Documented that Phase 1 production defaults use the active recipe at completion/defaulting time; frozen Job Order BOM snapshots are deferred to Phase 2.
- Refactored Factory Product Recipes into a Production Standard / BOM workflow with internal recipe codes, read-only auto versions, Production Quantity wording, optional Estimated Production Time, and row-level BOM detail view.
- Added New Version action for Production Standards so draft copies auto-increment from `v1` to `v2`, `v3`, and later versions while preserving the one-active-standard rule.

### RBAC
- Added explicit `sales_input.import` and `purchase_input.import` permissions so Sales Input and Purchase Input imports can be enabled independently from create/edit access.
- Updated import workflow permission checks and `import_batches` / `import_batch_rows` RLS coverage so module imports require the owning module import permission, while preserving Owner/Admin protected-role behavior.
- Added Recipe Intelligence `view` and `manage` permissions, routed Recipe Intelligence through its own view permission, and guarded Product Mapping decisions with Recipe Intelligence manage access.
- Improved the Role Management permission matrix scrolling so action headers remain visible while reviewing long permission tables.
- Fixed Purchase Import unknown-supplier review so the selected default category for a newly created supplier resolves blank-category purchase rows during preview and final import rebuild.
- Added a follow-up Sales/Purchase import RLS migration after confirming staging still has `202606050001` pending; Sales import batch writes require `sales_input.import`, and Purchase import batch writes require `purchase_input.import`.
- Fixed Sales Import history row display so View Imported Rows shows normalized sales channel names and matching channel amounts instead of reading uploaded amount columns as channel labels.
- Scoped embedded Purchase Import to the Purchase Input selected outlet, added target-outlet validation and banner copy, kept month/year file-derived for multi-month imports, and filtered recent import history by selected outlet across months.

## 2026-06-15

### Factory
- Added Finished Goods parent/Packaging Variant foundation so one Finished Good can group multiple inventory SKUs while each SKU continues to track stock independently.
- Added `factory_product_families` as the internal Finished Good parent table plus nullable Finished Good SKU fields for parent link, variant name, pack size and advanced base conversion without changing existing balances, movements, stock checks, Job Orders or Production stock-in references.
- Updated the Finished Goods form and listing with Finished Good / Packaging Variant fields, Finished Good/category/status filters and Finished Good/SKU/pack-size warehouse columns.
- Refactored the Finished Goods UI from one flat SKU table into Finished Good -> Packaging SKU management, with expandable Finished Good rows, nested SKU rows, Finished Good actions and SKU-level View/Edit/Archive actions.
- Documented the Phase 1 limitation that Production Standards remain per Finished Good SKU; bulk production with packaging split into multiple SKUs is deferred to Phase 2.

## 2026-08-10

### Employee / Auth Identity
- Hardened the canonical Employee/Auth model: `employees.id` is the employee identity, `auth.users.id` is the login identity, and `employees.auth_user_id` is the unique one-to-one link.
- Added normalized login-email identity (`trim().toLowerCase()`) with a unique employee-email migration guard; profile compatibility lookup remains ordered `auth_user_id` -> legacy employee ID -> normalized email while legacy migration cleanup is deferred.
- Hardened `employee-auth-onboarding` to verify the authoritative employee ID, existing Auth link, conflicting links, ambiguous Auth-email matches, and invite races before conditionally linking the intended Auth account.
- Fixed Save & Send Login Setup rejection recovery: persisted employees retain their identity, the modal remains usable, and retry targets the same employee rather than inserting a duplicate.
- Blocked ordinary linked-employee login-email edits pending a dedicated future Auth-email migration flow; the UI and employee service both defend the boundary.
- Added server-owned immutable `employees.created_by` attribution from `auth.uid()` on insert, preserved across updates, with historical null creators left untouched.
- Employee/Auth lifecycle baseline: employee service 7/7, auth identity 4/4, UsersPage 3/3, creator migration contract 1/1; 15/15 focused tests passing.

### Product Analytics
- Added the authenticated `product_analytics_save_report` RPC for atomic new-upload and replacement persistence under the canonical `(outlet_id, report_month, report_year)` identity.
- Added `product_analytics_lifecycle_requests` for request-ID idempotency, authenticated actor/outlet binding, payload-fingerprint conflict protection, and canonical retry results.
- Replaced browser delete/header/item choreography with the one trusted RPC, preserving explicit Delete as a separate report delete with FK item cascade and best-effort audit.
- Added upload/replace pending-submit protection and preserved the same request ID for a logical retry. A post-save report-list refresh failure now reports sync availability separately without misreporting the successful write as failed.
- Added Product Analytics service and mounted lifecycle tests covering RPC payloads, permission controls, success/retry/rejection, duplicate-submit protection, and refresh-after-success behavior.

### Asset Tracking
- Added trusted transactional Asset lifecycle RPCs for quantity adjustment, inspection/correction, maintenance, and per-row import.
- Added `asset_lifecycle_requests` request-ID ledger semantics so retrying a logical lifecycle request returns its canonical result without duplicate balance, movement, inspection, maintenance, or import effects.
- Moved active browser multi-table lifecycle orchestration behind the authenticated RPC boundaries; permissions and outlet access are now server-authoritative for those operations.
- Kept mixed-file import behavior: each row is independently atomic and can report success or failure without duplicating a successful retry.
- Added Asset service and mounted lifecycle coverage for RPC mapping, request-ID reuse, rejection/retry, pending-submit guards, and import row authority.
- Documented residual P2 storage-orphan cleanup debt: uploads that precede a rejected RPC may orphan, but no partial database lifecycle state persists.

## 2026-08-11

### Roles / Permissions
- Replaced browser role, permission, and outlet multi-write save choreography with the transactional `save_role_configuration` RPC and `role_configuration_requests` idempotency ledger.
- Hardened mounted create, edit, duplicate, delegation-rejection, and disable flows for canonical retry IDs, truthful close/success behavior, and local rejection recovery.
- Confirmed protected-role, permission-delegation, outlet-delegation, UUID-preservation, and differential-reconciliation rules. Roles authority is frozen at 17/17 focused tests; active-session propagation and stale-editor handling remain P2 debt.

### Factory Product Recipe / BOM
- Added `save_factory_product_recipe` and `factory_product_recipe_requests` (migration 016) so Draft Recipe header and complete BOM replacement commit atomically with request-ID idempotency.
- Removed the active browser header-update/BOM-delete/BOM-insert save choreography. The Recipe modal owns retry-safe request IDs: unchanged retries reuse one ID, changed intent receives a new ID, and success clears it.
- Final hardening baseline: Product Recipe focused 11/11 and full suite 356/356. FeedX hardening is complete at P0=0/P1=0; accepted P2 debt remains documented.

## 2026-08-12

### Crew Learning Architecture Reset
- Reset Crew Learn to two operational product surfaces: mandatory New Crew Onboarding and the outlet SOP Library; generic Journey Library, manual assignment, and standalone Crew Progress navigation are retired from the primary UI without deleting historical data.
- Added Staging migrations `20260812012742_crew_learning_architecture_reset.sql` and `20260812015242_crew_learning_home_runtime_fix.sql` for outlet onboarding lineages, automatic enrollment, outlet SOP categories, independent setup cloning, permanent completed-onboarding access, outlet SOP discovery, and token-bound acknowledgement/read authorities.
- Added Staging migration `20260812021500_crew_learning_admin_outlet_visibility.sql` after real browser QA proved the existing outlet SELECT policy omitted Crew Learning/SOP roles. The policy is authenticated, read-only, permission-gated, and still requires canonical outlet scope.
- Adapted the existing Staging New Crew Onboarding to the documented eight-module structure while preserving the completed v1 assignment and immutable employee snapshots. The current published v2 snapshot contains all eight modules; eligible Crew enrollment is automatic.
- Rebuilt Admin Learning around one explicit Outlet context, Onboarding Overview/Modules/Crew Progress, a category-based SOP Library, editable module/lesson/block and SOP section drafts, and state-correct publish/new-version actions.
- Normalized PostgREST one-to-one Lesson→Quiz relations at the service boundary after real Staging lesson-editor smoke exposed the runtime object/array cardinality mismatch.
- Rebuilt Crew Mobile Learn so completed onboarding remains reviewable and all published outlet SOPs are searchable by category with required acknowledgements clearly surfaced.
- Added reusable Staging-only architecture adaptation and rollback-only behavior verification scripts. Real Staging verification passed 12/12 for clone independence, automatic enrollment, outlet isolation, safe payloads, completed history, SOP library access, and acknowledgements.
- No Production schema, data, or deployment was touched.

### Crew Growth Admin Foundation
- Added the Crew Growth workspace with Growth Overview, Skills, Crew Growth, and Certification Review routes using the shared Restaurant/Factory page, filter, table, badge, and modal foundation.
- Added outlet- and position-scoped Skills, versioned certification requirements, server-derived employee skill states, practical assessment history, immutable certification evidence, and optional renewal/expiry.
- Reused existing Onboarding module/lesson completion, exact SOP version acknowledgements, and Knowledge Check results as authoritative Growth evidence; the frontend does not calculate final certification eligibility.
- Added permissions `crew_growth.view`, `crew_growth.manage`, `crew_growth.assess`, and `crew_growth.certify`, fixed-search-path SECURITY DEFINER authorities, outlet checks, RLS, private internal helpers, and explicit removal of authenticated table DML grants.
- Applied Staging-only migrations `20260812115538`, `20260812121319`, `20260812121447`, `20260812122231`, `20260812123742`, `20260812125218`, and `20260812135044` to `fnb-system-staging`; the forward fixes cover RLS helper execution, PL/pgSQL/JSONB runtime ambiguity, least-privilege table grants, published same-outlet evidence references, and a lightweight Published evidence catalog for the Skill editor.
- Created an idempotent, Staging-guarded Growth QA seed with eight Skills and Certified, In Progress, Ready for Review, Not Started, and Not Applicable examples using only existing QA Crew identities. The seed preserves immutable Learning evidence and does not touch operational employees.
- Growth Staging behavior/security verification passed 12/12. No Reward, Performance rebuild, Production schema, Production data, or Production deployment was included.

### Crew Phase C — Performance + Customer Feedback
- Added the versioned monthly Performance Engine: Attendance 30, Service Standards 30, Customer Experience 15, Knowledge & SOP 15, and Conduct 10. Scores are server-derived from existing evidence, Manager criteria, and transparent sample-aware guest feedback; finalized results are immutable.
- Added outlet-scoped Service Standards and Conduct review history, audited feedback exclusion, a controlled public QR feedback flow, and token-bound Crew own-result reads with no manager notes, moderation data, or cross-employee controls.
- Added FeedX Admin Performance Overview, Reviews, and Customer Feedback routes plus Crew Mobile Growth → My Performance with monthly trend, component breakdown, and safe explanations. Reward remains a truthful Coming Soon surface.
- Applied Staging-only migrations `20260812154112_crew_performance_feedback_engine.sql` and `20260812155805_crew_performance_admin_payload_scope_fix.sql`. The corrective migration partitions consolidated Admin payload fields by Performance, Review, and Feedback permission.
- Created a guarded, reusable Staging QA seed for five scenarios: High Performer, Average, Needs Attention, Awaiting Review, and Insufficient Feedback. The seed uses controlled review/finalize/public feedback authorities and only `QA-CREW-*` employees.
- Real Staging backend/security checks passed 16/16 across ACL/RLS, own-result isolation, public feedback duplicate protection, sample confidence, immutable finalization, and field-level Admin permission scoping. No Production resource was touched.
# 2026-08-13 — Crew Phase D Reward

- Added the server-authoritative `reward-v1` monthly Reward engine with team Pool unlock, eligible-hours contribution, Performance factors, capped payout normalization, audited adjustments and immutable finalized snapshots.
- Added outlet-scoped Reward Overview and Reward Cycles Admin UI, plus token-bound Crew Mobile Reward estimates, calculation explanation and history.
- Applied `20260812163541_crew_monthly_reward_engine.sql`, corrective `20260812164410_crew_reward_mark_paid_runtime_fix.sql`, strict rounding/pool-cap hardening `20260812164932_crew_reward_strict_pool_cap.sql`, and PostgREST session-activity fix `20260812170155_crew_reward_mobile_runtime_fix.sql` to Staging only.
- Created reusable Staging-only Reward QA seed and rollback behavior/security verification scripts covering High Performer, Average, Needs Attention, part-time low-hours, Not Eligible and Awaiting Performance outcomes.

## 2026-08-13

### Crew Daily Operations v1
- Added outlet-scoped Opening, Closing, Daily and Store Health checklist templates with immutable active revisions, whole-template Draft saves, optional position applicability, time windows and pinned Published SOP references.
- Added server-generated daily checklist instances with frozen template/item snapshots, server-derived Not Started/In Progress/Completed/Completed With Exceptions/Overdue state, multi-Crew first-writer item evidence and required-item completion gating.
- Added one-time Daily Tasks and lightweight Store Health outcomes. Exceptions require a controlled reason; Needs Attention Health results require a note and remain operational evidence rather than automatic Performance deductions.
- Added FeedX Admin Daily Operations monitoring, Checklist Template management and read-only historical detail, plus Crew Mobile Home → Today’s Tasks, checklist execution, exception capture, SOP reading and sticky checklist completion without adding a sixth bottom-navigation item.
- Applied Staging-only migrations `20260812171446_crew_daily_operations_v1.sql` and `20260812172437_crew_daily_operations_employee_context_fix.sql` to `fnb-system-staging`. The corrective migration resolves an employee-context PL/pgSQL ambiguity found by real database behavior testing.
- Added idempotent Staging-only Friends Corner QA seed data: eight-item Opening and Closing checklists, a ten-item Store Health check and six one-time Daily Tasks covering completed, pending, exception, overdue and Needs Attention states. No QA Crew passcode was changed.
- Real Staging rollback behavior/security verification passed 22/22, including snapshot immutability, outlet/role scope, token identity, first-writer concurrency, required gating, exceptions, Health evidence, direct-table denial and unauthorized Admin rejection.
- Photo evidence remains intentionally disabled in v1 until Daily Operations has a dedicated controlled media store and reference-safe deletion lifecycle; no base64 or Learning-media reuse was introduced.
- Added corrective Staging migrations `20260812181200_crew_daily_operations_business_date_fix.sql` and `20260812181500_crew_daily_operations_business_date_default_fix.sql` after authenticated midnight smoke testing exposed UTC-date drift. The follow-up keeps the internal date helper revoked while making anon-callable RPC defaults evaluate without caller execute rights. Admin, Crew Mobile, default RPC behavior and QA seeds now use the Malaysia business date consistently.
