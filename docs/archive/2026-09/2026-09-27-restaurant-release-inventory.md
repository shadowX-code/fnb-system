# Restaurant/Admin Production Release Inventory — 27 September 2026

## A. Production baseline

- Freshly fetched `origin/main`: `56029c15388dce0121454aec72bbe0313b7be70d`.
- Live Production deployment: `dpl_FVTWKdiCU3crRzZqNqTxPH5ypLJG`, READY, same SHA, main branch, Production project `prj_1UOKHvE6Ft4a2WXrZyZGc9LZRWLP`. Confirmed aliases include os.feedx.my, crew.feedx.my and feedx.my.
- Production Supabase: `oyfobxdoyfuzsodogpgs`; 449 applied migration ledger entries.
- Main ancestry is not a reliable pending-release list: earlier isolated releases integrated equivalent Restaurant/People changes under different commit identities. This audit uses current tree differences and the live ledger.

## B. Staging/dev baseline

- Local dev and freshly fetched origin/dev: `881ffdb3c66271ce3e3a15878b92b3fa25bcb1fd`.
- Canonical Staging deployment: `dpl_EVjJPu5ajH4ViRzcVFyP3iQS6wUX`, READY, same dev SHA and fnb-system-staging.vercel.app alias.
- Staging Supabase: `ujkzdaaadnvcfayuldmh`; 541 ledger entries.
- Existing Payroll-only candidate remains `c3d49099`, with current main as its direct base through the isolated application patch and subsequent font/presentation commits. Commit set: 08c43453, c4122f77, d583d90f, 6063a6c2, c3d49099.
- Payroll page, service, canonical renderer/font pipeline are byte-identical between that candidate and current dev. Later dev changes are shared filters/compliance or excluded experimental work, not new Payroll calculation changes.

## C. Already in Production

| Domain | Classification / evidence |
|---|---|
| Overview, Sales, Purchases, suppliers, operating-expense/reporting surfaces | ALREADY IN PRODUCTION; no pending application delta in these owners. Reporting All Outlets migration 20260922121308 is applied. |
| People master, factory workplace vs role/outlet scope | ALREADY IN PRODUCTION. Shared employee service/components already contain that ownership model; do not import Factory workspace changes again. |
| Legal Entities, employer assignment, Employment Documents/Agreement, Contract Workspace/preview | ALREADY IN PRODUCTION. Main mounts LegalEntityContractWorkspacePage; relevant domain components have no pending tree delta. Only Legal Entities filter presentation changes remain. |
| Food Handling submission, verification, expiry/evidence authority | ALREADY IN PRODUCTION; only employee-centric Admin read projection is pending. |
| Departments, Job Positions, Roles/permissions | ALREADY IN PRODUCTION domain authority; filter presentation is pending. Canonical assigned-employees Roles fix is already on main. |
| Restaurant/People/System canonical pathname and bookmark compatibility | ALREADY IN PRODUCTION. Main AdminApp consumes resolveAdminLocation/navigateAdminRoute. Do not cherry-pick historical routing commits again. |
| Existing Inventory, assets, recipes, PO read isolation, transfers/receipts | ALREADY IN PRODUCTION base authority. Pending refinements listed below. |
| Management Crew role-scoped context/Special Access and recent Dispatch corrective release | ALREADY IN PRODUCTION, preserved unchanged; not new Restaurant release payload. |

## D. Pending Restaurant delta

| Change | Effect | Classification |
|---|---|---|
| Shared Filter Bar/Select/Date Picker/floating-layer/segmented controls | Full-width toolbar, flexible search, bounded filters, All vocabulary, canonical wrapping/search/control interaction | NEEDS SMALL CLOSURE: e599fa6c authenticated visual desktop/narrow-width check remains incomplete. |
| Employees/Legal Entities/Departments/Positions/Roles filters | Canonical toolbar; concise unrestricted labels | READY WITH DEPENDENCY on shared toolbar closure. No table/domain redesign. |
| Controlled employee bank selector | Canonical Malaysia bank names; preserve unmatched historical values | READY; existing bank fields retained. Payroll bank read is RLS-constrained and not a readiness blocker. |
| Employee-centric Food Handling list | One row per employee; both requirement states; same requirement/status filtering; employee-level exclusive summary | READY WITH DEPENDENCY on new scoped read RPC and shared toolbar. Existing submission/review authority unchanged. |
| PO filters/date range and PO No. | Specific accessible outlet, separate shared toolbar, one date range, persisted canonical business number | READY WITH DEPENDENCY on canonical numbering and shared controls. |
| Shared Inventory lifecycle hardening | Trusted Admin commands, immutable completion evidence, source-locked PO conversion, receipt/movement idempotency | NOT READY for combined Production migration rollout: source/supplier uniqueness preflight fails on existing Production records. |
| Stock Check Groups | Outlet-scoped configuration-only shared table, compact schedule/scope, canonical actions | READY WITH DEPENDENCY on shared controls and integrated Inventory page. |
| Audit result valuation | Submission-time unit-cost snapshot; truthful missing value; signed variance; immutable full-result totals | READY WITH DEPENDENCY on audit-cost migration and Inventory lifecycle owner. |
| Par Levels | Filter-only toolbar; saved state/view toggle at content header; autosave unchanged | NEEDS SMALL CLOSURE: narrow authenticated visual check for e599fa6c. |
| Master Inventory, Stock Check, Recipes/Intelligence, movements/waste filters | Shared search/filter/date grammar; no domain authority changes | READY WITH DEPENDENCY on shared toolbar/date-range owner. |
| Payroll V1 | Profiles, time, calculation, supported statutory envelope/manual PCB, proration/unpaid leave, PH company benefit, immutable Finalize/correction, Draft/Final Payslips and own-current Crew access | READY WITH DEPENDENCY on exact 67-migration manifest, private prepared font assets and two scoped Edge functions; existing isolated candidate build/contracts pass. |
| Payroll-only outlet geography integration | state_code UI/read/write for canonical holiday applicability | READY WITH DEPENDENCY on Payroll geography migration; no inferred state/backfill. |

