# Marketing bounded-read and background optimization

Scope: canonical dev/Staging, base `c82384f50f56fce81be25cdf333f896728d81acc`. Continues the existing Ponytail audit and completion report; no repeat audit, Production work, OAuth, provider settings change, external publishing/messaging/Ads execution or paid crawler test. Documentation Impact: Marketing domain updated. QA level L3 for additive read RPCs/index/scheduling metadata, focused L2 client checks.

## Finding disposition

| Existing finding | Outcome |
|---|---|
| 6 Drive recursive search | Closed targeted defect. Folder-scoped recursion, encrypted continuations, at most four list calls per continuation, metadata reuse, containment/shortcut rechecks and honest incomplete pages replace global-name pages with unrelated results. Debounced/cancelled client searches. Bounds: 1,000 queued / 4,000 completed folders, 15-minute cursor expiry, existing 25-second provider deadline. Larger trees fail explicitly with browse/Open in Drive recovery. |
| 8 Dashboard complete-history reads | Closed history-walk bottleneck. Overview reads active content/actionable conversations once plus the existing month Planner source. Social Analytics folds latest exact-identity/current-generation metric evidence server-side for selected Malaysia publication dates. Planner publishing reads visible dates plus linked content once. Existing full read APIs remain compatible. |
| 9 Creator metrics/history | History portion closed. Workspace excludes history arrays, retains latest metrics/counts, and requests 25-row keyset history pages on demand. The redundant second reload after linking a Post to a collaboration is removed. Directory/Post catalog pagination remains visual; replacing that shared catalog requires coordinated Insights, editor and follow-up contracts and is explicitly deferred. |
| 10 Cleanup scans/locks | Bounded/fair scheduling portion closed. Indexed least-recently-checked rotation locks/checks at most 25 candidates; at most one deletion on an idle tick with a shared three-second transport deadline. Publishing claims run first. Every reference/publication/receipt/lease guard remains. Normalizing revision/Ads media references to replace conservative text searches is deferred because it changes retention/reference authority; do not truncate those safety checks. |
| 13 Dependency advisories | Closed current known advisory inventory. Targeted compatible updates; final `npm audit` and `npm audit --omit=dev` both report zero. No `audit fix --force`. |
| Earlier completed findings | Preserved, not re-audited. Retired unused complete-history pager and its self-only tests; canonical content row projection shared by Content Management, Overview and Planner. |

## Changes and boundaries

- `marketing_private.content_rows` owns the existing Content Management projection once. Existing Content Management filters, ordering, pagination, multi-channel grouping and historical links consume that shared projection unchanged. Operational mode excludes successful/external history; it retains publishing failures, blocks and uncertain outcomes.
- `marketing_social_publications` uses grouped account resolution and a single metric-folding pipeline. It preserves genuine zero, missing values, Facebook interaction fallback, per-metric observation times and exact connection-generation boundaries. Client channel aggregation/ranking definitions and observed-growth snapshot authority remain unchanged. No sum of Reach, invented engagement rate or cross-channel comparable total is added.
- `marketing_creator_workspace` reuses the canonical Creator projection without `snapshots`; compatibility `marketing_creators_read` retains full history. `marketing_creator_metric_history` rechecks permission/Brand access on every page and sorts by capture time, recording time and UUID. The new covering index replaces the redundant shorter prefix index, without removing a constraint or evidence row.
- `cleanup_checked_at` is an internal scheduling hint, not a deletion authority. Original eligibility and ten-minute retry lease rules remain. Abort/uncertain storage results never mark an asset retired without existing finish reconciliation. The database candidate count and transport deadline bound different things: cancelling HTTP does not prove immediate database cancellation. A single candidate can still involve conservative revision-reference scans; normalized references remain deferred.
- No permanent Drive index, new media store, alternative consent/identity authority or permission grant is introduced. Search remains Brand-root scoped and current folder/filter/cursor bindings remain enforced. File browsing and metadata retrieval remain read-only.

## Measurements

Controlled rollback fixtures, not invented live traffic benchmarks:

