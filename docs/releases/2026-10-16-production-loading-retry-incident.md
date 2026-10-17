# Production loading degradation - 16 October 2026

Status: scoped Production recovery VERIFIED after separate explicit approval of both corrections. Planner retry storm stopped at 06:41:55 UTC; authorization plan correction applied at 07:17:24 UTC. Authenticated complete reads and representative pages recover; no 57014/40001 or pool-acquisition errors appear in the inspected 07:18-07:28 UTC window. This is bounded recovery acceptance, not a sustained-load guarantee. Earlier pending/failed sections below are chronological incident evidence, superseded by the final execution receipt.

## Confirmed cause and impact

Planner's `marketing_planner_command(uuid,uuid,uuid,text,uuid,integer,jsonb)` rejects a stale task revision using engine serialization SQLSTATE `40001`. Production logs show the identical `Task changed. Reload before continuing.` rejection repeatedly on the same PostgREST backends, without corresponding new HTTP requests. Between 05:00 and approximately 06:27 UTC, 451,838 such errors were observed; the first observed error was 05:04:45 UTC / 13:04:45 Malaysia. Several full minutes contain about 6,000 errors across three processes.

This matches Supabase's documented PostgREST transaction retry defect: https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b . The exact installed PostgREST version was not exposed by the inspected health metadata/logs. The observed loop, its SQLSTATE, function, process identities and repeated transactions are verified directly.

Severity: SEV2 shared Production degradation. No data corruption was established. API logs and PostgreSQL `57014` errors identify complete Product Analytics reads, Purchase/Sales bootstrap, inventory stock-check reads, Ads reporting and roster reads as affected. PostgREST logs also show connection-pool acquisition timeouts and request-thread timeout termination. This is not a global `max_connections` exhaustion or a lock blocker: the sampled database had 31/60 connections, seven active backends, no blocked queries and no idle-in-transaction sessions. These are point-in-time observations, not proof that contention never occurred earlier. OS CPU utilization was not independently measured.

For 04:30-06:30 UTC, before versus after the first observed loop:

| API path | Earlier successful mean | Later successful mean | Later failure evidence |
|---|---:|---:|---|
| product_sales_items | 1,081 ms | 5,608 ms | 114 HTTP 500s, mean 10,354 ms; max 27,235 ms |
| purchase_records | 1,620 ms | 3,349 ms | 15 HTTP 500s, mean 9,437 ms; max 13,545 ms |
| inventory_stock_check_items | 2,262 ms | 5,721 ms | 139 HTTP 500s, mean 10,728 ms; max 26,519 ms |

These are logged upstream durations, not browser end-to-end timings. A separate successful Product Sales request reached 29,911 ms and Inventory reached 31,745 ms. PostgreSQL timeout logs independently name these tables. Counts/latencies describe the bounded inspection window, not the entire incident.

## Hosting, workers and dependencies

- Production Vercel was READY at `2b1e290c50991b8372e73081c7694b17d5bb173a`, deployment `dpl_9ib7QJRaiBnKSKe9KX6J11fqybJj`; canonical Product Analytics HTML returned 200 in 0.329 seconds. The latest deployment began 05:59:22 UTC, after the loop was already present. No causal attribution to that media-picker release is supported. Supabase control-plane status was ACTIVE_HEALTHY despite query degradation.
- No Vercel runtime error groups were returned for the supported recent window. This Vite application performs the affected data reads directly against Supabase, not through Vercel Functions. The wider log query exceeded Hobby retention and was corrected to a recent window.
- Edge logs in the inspected window showed 287 function invocations with HTTP 200, with maximum execution 87,010 ms. This does not prove each internal operation succeeded. Job 11 remains active every minute; its 60 recent database dispatches succeeded, mean 0.29 seconds, max 5.52 seconds. Dispatch duration is not downstream Edge/provider execution duration.
- Job 12 remains active every ten seconds; 340 dispatches succeeded and three reported job-startup timeout in the sampled hour. No scheduler change is justified by this evidence; the demonstrated looping processes are Planner PostgREST backends, not either cron worker.
- `AdminApp` eagerly loads eight shared datasets through `Promise.allSettled`. Purchase's joined, unscoped `listPurchaseRecords` query can delay publishing the successful Outlet bootstrap and emits the global Purchase banner on rejection. It does not supply Product Analytics' product totals.
- Product Analytics independently loads accessible report metadata and complete current/comparison plus yearly item scopes. Exact-count paged reads are report-indexed, with bounded service concurrency. All required scopes must settle before totals are displayed. These queries time out under shared load, and SDK retries can prolong visible loading. No incomplete collection, zero fallback, increased timeout or new retry was introduced.
- Product Items has its report index and Purchase has its outlet/year/month index. Metadata estimates roughly 6,013 Product Items and 602 Purchases. A non-ANALYZE, privileged planner inspection selected the report index for report-scoped Product Items; it does not measure authenticated RLS runtime. Cumulative statement statistics date from May and were not misrepresented as incident-only CPU measurements. Residual RLS/query cost should be remeasured after clearing the loop before broader optimization.