Excluded, not classified as Restaurant-ready: Guest AI, Google Reviews/Performance V2, unrelated Crew UI/localization/Tasks/Home/PWA and Crew Inventory gateway/mobile workflows. The exact 19 absent-Production excluded ledger entries are recorded in the JSON manifest. Withdrawn shift-swap introduction/removal/QA-session cleanup are excluded together.

## E. Exact migration manifest

The companion JSON is the authoritative ordered filename/version/SHA-256 inventory, with all 449 already-Production ledger entries and all excluded pending entries.

Batch A, chronological order:

1. 20260924001607_restaurant_inventory_authority_foundation.sql
2. 20260924003727_restaurant_inventory_source_po_uniqueness.sql
3. 20260924092947_purchase_order_business_number.sql
4. 20260924093140_purchase_order_business_number_overflow_guard.sql
5. 20260924112642_stock_check_audit_cost_snapshot.sql
6. 20260927131345_employee_compliance_employee_registry.sql

Batch B: 67 files, ordered in the companion manifest. This is the former 66-file Payroll chain **plus** 20260927124520_payroll_payslip_corporate_identity.sql. Includes the canonical Replacement Leave expiry dependency. Do not use an old 66-file release count.

Live ledger reconciliation: the current Staging ledger now uses repository versions for all 73 proposed migrations. Historical Payroll manifests retain eight earlier Staging aliases (including the original five discrepancies); they are historical mappings, not instructions to reapply/repair now. The new manifest records current observed versions. Never rewrite applied SQL or apply both aliases.

Local-only replay: restored the preserved Production-schema export into restaurant_release_replay_complete with required pgcrypto, uuid-ossp and btree_gist prerequisites. All 73 migration files applied successfully in chronological order. No business-data copy or Staging seed dependency. This proves schema compatibility against that export, not live-data success; the PO uniqueness blocker below prevents Production application as-is.

## F. Shared dependencies and isolation

Shared canonical owners are released, not duplicated page-local alternatives. The Date Range implementation is physically colocated in CrewAttendanceDateRangePicker but is the existing public FeedXDateRangePicker owner: its Clear action is a required shared dependency, not a Crew feature release.

Batch A includes no Factory/Guest AI feature files, no Crew mobile inventory components, no new Crew gateway migration. PO number SQL includes the canonical shared number projections; it does not install the Crew Inventory UI/gateway. Batch B adds only Payroll Crew Me/Payslips route/navigation/locales and its own scoped read. Existing Factory behavior remains at main.

Cumulative diff inspection: no Factory/Guest AI feature change; route/module deltas are Payroll and Crew Payslips only. Bank selector and canonical outlet geography are genuine People/Payroll dependencies. Dormant settlement compatibility schema remains from applied V1 history, without payment workflow/UI. No automatic PCB/payment/Finance feature is introduced.

## G. Production data/onboarding impact

**Blocking PO data:** read-only Production query found seven duplicate non-cancelled source-check/supplier groups, comprising 14 orders: 8 completed, 5 supplier_confirmed, 1 draft. The pending unique index includes completed orders; therefore it would fail. Do not silently cancel completed/confirmed orders or delete evidence. An approved non-destructive historical compatibility/duplicate-resolution design is required before this Inventory migration can ship. This audit does not choose which order is authoritative.

PO numbering freezes old Admin display identity into business_po_no, preserves historical three-digit values, and assigns future two-digit suffixes that expand beyond 99. Technical po_no remains. No renumbering after assignment. Production-data preflight must also confirm number backfill/uniqueness before application.

Payroll onboarding: Production has 59 employees; all 59 lack Legal Employer, 51 lack Joined Date. Do not infer either. Payroll setup requires employer; missing employment dates remain calculation blockers. Installing Payroll does not make existing employees Ready. No QA employee, salary, leave, holiday selection or policy is transferred.

Legal employer/role/outlet scope: existing authorities preserved; only explicit Admin setup may establish missing relationships. No Role expansion.

Compliance: no evidence rewrite, expiry change or permission broadening; group/filter/page/summary projection remains server-owned under existing employee/outlet authorization.

