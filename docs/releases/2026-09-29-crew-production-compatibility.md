# Crew Production migration compatibility audit — 29 September 2026

Production `oyfobxdoyfuzsodogpgs` and `main` `41cc89fb` were not changed by this audit. The failed gateway attempt persisted no migration. Frontend release candidate `b9cb5581e08fb59b01c25a0d90fe5e9aaf514392` remains the intended scoped code.

## Root cause and resolution

Production migration `20260924092947_purchase_order_business_number` already created `public.crew_inventory_purchase_orders(text,uuid,uuid)`. The Staging gateway migration `20260924004820_crew_inventory_gateway` uses plain `CREATE FUNCTION` for that exact signature, so PostgreSQL aborts before the rest of the gateway can be applied. Production and Staging PO business-number columns, sequence, functions, triggers and unique index have matching live definition hashes. The existing Production PO read RPC also has the reviewed business-number-aware definition. Replacing it with the older Staging gateway body would discard newer behavior.

`20260929152648_crew_inventory_gateway_production_compat.sql` carries the gateway DDL and grants but omits only the conflicting PO read function declaration. An opening guard checks the exact reviewed Production PO function definition hash, non-null business number, sequence, unique index, numbering functions and triggers. A mismatch aborts before gateway changes. The `20260924051027` intermediate read replacement does not project `business_po_no`; later replacements restore it, and the final canonical read authority is applied by the month History migration. Keep phase 2 and deployment in a coordinated maintenance window so the intermediate projection is not relied upon. The original gateway SQL remains on the Staging/dev lineage and is removed from this Production candidate package.

## Current Production catalog collision audit

All 22 approved migration files were parsed at top-level SQL statement boundaries and checked in execution order against the current Production catalog snapshot. Full input type signatures, input argument names and return types were compared for existing functions; named tables, columns, constraints, indexes, triggers, grants and revokes were inspected. No migration creates a policy, type, view or sequence. Eight Team Review tables and one Letters & Notices type table are new, with RLS enabled and direct table grants revoked. `pg_cron`, `cron.schedule(text,text,text)` and `cron.unschedule(bigint)` exist; the Team Review freeze job name is absent. The four legacy constraints that will be replaced exist. Existing Warning rows: zero.

| Migration | Functions declared | Other catalog operations | Privilege statements | Collision result |
|---|---:|---|---:|---|
| `20260929152648` | 17 | 2 ALTER TABLE | 4 | None after gateway adaptation |
| `20260924012120` | 2 | — | 2 | None after gateway adaptation |
| `20260924040846` | 1 | — | 2 | None after gateway adaptation |
| `20260924043131` | 2 | — | 0 | None after gateway adaptation |
| `20260924051027` | 1 | — | 0 | None after gateway adaptation |
| `20260924070000` | 3 | — | 0 | None after gateway adaptation |
| `20260924070001` | 1 | — | 0 | None after gateway adaptation |
| `20260924185540` | 1 | — | 0 | None after gateway adaptation |
| `20260924191411` | 4 | — | 1 | None after gateway adaptation |
| `20260924200447` | 5 | 4 ALTER TABLE, 1 trigger | 3 | None after gateway adaptation |
| `20260924202520` | 1 | — | 0 | None after gateway adaptation |
| `20260928113201` | 15 | 8 table, 2 index, 10 ALTER TABLE | 27 | None after gateway adaptation |
| `20260928182323` | 3 | 1 ALTER TABLE | 4 | None after gateway adaptation |
| `20260929040148` | 1 | 2 ALTER TABLE, 1 trigger | 1 | None after gateway adaptation |
| `20260929061618` | 3 | — | 3 | None after gateway adaptation |
| `20260929113909` | 9 | 1 table, 6 ALTER TABLE, 1 index | 6 | None after gateway adaptation |
| `20260929114112` | 0 | 1 ALTER TABLE | 0 | None after gateway adaptation |
| `20260929114348` | 0 | — | 0 | None after gateway adaptation |
| `20260929114600` | 2 | — | 3 | None after gateway adaptation |
| `20260929130427` | 5 | 3 index | 4 | None after gateway adaptation |
| `20260929132630` | 2 | — | 0 | None after gateway adaptation |
| `20260929140954` | 2 | — | 2 | None after gateway adaptation |

