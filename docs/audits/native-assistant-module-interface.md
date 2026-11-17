# Module-owned Assistant interface delivery — 17 November 2026

Baseline: 109 READ / 2 ACTION, 116/128 modules with listed operations. Result: 110 READ / 2 unchanged ACTION, same 116 modules. This is deeper semantics, not an inflated module coverage count. The nine unintegrated and three not-applicable modules in the existing 128-module audit remain unchanged.

## Changes and retained authorities

- Employees: new domain RPC with summary/list/detail, fixed filters, human RLS and narrow exposure. Shared Admin/Assistant argument and status definition. Existing assignment operation unchanged. New directory policy defaults Disabled.
- HR workforce: existing enabled-capable no-ID summary now returns complete active/inactive/status counts using the same weighted status helper as HR; the bounded distribution list cannot truncate its aggregates. Raw HR unspecified status remains distinct from Employees form defaults.
- Factory: explicit complete catalogue versus bounded matching rows; operational pipeline summary retained separately from capped stages. No stock-threshold or lifecycle changes.
- Crew: recorded snapshot authority retained; total_count distinguished from page rows. No maintenance/recalculation introduced.
- Restaurant: existing shared analytics/Data Health calculations and completeRows remain canonical. Explicit completeness declaration; absent monthly evidence stays unavailable.
- Finance: canonical Reporting object and missing/partial flags remain unchanged. No independent recalculation or statutory-account claim.
- Marketing: canonical scoped customer totals retained separately from returned page; ACTION preview and confirmation unchanged.
- All 112 operations declare the lightweight interface. Named field lists/query modes are explicit for reference/core contracts; other existing projections remain executable domain field allowlists with conservative bounded-read semantics. This does not certify full domain summary coverage.

## Alignment checks

The build gate fingerprints contract schema/authorization/projection/lifecycle semantics and relevant domain, canonical service and migration sources. It detects drift and requires reviewed baseline renewal. It cannot automatically prove semantic equivalence, discover every indirect frontend dependency or certify untested business cases.

## Acceptance evidence

- Real Staging security-invoker source parity: 51 unique Employees, 41 active, 10 inactive (10 resigned, 0 terminated), 0 other. Filtered company/workplace count matched Employees; first page 20 with more available. Excluded sensitive field count 0; canonical assignment resolved. Missing identity returned 42501.
- Source checks used read-only transactions and the existing settings actor's SQL authenticated context, not a live model response. No provider calls or policy changes.
- Broader cross-user SQL identity switching was rejected by automatic review. No workaround attempted. Real restricted-user sign-in/scope denial remains unverified; deterministic denial and sensitive-projection tests cover the implementation.
- New directory stays Disabled. Existing authorization/policy data is not rewritten. No live newly enabled Assistant directory invocation is claimed.

Verification totals: 83 Native Assistant server regressions passed; 57 focused HR/Employees/management tests passed across the final focused passes; Vite build and interface drift gate passed. The authenticated Employees page displayed 41 Active Employees, matching the source read. Existing settings revision 23 had neither workforce nor new directory policy enabled; both remain off. The new RPC is stable SECURITY INVOKER, denies anon execution and preserves authenticated human checks. No live model/audio call was made.