Holiday/Payroll: real Staging 2026 calendar and company choices are operational data, not migrations. Production must separately capture/review/publish official calendar and configure company policy; do not copy synthetic fixtures or silently adopt Staging configuration.

Audit valuation: older submitted results remain null-cost evidence, not retrospectively valued from today's item master.

Routing: existing bookmarks/host boundaries preserved; only new Payroll/Payslips routes added.

## H. Verification and remaining checks

Existing sufficient evidence:
- 14cb27a7: authenticated shared People/Inventory filters and Compliance one-row projection; combined requirement/status filter, canonical Review entry, 1024/1280 layout and permission checks. Rollback-only Compliance contract fixture; no persistent seed dependency.
- e599fa6c: 29 focused tests and build; autosave/failure/race/matrix interactions. Authenticated visual check was interrupted by browser tooling timeouts and is **not claimed passed**.
- Payroll retained evidence: qa/staging/payrollV1SupportedClosure.md, payrollPayslipV1.closure.md, payrollUnicodeRuntime.closure.md; supported statutory Finalize/correction, own-current Crew authorization and immutable evidence.
- Deployed Unicode closure records seven cold isolates plus one warm success, representative Chinese Monthly PDF 728,501 bytes, Latin Monthly 19,593 and Hourly 19,061 bytes; no reproduced CPU failure, A4/glyph verification. Current renderer is unchanged.
- Latest refined Payslip visual evidence retained locally at /private/tmp/feedx-staging-payslip-refined.png and feedx-payslip-long.png; renderer contracts and candidate parity remain green.
- Canonical membership previous dynamic Production-schema fixture and 11 finalized Staging read comparisons with zero membership mismatches; no new Finalize fixture required.

This audit's proportionate verification:
- Batch A build PASS; 18 focused files / 102 tests PASS.
- Original Payroll-only candidate build PASS; 37 files / 150 tests PASS.
- Cumulative A+B build PASS; 41 files / 185 tests PASS.
- Canonical Monthly/Hourly deterministic Unicode A4 renderer script PASS, 679,357-byte long representative result.
- Candidate diff checks PASS; no business behavior modified.
- Exact 73-file schema replay PASS with above export/data limitation.

Only narrow visual closure requested: authenticate current canonical Staging, inspect full-width People toolbars (one sparse page and Employees), Inventory toolbar wrapping and Par Levels Saved/view-toggle placement at normal desktop and narrower supported Admin widths; check overflow and console errors. Do not rerun statutory or full Inventory lifecycles.

Separately mandatory: approve/implement a non-destructive treatment for the seven historical PO duplicate pairs, then rerun that migration/data boundary only. No data mutation authorized by this audit.

## I. Recommended batching

Two coherent batches, not full dev:

- A: Restaurant Inventory + shared People/Compliance/Admin refinements.
- B: Payroll V1 + necessary People/geography + Crew Payslips.

Preferred A then B once A's blockers are closed. Payroll does not require A's Inventory schema: standalone c3d49099 remains a valid alternative if Payroll is separately authorized first. Do not deploy standalone c3d49099 after A, because it would omit A; use the cumulative candidate instead.

Release sequence for Payroll: exact SQL manifest → immutable content-addressed prepared font shards/manifest in private storage → payroll-payslips and payroll-holiday-updates scoped Edge functions/config → isolated application → authorized smoke. No automatic publication, transfer/payment or Finance action.

## J. Isolated candidates

| Candidate | SHA | Exact payload | Release status |
|---|---|---|---|
| A | 6da4f6ca868689d38ecd1f8e62188a1ced48dc4f | 52 changed files; six migrations; 2,004 additions / 819 deletions | NOT READY: uniqueness/data blocker + narrow visual closure |
| Payroll standalone | c3d49099 | Existing isolated Payroll commit set above; 67 migrations | READY WITH DEPENDENCY on governed schema/assets/function release and explicit Production authorization |
| B after A (cumulative rehearsal) | b78d242e85c38b6901c77cbe580a2700f4c406f5 | 417 cumulative files including 211 prepared font shards; 73 total migrations; clean merge of the two isolated candidates, no dev merge | NOT READY as cumulative release until A blockers close; Payroll-specific tests/build PASS |

Exact included files and SHA-256 hashes, per-batch deltas and ordered migrations are in 2026-09-27-restaurant-release-manifest.json. Candidates are local attached managed worktrees, not pushed/deployed. main/dev remain unchanged. The audit/report files are uncommitted release evidence.

## K. Final recommendation

RESTAURANT PRODUCTION RELEASE = NOT READY

Reason: an actual Production uniqueness precondition fails, not merely missing visual evidence. Close the historical PO compatibility decision/migration and the narrow e599fa6c visual gate before approving the full Restaurant payload. Payroll V1's completed financial/Unicode work is preserved and need not be reopened.

No Production/Staging data mutation, deployment or main merge was performed.

Documentation Impact: Updated docs/releases/2026-09-27-restaurant-release-inventory.md and companion manifest — audit/release evidence only; canonical domain behavior unchanged.

