# Crew Production release candidate — 29 September 2026

Status: **revised Production schema applied; scoped frontend delivery follows this manifest**. The candidate is based on Production `origin/main` `41cc89fb`; canonical Staging is `origin/dev` `f313757c`. Database identities were checked explicitly: Production `oyfobxdoyfuzsodogpgs`, Staging `ujkzdaaadnvcfayuldmh`. The first Production migration attempt failed without persisting a change. The approved two-phase [Production compatibility plan](2026-09-29-crew-production-compatibility.md) then applied all 22 listed versions successfully on 29 September 2026. Use only the revised gateway migration in the table below.

## Database parity decisions

- **PO source reservation:** Production ledger `20260927152000` and Staging ledger `20260927151034` differ in version/transaction wrapper. The live reservation function, table-column signature, constraint signature, RLS state, trigger definition and table grants match exactly. Production already has the replacement authority. Do **not** replay either version or Staging's superseded `20260924003727` unique-index migration.
- **People / roster ledger identities:** Staging-generated versions for the Payroll employment timeline/scope and roster dated-employment series differ from Production ledger IDs `20260929042209`, `20260929042803`, `20260929050707`, `20260929051529`, `20260929051713`, `20260929052542`. Live definitions match for the period employment resolver/scope functions, dated roster eligibility and picker, roster publication, direct-write eligibility, and the three restrictive duty-roster policies. No replay or ledger repair is required for this Crew release.
- **Crew Inventory:** the canonical PO and PO-item table column signatures match; Production lacks the Crew gateway and follow-up RPC chain. Stock Check, Crew Access and Management access table signatures differ as expected from unapplied Crew migrations.
- **Team Review:** Production lacks the Team Review tables/RPCs and Job Position participation column. Its older Peer Review authority remains present.
- **Letters & Notices:** Production lacks the type catalog and `document_type`/`body` columns; the Crew/Admin disciplinary RPC definitions differ.
- **Performance:** `20260929055243` is ledgered in both environments. The two-argument wrapper currently matches, but Production's three-argument refresh function still reads Peer Review. Applying the older Team Review domain migration after the already-ledgered Performance migration can replace the wrapper temporarily. The new forward migration below restores both overloads and the period-correct Team Review calculation without editing or replaying `20260929055243`.

## Ordered Production migration manifest

“Absent” means the required equivalent object or change is not in the current Production database. The order below is **execution order for this Production baseline**, not an instruction to replay every historical filename. Each SQL file must be reviewed against a fresh Production schema snapshot immediately before approval/execution.

| # | Migration | Purpose | Prerequisite | Production equivalent | Action | Recovery consideration |
|---:|---|---|---|---|---|---|
| 0 | `20260927152000` PO reservation | Canonical source/supplier concurrency guard | Existing PO tables | **Yes** | Skip; verify live signature | Preserve existing reservation rows/trigger |
| 0 | People/roster dated-employment series listed above | Period employment and roster eligibility | People timeline | **Yes** | Skip; verify live signatures/policies | No ledger-only repair |
| 1 | `20260929152648_crew_inventory_gateway_production_compat` | Token-bound Inventory scope, grants, operations while preserving the Production PO read RPC and business numbering | Existing Inventory + reservation and PO numbering authority | Partial: PO read RPC already exists | Apply **alone in phase 1** after its catalog guard passes | Snapshot schema; restore/forward-fix authority on failure |
| 2 | `20260924012120_crew_inventory_mobile_catalog` | Crew catalog projection | 1 | No | Apply | Forward fix; no item rewrite |
| 3 | `20260924040846_restore_management_crew_access_page` | Restore Management access paging after gateway | 1 | No | Apply | Verify Admin paging before continuing |
| 4 | `20260924043131_crew_inventory_mobile_item_photos` | Canonical item imagery | 1–2 | No | Apply | Forward fix; retain media references |
| 5 | `20260924051027_crew_purchase_suggestion_context` | Stock Check to PO context | 1–2 | No | Apply | No duplicate source orders |
| 6 | `20260924070000_crew_purchase_order_reopen_draft` | Controlled PO draft reopen | 1; PO reservation | No | Apply | Preserve PO/audit rows |
| 7 | `20260924070001_crew_stock_check_result_images` | Result imagery and count evidence | 1–2 | No | Apply | Preserve check evidence |
| 8 | `20260924185540_crew_home_po_category_summary` | Home PO attention/category read | 1–2 | No | Apply | Read projection can be forward-replaced |
| 9 | `20260924191411_crew_purchase_order_mobile_consolidation` | PO detail/lifecycle projection | 1, 5–6, 8 | No | Apply | Preserve receipts and movements |
| 10 | `20260924200447_crew_stock_check_lifecycle` | Due/missed/skipped and audit lifecycle | 1, 7 | No | Apply | Preserve immutable check events |
| 11 | `20260924202520_crew_stock_check_history_dedupe` | One scheduled occurrence in read projection | 10 | No | Apply | No historical-row deletion |
| 12 | `20260928113201_team_review_domain` | Team Review tables, window, RPCs and Peer grant cutover | Existing V2/cron; People/roster parity | No | Apply in coordinated Crew cutover | Creates launch/window authority; old Peer grants revoked; keep schema backup and a forward compatibility plan |
| 13 | `20260928182323_team_review_position_roster_eligibility` | Position opt-in and dated roster pairs | 12; People/roster parity | No | Apply | Position flags default off; no implicit eligibility |
| 14 | `20260929040148_team_review_position_freeze_boundary` | Freeze before Position policy change | 13 | No | Apply | Preserve frozen pair snapshots |
| 15 | `20260929061618_crew_performance_team_review_period_outlet` | Period/outlet Team Review adapter | 12–14; existing period employment resolver | No | Apply | Existing finalized Performance remains pinned |
| 16 | `20260929113909_employee_letters_notices_types` | Type catalog, warning-compatible columns/RPCs | Existing disciplinary authority | No | Apply | Backfills existing warning bodies; capture backup and verify row counts/content |
| 17 | `20260929114112_employee_letters_notices_warning_field_shape` | Warning field constraints | 16 | No | Apply | Forward correction if legacy shape conflicts |
| 18 | `20260929114348_employee_letters_notices_permission_copy` | Permission catalog copy | 16 | No | Apply | Verify existing role permissions unchanged |
| 19 | `20260929114600_employee_letters_notices_transition_copy` | Receipt/transition copy and compatibility | 16–18 | No | Apply | Preserve issued records and events |
| 20 | `20260929130427_crew_inventory_month_history` | PO/Stock Check two-month status and paged History | 1–11 | No | Apply | Read-only history; older data retained |
| 21 | `20260929132630_crew_stock_check_history_check_date_month` | Check-date bucketing and terminal-detail limit | 20 | No | Apply | Completion timestamp remains evidence; never rewrite checks |
| 22 | `20260929140954_crew_performance_team_review_forward` | Replace both refresh overloads after Team cutover | 12–15; existing `20260929055243` | No | Apply last | Forward-only; finalized results return unchanged; preserve pre-change function definitions for recovery |