The original gateway alone had one hard collision: `public.crew_inventory_purchase_orders(text,uuid,uuid)`. The other 20 Production-present target function signatures are intentional `CREATE OR REPLACE` targets; all match declared argument names and return types. Existing Peer Review and disciplinary grant/revoke targets also resolve. All new table, column, index and trigger names are absent in Production. Each constraint drop target exists in Production or is created earlier in this ordered chain. The Team Review participation flag is absent and defaults false; the migration explicitly opts in Service Crew. PO source-reservation and People/roster version differences were checked by live schema equivalence and remain skipped. `20260929055243` is already ledgered but its Production three-argument Performance refresh still reads Peer Review; `20260929140954` supplies the approved forward Team Review replacement.

### Function declarations inspected, with full input signatures

**`20260929152648_crew_inventory_gateway_production_compat.sql`**

- `public.crew_special_access_for_outlet(uuid,uuid)` (replace)
- `inventory_authority.stock_group_due(public.inventory_stock_check_groups,date)` (create)
- `public.crew_inventory_stock_checks(text,uuid,uuid)` (create)
- `public.crew_inventory_attention(text,uuid)` (create)
- `public.crew_update_inventory_special_access(uuid,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean)` (create)
- `public.crew_update_management_inventory_special_access(uuid,uuid,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean)` (create)
- `public.crew_inventory_special_access_admin(uuid)` (create)
- `public.crew_management_special_access_admin(uuid)` (replace)
- `public.crew_access_admin_page(uuid,jsonb,integer,integer)` (replace)
- `public.crew_outlet_scope(text)` (replace)
- `inventory_authority.crew_scope(text,uuid,text)` (create)
- `public.crew_inventory_save_stock_check(text,uuid,uuid,jsonb,jsonb)` (create)
- `public.crew_inventory_delete_audit_draft(text,uuid,uuid,uuid)` (create)
- `public.crew_inventory_save_purchase_order(text,uuid,uuid,jsonb,jsonb)` (create)
- `public.crew_inventory_create_stock_check_purchase_orders(text,uuid,uuid,uuid,jsonb)` (create)
- `public.crew_inventory_transition_purchase_order(text,uuid,uuid,uuid,text)` (create)
- `public.crew_inventory_receive_purchase_order(text,uuid,uuid,uuid,text,jsonb)` (create)

**`20260924012120_crew_inventory_mobile_catalog.sql`**

- `public.crew_outlet_scope(text)` (replace)
- `public.crew_inventory_mobile_catalog(text,uuid)` (create)

**`20260924040846_restore_management_crew_access_page.sql`**

- `public.crew_access_admin_page(uuid,jsonb,integer,integer)` (replace)

**`20260924043131_crew_inventory_mobile_item_photos.sql`**

- `public.crew_inventory_mobile_catalog(text,uuid)` (replace)
- `public.crew_inventory_stock_checks(text,uuid,uuid)` (replace)

**`20260924051027_crew_purchase_suggestion_context.sql`**

- `public.crew_inventory_purchase_orders(text,uuid,uuid)` (replace)

**`20260924070000_crew_purchase_order_reopen_draft.sql`**

- `inventory_authority.transition_purchase_order(uuid,uuid,text,text,uuid,uuid,uuid,text)` (replace)
- `public.inventory_transition_purchase_order(uuid,uuid,text,text)` (replace)
- `public.crew_inventory_transition_purchase_order(text,uuid,uuid,uuid,text)` (replace)

**`20260924070001_crew_stock_check_result_images.sql`**

- `public.crew_inventory_stock_checks(text,uuid,uuid)` (replace)