| Measure | Before | After |
|---|---:|---:|
| Creator workspace history rows, 501-snapshot fixture | 501 | 0 |
| Creator workspace JSON bytes | 217,153 | 1,833 (99.2% smaller) |
| Social observation API pages for 500-row / one-identity fixture | 25 | 1 |
| Social rows returned for that identity | 500 | 1 |
| Creator history rows per UI request | Entire history | At most 25 |
| Recursive result validation, 50-match fixture | Global matches could require unseen ancestry reads; prior list caching was already fixed | 0 additional GETs after folder discovery/listing |
| Recursive traversal list budget | One global-name page plus candidate ancestry reads | At most 4 folder-scoped calls per continuation |
| Cleanup candidates checked/locked per claim | Unbounded eligible candidate scan | At most 25 |
| Full npm advisory inventory | 14 in the initial full dry-run inventory (9 omit-dev) | 0 full / 0 omit-dev |

A three-keystroke search burst produces one browse request after 180 ms; abandoned requests receive AbortSignal cancellation. Overview shares one active-work RPC between Content and Conversations instead of paging both histories. Planner eliminates its all-history pagination loop. Folder discovery adds list overhead on shallow trees; its benefit is correct Brand-root coverage and bounded work without unrelated global-name pages. No live request-latency or monetary/egress savings are claimed.

Bundle comparison from the previous verified build versus this build (kB; gzip in parentheses): Marketing workspace **61.20 (19.96) → 60.84 (19.80)**; Creator **72.73 (20.54) → 73.67 (20.83)**; Admin **1,848.44 (487.22) → 1,848.81 (487.30)**. History controls and dependency patches offset the small removed pager. No meaningful whole-app bundle-size reduction is claimed; the existing >500 kB chunk warning remains.

## Dependency scope

Vite 7.3.3 → 7.3.7, Babel core 7.29.0 → 7.29.7 and compatible Babel helpers, PostCSS 8.5.14 → 8.5.30, nanoid 3.3.12 → 3.3.20, source-map-js 1.2.1 → 1.2.2, browserslist 4.28.2 → 4.29.3 and compatible browser data, DOMPurify 3.4.14 → 3.4.17, esbuild 0.27.7 → 0.28.2 within Vite's explicitly supported range. Build-only Vite/plugin-react moved to devDependencies; selected plugin version remains 5.2.0. Test-only Playwright 1.55.0 → 1.55.1 and Vitest 4.1.10 → 4.1.11 patch releases; compatible Undici 8.11.2 clears remaining dev advisories. Runtime `playwright-core` **1.55.0** and Chromium **140.0.0** are unchanged; no browser installation or live platform extraction was repeated.

Primary advisory evidence: [Playwright installer certificate fix](https://github.com/advisories/GHSA-7mvr-c777-76hp), [Vitest mocker fix](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9). Package versions/ranges and final inventory were verified against the npm registry. Zero known advisories is an inventory result, not a general security guarantee.

## Verification and remaining limits

- 98 focused tests passed across seven changed-consumer/search/cleanup suites.
- One broader Marketing/shared-table regression pass covered 524 tests / 69 files after compiler/test-tool updates. 523 passed initially; one stale Analytics mock was updated to the new bounded API, then its five-test consumer suite passed. No repeat full external acceptance.
- Build and `git diff --check` passed. One old Planner test fixture now clears URL preferences between cases; no Planner lifecycle change.
- Rollback-only Staging QA traversed all 501 tied-timestamp history rows without duplicates/missing entries, preserved latest metrics, genuine zero and generation isolation, checked month/active-work projections and proved cleanup progresses beyond protected head candidates. No storage deletion occurred in QA.
- Separate rollback QA used `SET LOCAL ROLE authenticated`: authorized reads succeeded; denied Brand/module access, private schema and anonymous access remained denied. Every fixture and temporary access change rolled back.
- EXPLAIN confirms the complete cursor tuple is an index condition on `marketing_creator_metrics_cursor` with no Offset. The redundant shorter index did not back a constraint.
- Supabase advisor notices for intentionally authenticated SECURITY DEFINER read APIs remain expected; each has explicit grants/search_path and tested caller/Brand/module guards. See [advisor description](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).
- Four append-only migrations and only marketing-drive / marketing-worker Edge bundles delivered on Staging. The application follows dev → Git Integration → canonical alias verification. Final deployment/authenticated smoke evidence is recorded in the completion handoff.

Deferred scale work: true server pagination for Creator catalogs, server-only summary/top-N social reports for exceptionally large unique-post periods, normalized/indexed media-reference authority, and broad component splitting without a concrete boundary defect. Existing data and execution gates remain intact. No Production release assessment or approval request is part of this task.