## Staging correction and verification

Only migration `20261016062921_marketing_planner_nonretryable_revision_conflict.sql` was applied to verified `ujkzdaaadnvcfayuldmh`. It patches exactly the known conflict clause from `40001` to `PT409`; it preserves the installed function body instead of overwriting newer workflow changes. Signature, SECURITY DEFINER, search path, ACL, revision check, error message, request fingerprint and lifecycle behavior remain intact. Anonymous execution remains denied; authenticated/service grants are unchanged.

Migration SHA-256: `b6cfce52165787f506db88357841c9a7a84f3b31a8f2cd9a96efd91138de0170`.

Reversing only this clause in the applied Staging definition reproduces its exact pre-migration MD5 `8a1fd52030337a96843a672dd9e0ddbb`. The post-migration MD5 is `b063b201b3f31d3b24d03ecac2ea95fe`.

L3 verification: `qa/staging/marketingPlannerConflict.rollback.sql` passed three stale rejections, a valid current-revision transition, exact request replay and foreign-Brand denial under the authenticated role. All synthetic users, employees, tenant/Brand and task changes rolled back; zero residual fixtures were verified. SQLSTATE was verified directly; HTTP 409 mapping follows PostgREST's documented PT convention, not a claimed browser mutation test. All 58 focused existing Planner and Product Analytics tests passed. No application/Edge Function change requires a new frontend build or deployment. `git diff --check` passed.

## Exact Production approval requested

1. Apply only the checksum-pinned forward migration to `oyfobxdoyfuzsodogpgs`, after revalidating its current function and migration ledger. No broad pending-migration push, function-body replacement from another environment, schema reset or database configuration change.
2. Separately revalidate and terminate only these confirmed looping PostgREST backend identities. Do not substitute a PID or terminate another session without renewed approval:

| PID | backend_start (UTC) | Required current identity |
|---|---|---|
| 1883101 | 2026-10-16 05:03:57.776069+00 | authenticator / postgrest / marketing_planner_command with correlated repeated 40001 |
| 1887993 | 2026-10-16 05:55:20.017372+00 | same |
| 1888212 | 2026-10-16 05:55:43.699146+00 | same |

Termination disconnects those failed in-flight requests and rolls back any current uncommitted work. It does not rewrite committed records, but is an operational Production mutation and remains unexecuted. Supabase documents that changing the function alone does not stop already-looping transactions. No project-wide restart is requested.

3. Verify error rate/pool recovery and authenticated complete Product Analytics/Purchase reads, preserving row counts/totals. Reassess any residual latency rather than claiming the Staging test restored Production.

The preceding approval-request section records the pre-approval diagnosis. The execution receipt below supersedes its pending-action status, not its historical observations.

## Approved Production execution receipt

Explicit approval covered only the checksum-pinned migration and guarded termination of the three recorded identities. Production function before/after MD5 matched the verified Staging pair exactly. Reversing only PT409 to 40001 reproduces the pre-migration definition, proving revision authority, permission checks and valid transition implementation were not otherwise changed. Owner, ACL, SECURITY DEFINER and search_path remained identical.