**`20260924185540_crew_home_po_category_summary.sql`**

- `public.crew_inventory_purchase_orders(text,uuid,uuid)` (replace)

**`20260924191411_crew_purchase_order_mobile_consolidation.sql`**

- `inventory_authority.crew_recent_source_check(uuid,uuid)` (replace)
- `public.crew_inventory_save_purchase_order(text,uuid,uuid,jsonb,jsonb)` (replace)
- `public.crew_inventory_create_stock_check_purchase_orders(text,uuid,uuid,uuid,jsonb)` (replace)
- `public.crew_inventory_purchase_orders(text,uuid,uuid)` (replace)

**`20260924200447_crew_stock_check_lifecycle.sql`**

- `inventory_authority.protect_completed_stock_check()` (replace)
- `inventory_authority.protect_completed_stock_check_item()` (replace)
- `inventory_authority.guard_scheduled_stock_check_date()` (create)
- `public.crew_inventory_skip_stock_check(text,uuid,uuid,uuid,text)` (create)
- `public.crew_inventory_stock_checks(text,uuid,uuid)` (replace)

**`20260924202520_crew_stock_check_history_dedupe.sql`**

- `public.crew_inventory_stock_checks(text,uuid,uuid)` (replace)

**`20260928113201_team_review_domain.sql`**

- `public.crew_team_review_mean(jsonb)` (create)
- `public.crew_team_review_live_subjects(uuid,date)` (create)
- `public.crew_team_review_live_pairs(uuid,date)` (create)
- `public.crew_team_review_window(uuid,date)` (create)
- `public.crew_team_review_freeze(uuid,date)` (create)
- `public.crew_team_review_freeze_due()` (create)
- `public.crew_team_review_window_control(uuid,date,text,date,text)` (create)
- `public.crew_team_review_result(uuid,date)` (create)
- `public.crew_team_review_performance_component(uuid,date)` (create)
- `public.crew_team_review_mobile(text,date)` (create)
- `public.crew_team_review_submit(text,date,uuid,jsonb,text)` (create)
- `public.crew_team_review_admin(uuid,date)` (create)
- `public.crew_team_review_exclude(uuid,text)` (create)
- `public.crew_team_review_admin_assess(uuid,date,jsonb)` (create)
- `public.crew_refresh_performance(uuid,date)` (replace)

**`20260928182323_team_review_position_roster_eligibility.sql`**

- `public.crew_team_review_live_subjects(uuid,date)` (replace)
- `public.crew_team_review_live_pairs(uuid,date)` (replace)
- `public.crew_team_review_admin_dimensions(uuid,date)` (create)

**`20260929040148_team_review_position_freeze_boundary.sql`**

- `public.crew_team_review_freeze_before_position_change()` (create)

**`20260929061618_crew_performance_team_review_period_outlet.sql`**

- `public.crew_team_review_result_scoped(uuid,date,uuid)` (create)
- `public.crew_team_review_result(uuid,date)` (replace)
- `public.crew_team_review_performance_component(uuid,date)` (replace)

**`20260929113909_employee_letters_notices_types.sql`**

- `public.employee_disciplinary_guard()` (replace)
- `public.employee_disciplinary_admin_detail(uuid)` (replace)
- `public.crew_employee_disciplinary(text)` (replace)
- `public.crew_employee_disciplinary_detail(text,uuid)` (replace)
- `public.crew_employee_disciplinary_respond(text,uuid,text)` (replace)
- `public.crew_notification_on_warning_issued()` (replace)
- `public.employee_disciplinary_save_draft(uuid,uuid,jsonb,uuid,uuid)` (replace)
- `public.employee_disciplinary_issue(uuid)` (replace)
- `public.employee_letter_notice_type_options()` (replace)

**`20260929114112_employee_letters_notices_warning_field_shape.sql`**

- No function declaration.

**`20260929114348_employee_letters_notices_permission_copy.sql`**

- No function declaration.

**`20260929114600_employee_letters_notices_transition_copy.sql`**