The superseded `20260924003727` index, Staging's `20260927151034` reservation ledger entry, and colliding Staging gateway `20260924004820` are **excluded**. No migration is to be marked applied solely to align version IDs. Apply rows 2–22 only in phase 2 after phase 1 succeeds and its gateway signatures are verified. A single chronological push of the combined package is not valid for this Production baseline because the new forward gateway version sorts after its dependents.

## Cutover and recovery

Take a verified Production schema/data recovery point and save pre-change definitions/grants before the first mutation. Apply the compatibility gateway alone, verify it, then apply rows 2–22 in one governed maintenance window with exact environment confirmation. Team Review's base migration revokes old Peer RPC grants, so coordinate the Crew frontend deployment closely with the schema cutover; do not leave Production on the old Peer UI for an extended interval. Check migration status and security grants after each dependency group. Stop on any mismatch. Recovery is a database restore or explicitly reviewed forward correction, not deletion of audit/history rows or blind down-migration. Do not copy Staging fixtures to Production. Roll back the frontend separately only after confirming its compatible backend authority.

## Candidate verification (before Production approval)

QA level: **L3 Canonical / Production release preparation**. The isolated Production-based candidate built successfully with `npm run build`; `node scripts/verifyAppBundle.mjs` passed Crew/Admin lazy-ownership and workspace boundary assertions; `git diff --check` passed. Focused Crew UI, route, ownership, Inventory/History, Team Review, Letters & Notices, Performance and access migration contracts ran **713 passed / 1 failed**. The lone SOP Library Admin assertion at `CrewSopLibraryPage.test.jsx:369` also fails in the unchanged current dev checkout and concerns a version popover's DOM containment; no candidate change to that page or test exists. New local browser fixtures for Team Review, submitted Cash Checkout and Growth/Performance presentation passed **12/12** across English 320px, Malay 390px and Chinese 430px, including light/dark Cash states.

Read-only live database parity checks compared function definitions, columns, constraints, trigger, grants and RLS/policy expressions as described above. They do not execute these migrations on Production. This paragraph records the initial pre-Staging assessment; the Production-based composition was subsequently verified on canonical Staging before the first cutover attempt. The compatibility adapter does not change frontend behavior or contracts. Recheck live Production signatures and dry-run the explicit migration set immediately before any newly approved mutation. Do not create Production-like rows solely for coverage.

## Scope guard

This candidate starts at Production `main` and selects Crew files and narrow Crew entries in shared routing/module files. It leaves `src/app/AdminApp.jsx` and `src/layouts/AppShell.jsx` at Production state; their unreleased dev deltas are Guest AI. It omits dev's Guest AI, Factory, Restaurant, Payroll, Reporting and unrelated Admin code and migrations. The People/roster and PO reservation objects required by this release are already equivalent in Production and are deliberately excluded from the apply set.