The migration tool applied the approved SQL at 06:41:55 UTC and generated ledger version `20261016064155`. Only that exact new row's version was normalized to the approved local/Staging identity `20261016062921`, with guards on name, statement and destination absence. Final ledger contains one `marketing_planner_nonretryable_revision_conflict` migration at `20261016062921`; no other migration was applied.

All three recorded PID/backend_start/user/application/query-ID identities still matched immediately before applying the correction. Recent correlated logs contained 5,308, 4,722 and 4,664 identical conflicts respectively between 06:39:00 and approximately 06:41:34 UTC. At 06:41:55, each returned exactly one PT409. They exited before the identity-guarded termination statement ran: it matched zero rows and terminated zero sessions. At 06:42:25 and 06:44:21, none of the approved PIDs remained. No substitute or unrelated PID was terminated.

No further Planner 40001 loop appeared in the inspected 06:42-06:44:15 UTC database log window. This is bounded evidence of storm cessation, not proof that general database/API error rates normalized. That window still contained nine SQLSTATE 57014 statement timeouts (six Product Items, two Purchase, one Stock Check Items) and 18 PostgREST timeout-message matches. A separate 42803 was caused by an audit aggregate query, corrected read-only, and is not an application failure.

### Read-only Production acceptance

Authenticated browser checks used the existing Owner session without credential/grant changes or business mutation actions. Product Analytics was reloaded once after correction; its global Purchase bootstrap succeeded for that load, but complete current/comparison/year analytics ended with the canonical incomplete-read error and no totals. A fresh Ads page rendered Reporting Ready and metrics; its separate Purchase bootstrap failed. Duty Roster rendered JYMT's published 12-18 October week, five scheduled staff and 244 hours. Stock Check rendered its completeness error, naming an `inventory_item_outlets` statement timeout. No repeated manual Retry/Reload cycle was performed.

Logged API results for the bounded 06:42-approximately 06:44 UTC inspection (upstream duration, not browser total):

| Read | HTTP 200 count / mean ms | HTTP 500 count / mean ms | Acceptance |
|---|---:|---:|---|
| Product Items | 60 / 4,676 | 6 / 8,232 | FAIL: complete analytics unavailable |
| Purchase Records | 1 / 7,183 | 2 / 8,206 | FAIL: intermittent bootstrap remains |
| Stock Check Items | 11 / 5,110 | 2 / 8,106 | FAIL: inventory completeness unavailable |
| Ads read RPC | 2 / 5,296 | 0 | Representative read PASS, still slow |
| Roster read RPC | 6 / 589 | 0 | Representative read PASS |

Fresh authenticated Production Planner navigation also rendered the October list and summary (39 tasks, seven In Progress, six In Review, three Completed). Its shared Purchase bootstrap still logged a statement timeout at 06:45:05 UTC. Valid Planner transitions, idempotent replay and foreign-Brand denial were exercised on Staging in the rollback rehearsal, not by creating/changing Production tasks. Exact Production body equivalence establishes preservation of those paths; do not represent this as a new live Production write test.

At 06:44:21, Job 11 and 12 were active with unchanged schedules and command MD5 values `c609dbc06b6ed7960a580cc0bd9eff11` and `ca95a442ce17f94190209e83c01c54bc`. Existing business data, credentials and permissions were not intentionally mutated. No project restart, scheduler change, configuration change, app/Edge deployment, main update or additional migration occurred. Unrelated worktrees/changes were preserved.

Outcome: partial recovery only. Remaining blocker is slow authenticated complete reads hitting existing statement deadlines after the demonstrated retry storm stopped. The exact residual query/RLS/compute cause is not yet established. Stop at the approved boundary; a separate focused read-only residual-performance investigation is the smallest next step, not a timeout increase, scheduler disablement or broad backend termination.

## Residual read investigation and Staging candidate