- `public.employee_disciplinary_admin_transition(uuid,text,text)` (replace)
- `public.crew_employee_disciplinary_acknowledge(text,uuid)` (replace)

**`20260929130427_crew_inventory_month_history.sql`**

- `public.crew_inventory_purchase_order_history(text,uuid,date,text,integer,integer)` (create)
- `public.crew_inventory_stock_check_history(text,uuid,date,text,integer,integer)` (create)
- `public.crew_inventory_purchase_orders(text,uuid,uuid)` (replace)
- `public.crew_inventory_stock_checks(text,uuid,uuid)` (replace)
- `public.crew_inventory_purchase_orders_for_check(text,uuid,uuid)` (create)

**`20260929132630_crew_stock_check_history_check_date_month.sql`**

- `public.crew_inventory_stock_check_history(text,uuid,date,text,integer,integer)` (replace)
- `public.crew_inventory_stock_checks(text,uuid,uuid)` (replace)

**`20260929140954_crew_performance_team_review_forward.sql`**

- `public.crew_refresh_performance(uuid,date,boolean)` (replace)
- `public.crew_refresh_performance(uuid,date)` (replace)

## Revised ordered plan

1. Refresh the Production catalog snapshot and recovery point. Confirm the guard hashes, no new drift, and the phase 1/phase 2 dry-run lists. Stop on any mismatch.
2. Phase 1: apply **only** `20260929152648_crew_inventory_gateway_production_compat.sql` from a curated package that also contains all already-ledgered baseline migration files. Verify gateway signatures and grants. Do not mark `20260924004820` applied.
3. Phase 2: apply the 21 followups in the order of the [candidate manifest](2026-09-29-crew-production-candidate.md), rows 2–22, from the full revised package **including the now-ledgered adapter** and excluding the colliding original gateway. The adapter has a later version number, so a single chronological push of both phases is invalid. Use `--include-all` for the older followup versions and confirm the CLI's pending list before execution.
4. Verify final PO numbering/read authority, Inventory/outlet grants, Team Review/Performance authority, Letters & Notices and month History. Then merge only the scoped Crew candidate and deploy exact resulting `main` SHA, subject to **new explicit Production approval**.

Never replay schema-equivalent PO reservation or People/roster versions to align ledger IDs. Recovery is the verified database recovery point or a separately reviewed forward fix; preserve PO business numbers, audit events and existing records.

## Verification and limits

- Current Production catalog simulator: original chain fails on gateway statement 6 with the known signature collision; revised chain passes 194 statements across 22 migrations with zero object-existence/signature collisions. Counts: 80 function declarations, 9 tables, 14 columns, 7 explicit ADD CONSTRAINT, 6 indexes, 2 triggers, 43 REVOKE and 19 GRANT statements. Function input names and return types have zero mismatches against existing signatures.
- Supabase CLI `db push --dry-run --include-all` against the actual Production ledger: the curated phase 1 package selects only the adapter. A pre-cutover rehearsal package excluding the unledgered adapter selects exactly the 21 approved followups; after phase 1, phase 2 must instead use the full revised package with the adapter present and already ledgered. The CLI dry-run checks selection/ledger, not SQL execution. Do not infer executable chain success solely from it.
- The static catalog sequence check covers object collisions and named dependencies, not every data-dependent constraint or SQL runtime path. Final pre-cutover catalog and migration checks remain mandatory. Local Docker/Postgres replay was unavailable; no Production mutation was used as a test.
- No Crew frontend contract or behavior changed in the adapter. Existing Staging/frontend QA for `b9cb5581` remains applicable; no full frontend QA was repeated.
- The Production-specific adapter version is not in Staging's ledger; Staging already has the original gateway. Any later `main` to `dev` migration-file reconciliation must handle this version deliberately before a Staging `db push`. It is not part of this Production cutover.

Documentation Impact: release migration manifest updated; no domain/architecture documentation change because this is a Production ordering and compatibility correction with unchanged Crew contracts.
