# Staging security hardening and Ponytail optimization

Scope: canonical dev/Staging from `22641c95d9d43049b91c8cad8718013d94fa69ad`. L3 for RLS/RPC contracts; focused L2 consumer verification. No Production writes, provider mutations, messages, customer changes or execution activation.

## Security outcome

People owns `employee_employment_structure_migration_report`, introduced by the employment-structure migration. No current application consumer was found. Staging contained seven rows with Employee IDs and legacy/mapped employment statuses. Default anonymous grants plus absent RLS exposed those rows. The forward migration enables RLS, denies anonymous/browser mutation access and preserves authenticated `employees.view` reporting intersected with canonical Employee visibility. All seven retained rows are preserved.

Read-only Production inspection on 14 October 2026 found the same anonymous report grant and absent RLS, but zero report rows. Production also retains role-union permission helpers, self-editable Profile role data, no identity-access guard and broad Employee access-field UPDATE grants. There are zero legacy Profile rows and no active unlinked Employees at inspection time; those counts do not make the unsafe authorization code safe. Active linked Employees with `employees.edit` include Finance (one), Manager (two) and Owner (one); no real-user escalation was attempted. Staging's previously verified canonical role hardening remains intact.

## Isolated Production candidate — NOT AUTHORIZED/APPLIED

[Four-file candidate patch](production-security-hotfix-candidate.patch), SHA-256 `ef17d9f046acfa6a49f5b7109f2366d5d4f9491324284e918b3e85b999d7f5de`, dry-checked against exact main baseline `5224eeade2e7438c7810c2aa8524422443e9e1ab`:

- Verified Platform role-authority/identity guard SQL from Staging.
- People report RLS/grant SQL.
- Only `src/auth/authService.js` and `src/services/employeeService.js` compatibility changes: never relink Auth by email or clear an established Auth link/email through ordinary Employee saves.

No Marketing feature migrations or application features are included. The two client changes are necessary to keep existing login/Employee-save behavior compatible with the identity guard. No role assignment, membership or business row changes are part of this candidate.

Exact approval required: authorize an isolated security release from that Production baseline, apply only those two SQL migrations to Production Supabase `oyfobxdoyfuzsodogpgs`, and release only the two client compatibility changes through the canonical Production Git/Vercel workflow, with scoped role/report/login smoke verification. This necessarily includes a security-only main release; it does not authorize merging dev/Marketing, provider changes, new permissions or customer mutations. Recheck baseline drift and SQL prerequisites before execution. Preserve the security guard on rollback; prefer a forward compatibility repair rather than restoring the vulnerability.

## Existing Ponytail finding ledger

| ID | Status | Outcome / remaining risk |
|---|---|---|
| 4 Medium | Closed | Receipt ingestion preserves reply revisions; real inbound/echo changes retain invalidation. |
| 5 Medium | Closed | Definitive grant expiry distinguished from network/rate-limit/service/configuration failures; bounded retry and sealed-token CAS protect concurrent refresh. |
| 6 Medium | Partial | List metadata reused, aggregate deadlines and transient-error propagation implemented. Provider-wide search pagination can still yield sparse scoped pages; recursive scoped search requires separate cursor/read-contract work. |
| 7 Medium | Closed in code; live thumbnail smoke pending | Private bounded thumbnails replace original downloads for tiles; original preview/import remains explicit. |
| 8 Medium | Deferred | Server-owned scoped dashboard aggregates/date queries need coordinated metric grain, non-additive Reach and action-count contracts. Truncation would silently undercount. |
| 9 Medium | Partial | Editors and extraction identity checks use compact authorized directory. Main workspace still downloads all metric history; true paging/on-demand history needs coordinated Insights/history changes. |
| 10 Medium | Deferred | Cleanup needs fair durable batching/indexed reference selection. A blind LIMIT can starve later assets or delete active references; retention/lease authority must be designed together. |
| 11 Medium | Previously closed | Media Picker render loop and pagination already fixed; not reworked. |
| 12 Medium | Previously closed | Regression harness already repaired; not re-audited. |
| 13 Medium | Deferred | Existing nine-package advisory evidence retained. Shared Vite/PostCSS/browser dependency upgrades need compatible lockfile/build/extraction validation; no blind audit fix or cosmetic severity reduction. |
| 14 Low | Closed | Removed unused provider scaffold and its self-only tests; removed obsolete client role-scope/direct-import wrappers. Database compatibility RPCs remain. |
| 15 Low | Closed | Mobile Outreach now uses the shared row activation exclusions for selected text and nested controls; no broad layout rewrite. |

Three newly closed Medium findings, two partially addressed, three deferred; two Medium findings were already closed. Both Low findings closed. Large-component splitting is deferred until tied to a concrete workflow boundary, rather than file-size-only refactoring.

## Measurements and verification

- Instrumented 50-file direct-child fixture: metadata/list requests **52 → 2** (96.2% fewer), preserving root/shortcut checks. This is a deterministic transport-count regression, not a live Google latency benchmark.
- Tile image response bound **100 MiB original → 1 MiB thumbnail**, with no original fallback. Actual image sizes vary; no invented egress savings.
- Creator editor/extraction directory reads now exclude six unrelated collections, including every metric snapshot; the main history contract is unchanged.
- Existing build log versus changed build: Admin JS **1,848.52 → 1,848.44 kB**, gzip **487.22 → 487.22 kB**; Outreach **82.95 → 82.81 kB**, gzip **25.05 → 25.02 kB**; Creator **72.66 → 72.73 kB**, gzip **20.53 → 20.54 kB**. No meaningful overall bundle reduction claimed. Existing >500 kB chunk warning remains.
- Focused Drive/Creator/shared-table suite: 43 tests passed. Affected Marketing/Platform consumer suite: 72 passed (13 Creator tests overlap; 102 unique tests across 13 files).
- Extraction API/metadata regression suite: 30 passed; **132 unique tests across 15 files** across the focused runs.
- Staging rollback QA: anonymous report denied, authorized People report scoped, browser report mutations denied; receipt persistence/draft stability, new inbound revision invalidation, refresh CAS and compact directory scope passed. All fixtures rolled back.
- Existing Critical/High authorization, worker and Facebook URL acceptance evidence reused; no repeated real provider QA or outbound action.

Remaining Production release risks: security candidate is unapplied; wider Marketing baseline/configuration/App Review dependencies remain governed by the existing readiness reports. Open performance/dependency findings above are not represented as resolved.