This subsequent investigation does not repeat or modify the resolved Planner correction. Production access in this phase was read-only, including bounded authenticated-role EXPLAIN/ANALYZE and transaction-local JWT context/statement deadlines. These diagnostic claims are not issued credentials or permission changes. One broad metadata request hit automatic approval-review timeout before execution; a smaller read succeeded. Two bounded diagnostic read deadlines and two corrected metadata-query errors must not be attributed to user traffic.

### Current affected statements

These are direct PostgREST table reads, not failing named business RPCs:

| Path | SQL shape / query ID | Owning shared dependencies |
|---|---|---|
| `/rest/v1/product_sales_items` | report_id equality; nett_sales DESC/id ASC; LIMIT/OFFSET plus exact count CTE; `-7443663056773740374` | Product/Recipe permission and outlet RLS; complete report-item reader |
| `/rest/v1/purchase_records` | year/month ASC, amount DESC; supplier/category lateral joins; `-7242331823377914388` | Purchase permission/outlet RLS plus joined master-table RLS; Admin bootstrap |
| `/rest/v1/inventory_item_outlets` | complete outlet-config pages, with/without embedded Outlet; `149664497774777512`, `1437518014161965595` | Inventory permission/outlet RLS, embedded Outlet RLS |
| `/rest/v1/inventory_stock_check_items` | ID/check/count/variance/status pages; `-8338522671803250982` | Parent Stock Check permission/outlet RLS and repeated child outlet check |

06:46-07:00 UTC logs show Product Items 155 HTTP 200 (mean 4,412 ms) and 11 HTTP 500 (mean 8,033 ms); Stock Check Items eight 200 (mean 5,936 ms) and five 500 (mean 8,039 ms). PostgreSQL recorded 13 Product Items and five Stock Check Items 57014s in that window; Product count includes bounded diagnostic attempts, so use HTTP counts for observed application failures. Timeout contexts repeatedly identify `current_user_role_id` -> permission/all-outlet helpers -> `current_user_can_access_outlet`.

Latest inspected Production window, 07:00-07:09 UTC:

| Path | Success / upstream mean | HTTP 500 / upstream mean / max |
|---|---|---|
| Product Items | 46 HTTP 200 / 4,705 ms | 5 / 8,193 / 8,861 ms |
| Purchase Records | 2 HTTP 200 / duration unavailable | 2 / 8,328 / 8,575 ms |
| Outlet Config | 2 HTTP 200 / duration unavailable; 2 HTTP 206 / 7,886 ms | 2 / 8,923 / 9,766 ms |
| Stock Check Items | 9 HTTP 200 / 6,246 ms | 2 / 8,162 / 8,209 ms |

HTTP 206 is a ranged-page response, not evidence that the complete collection succeeded. Null duration headers are unavailable, not zero. These bounded windows are not incident-wide counts.

### Confirmed shared bottleneck

The five installed authorization helpers are identical across Production and pre-fix Staging. Each is SQL/STABLE/SECURITY DEFINER with controlled search_path. Their nested SQL planning/authorization evaluation is repeated across RLS rows and joined records. The 14 October `platform_role_authority_hardening` introduced the current, more complex Employee-first resolver and direct-permission composition; its security requirements remain mandatory. The timing and source change do not establish that it alone caused the sudden incident. Current plans and the isolated Staging intervention establish the present shared amplification mechanism.

Authenticated Production ANALYZE of an actual 317-item report (literal report ID, matching the service's report-equality query) used `product_sales_items_report_idx`: index lookup 0.025 ms, eight heap blocks, row scan/filter approximately 4,541 ms, final quicksort 47 kB, total 4,545.703 ms. Exact count independently repeats authorization filtering; a normal page/count request can reach the existing eight-second deadline despite only hundreds of rows. An earlier diagnostic scalar-subquery plan was not the service's request shape and is not used as the index diagnosis.

Product estimates: index 345 versus actual 317 rows; post-RLS estimate 64 versus actual 317 reflects authorization selectivity. Indexes already cover report_id, outlet_id, Employee auth UUID/email/role, Purchase outlet/year/month, config item/outlet and Stock Check parent. No missing relevant lookup index or sort spill is established. Purchase's small full-scope scan is intentional for this existing bootstrap; its joins and ORed permission predicates amplify the same helpers. Stock Check Items uses a hashed visible-parent subplan, not thousands of indexed child fetches; parent permission/scope evaluation remains expensive. No separate domain formula/read-contract regression was demonstrated.

Resource snapshots: 23-28 database connections against max_connections 60; latest 07:06:30 UTC snapshot had zero other active queries, zero lock waits and zero idle transactions. No PGRST003 pool-acquisition timeout appeared in the inspected 06:46-07:00 UTC PostgREST window (42 broader timeout-text matches, 17 statement-timeout matches). Earlier incident pool pressure is not proof of current pool exhaustion. OS CPU, memory utilization and credit/throttling telemetry were unavailable through inspected tools; no compute resize is claimed necessary or ruled out categorically.

`pg_stat_statements` supports repeated cached-buffer work: the exact Product Items statement had 2,122 completed calls, mean 2,007 ms, max 7,991 ms, 22,390,573 shared hits, zero shared reads/temp writes. Purchase mean 1,405 ms, embedded config mean 2,796 ms, Stock Check Items mean 696 ms. These are cumulative statistics, not this incident's success distribution; cancelled calls may be absent. Database-wide temp bytes date from May and are not evidence of a current spill. Fresh small-table statistics and low dead-row counts do not justify VACUUM/ANALYZE/configuration changes as the first recovery action.

Previously retained pre-loop successful API means were Product 1,081 ms, Purchase 1,620 ms and Stock Check Items 2,262 ms; those are limited earlier samples, not a throughput SLO. The 9/10 October `aa9752b59` Product correction already bounds exact-complete reads by report and concurrency; it remains present and unchanged. Latest media-picker changes do not touch these read services. Rolling back security hardening or completeness enforcement is not recommended.

### Smallest verified correction

Staging ledger: `20261016070206_platform_cached_authorization_read_plans.sql`.
SHA-256: `23f24107923f5421659efaf5205eca008149176262d9dd8984c493a644049322`.

The guarded migration wraps the exact installed SELECT bodies in static PL/pgSQL RETURN expressions for only:

- `current_user_role_id()`
- `current_user_has_direct_permission(text)`
- `current_user_has_permission(text)`
- `current_user_has_all_outlet_access()`
- `current_user_can_access_outlet(uuid)`

PL/pgSQL reuses prepared SQL/plans (PostgreSQL 17 documentation: https://www.postgresql.org/docs/17/plpgsql-implementation.html#PLPGSQL-PLAN-CACHING). It does not cache authorization answers, add new functions, bypass RLS, alter business predicates or change timeout/configuration values. Five pre-definition hash guards reject drift before applying. Comparison with unchanged Production proves each wrapped SELECT is exact, with identical owner, ACL, search_path, volatility, strictness, parallel/cost and leakproof metadata. Existing broad anonymous execute grants on the two outlet helpers were preserved rather than expanding this incident into an ACL change; their nested role resolver remains denied to anon. The security advisor flags existing SECURITY DEFINER exposure; this is not represented as a clean project-wide security audit.

Same-environment authenticated Staging ANALYZE measurements (bounded samples, not Production forecasts):

| Complete read | Before | After | Rows |
|---|---:|---:|---:|
| Purchase count | 128.351 ms | 30.417 ms | 31 |
| Outlet Config count | 847.236 ms | 71.631 ms | 196 |
| Product Items count | exceeded 5,000 ms diagnostic deadline | 828.658 ms | 2,518 |
| Stock Check Items count | not separately benchmarked before | 31.926 ms | 210 |
| Purchase with supplier/category lateral joins and canonical ordering | not separately benchmarked before | 22.807 ms | 31 |

After-fix 07:04-07:09 UTC Staging API evidence: Product Items 25 HTTP 200, mean 277/max 386 ms; Purchase three 200, mean 60/max 79 ms; Config two 200, mean/max 81 ms; Stock Check Items ten 200, mean 87/max 215 ms. No failed responses appeared for these paths in that bounded window. Datasets and load differ from Production; no identical Production speedup or guaranteed capacity is claimed.

L3 verification: `qa/staging/platformCachedAuthorization.rollback.sql` passes Employee-over-Profile precedence, disabled denial, legacy-only fallback, direct/alias permission semantics, selected/foreign/null outlet scope, four-table RLS denial and same-transaction claim changes. Complete Owner-visible row counts and row-content hashes equal administrative snapshots for all four tables. Zero disposable fixture roles, Employees and Profiles remain. The existing security-remediation authority subset also passes self-edit/identity reassignment denial, legitimate trusted Role save, foreign-Brand denial and protected-role constraints; publishing/health/provider work was deliberately excluded.

Authenticated canonical Staging browser acceptance: populated May 2026 Product Analytics completed current/April comparison/year loading and displayed RM188,326 net sales and 19,795 quantity; Purchase bootstrap settled without the global error banner; Stock Check rendered due groups and audit history rather than incomplete-read error. No Save/Start Check/Import action was invoked. No application console errors were captured. Evidence screenshots are retained outside Git under the task visualization directory. No application code/build/deployment is involved.

### Exact next Production approval

Priority P0 within the active SEV2: authorize only checksum-pinned `20261016070206_platform_cached_authorization_read_plans.sql` on `oyfobxdoyfuzsodogpgs`, with its five-function precondition checks and final ledger identity, followed by authenticated complete Product/Purchase/Stock Check reads and representative permission/roster/Ads checks. No frontend release, main merge, scheduler change, configuration change, restart, credential change or session termination is needed for this candidate. Preserve all business rows and existing grants. If latency persists after this correction, stop and inspect the remaining query rather than extending scope.

This residual phase made no Production mutation. Candidate SQL, QA and narrow authority documentation are retained uncommitted in the isolated incident worktree pending the Production decision. `git diff --check` passes; no frontend build is required for unchanged JS. Production responsiveness is still not signed off.

## Approved authorization-performance Production execution

The owner separately approved only `20261016070206_platform_cached_authorization_read_plans.sql` on `oyfobxdoyfuzsodogpgs`, with no other database/application/infrastructure mutation. Preflight at 07:17:10 UTC confirmed the latest ledger entry remained Planner recovery `20261016062921`, the new migration was absent, all five definition hashes matched the verified Staging preconditions and the exact local SHA-256 remained `23f24107923f5421659efaf5205eca008149176262d9dd8984c493a644049322`. No unexpected difference was accepted.

The migration applied successfully at 07:17:24 UTC. The migration API generated version `20261016071724`; only that exact new ledger row was normalized to approved local/Staging version `20261016070206`, guarded by name, one statement, statement MD5 `491cfb6cdb107862231827491d765ae1` and destination absence. Final ledger contains exactly one `20261016070206 / platform_cached_authorization_read_plans` row, above `20261016062921 / marketing_planner_nonretryable_revision_conflict`. No additional migration was applied.

Before/after comparison confirms all five wrapped SELECT predicates are exact. Function OIDs, owner, ACL, controlled search_path, SECURITY DEFINER, volatility, strictness, parallel safety, cost and leakproof flags are identical. Only SQL-to-PL/pgSQL execution/body wrapping changed. Role, permission, scope, business and credential tables were not mutated by this recovery. No Production QA fixtures were created, and verification transactions used READ ONLY with transaction-local claims and bounded five-second diagnostic deadlines, not persistent configuration changes.

### Actual Production reads and completeness

| Authenticated verification | Rows | Duration |
|---|---:|---:|
| Full Product Items row/content digest equals administrative snapshot | 6,013 | 1,430.365 ms |
| Full Purchase row/content digest equals administrative snapshot | 602 | 196.730 ms |
| Full Outlet Config row/content digest equals administrative snapshot | 1,010 | 239.664 ms |
| Full Stock Check Items row/content digest equals administrative snapshot | 11,415 | 336.986 ms |
| Actual report-equality Product page plus independent exact count and JSON body | 317 page / 317 exact count | 174.139 ms |
| Canonical ordered Purchase shape with supplier/category lateral joins | 602 | 152.768 ms |

The same Product report's page scan now takes approximately 90.6 ms, versus 4,545.7 ms for the earlier page-only query; the new 174.1 ms total additionally includes independent exact count and JSON aggregation. These are bounded SQL measurements, not page-load timings. Existing stable-order 500-row pagination, exact counts, count-drift/duplicate/identity guards and incomplete-read rejection are unchanged. No partial totals, timeout increase or new retry was introduced. One Product digest attempt was blocked before execution by approval-review timeout; the permitted single retry succeeded. Two corrected diagnostic errors (a nonexistent JSON metadata function and a default-argument function-signature lookup) are not application regressions or 57014s.

### Production authorization verification

- An existing active Selected-Outlets Employee resolves the expected canonical Role. All 415 catalog permission results match persisted direct grants and the established roster aliases.
- That Employee can access an assigned Outlet, cannot access a foreign or null Outlet, and sees no foreign-Outlet rows across all four affected read sets.
- A read of an existing organization/Brand by a non-member is denied with 42501. An authorized member with Marketing grants can read its own tenant; an unavailable Brand under that valid tenant is denied. No second live branded tenant was available for an additional two-tenant authorized-member comparison; no synthetic Production tenant was created to manufacture it.
- The existing disabled/inactive Employee resolves no Role, lacks the relevant permissions/all-outlet authority and sees zero rows in all four affected read sets.
- These were read-only checks under transaction-local authenticated-role contexts, not temporary grants, issued tokens or real account-state changes. Staging rollback evidence separately covers conflicting privileged Profile precedence, legacy-only fallback and trusted Role-save behavior.

### API and browser recovery acceptance

Observed Production API window 07:18-07:28 UTC / 15:18-15:28 Malaysia (all sampled affected-path responses were HTTP 200):

| Path | Requests | Mean / max upstream ms | Earlier failed mean ms (07:00-07:09 UTC) |
|---|---:|---:|---:|
| Product Items | 88 | 438 / 666 | 8,193 |
| Purchase Records | 3 | 639 / 821 | 8,328 |
| Outlet Config | 1 | 596 / 596 | 8,923 |
| Stock Check Items | 10 | 368 / 535 | 8,162 |

No SQLSTATE 57014, Planner 40001 or PostgREST PGRST003 pool-acquisition error was returned for the inspected post-recovery window. Error-log arrival and observation windows are bounded; do not present this as indefinite monitoring. Earlier failed-request and later successful-request durations are different populations, not a controlled same-load benchmark.

Fresh authenticated Production browser acceptance passes without captured application console errors: September 2026 All-Outlets Product Analytics displays RM315,595 net sales, 33,807 quantity and 602 grouped menu items after current/comparison/year completion; Purchase bootstrap has no error banner and Purchase Input settles to its saved September Friends Corner rows; Stock Check shows Friends Corner's Bar/Toast and Vegetables due groups instead of the completeness error. No Save, Import, Start Check or lifecycle action was invoked. Read-only screenshots are retained in the task visualization directory as `feedx-production-recovery-analytics.png`, `feedx-production-recovery-purchase.png` and `feedx-production-recovery-stock-check.png`.

At 07:28:50 UTC, Job 11/12 remain active on `* * * * *` / `10 seconds`, with original command hashes `c609dbc06b6ed7960a580cc0bd9eff11` / `ca95a442ce17f94190209e83c01c54bc`. The database snapshot has 37 connections, zero other active queries, zero lock waits and zero idle transactions. There was no frontend/Edge deployment, main change, database restart, session termination, scheduler/configuration/credential/permission change or unrelated migration. No application files were modified.

SEV2 outcome: recovered for the verified affected reads and representative workflows. L3 Staging evidence plus scoped Production read/security smoke passes. Residual risk is unmeasured sustained peak-load capacity and the unavailable second-live-tenant positive-control fixture, not a known remaining timeout bottleneck. No further Production mutation is proposed by this recovery.
