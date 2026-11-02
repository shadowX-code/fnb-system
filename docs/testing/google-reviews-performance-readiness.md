# Google Reviews → Performance readiness

## Scope and decision

Audited canonical Staging on 2 November 2026 from dev `1ff89608d93dd98efe61252eb35fd4a2950632a0`. No Production changes, Google writes, target changes, employee recalculation or review-derived evidence retention are authorized by this audit. Scoring remains disabled: policy approval and operational inputs are not established. Test additions use synthetic provider data only.

## Existing authorities

- `supabase/functions/_shared/googleReviewsContract.ts`: dormant, server-only reconciliation and preview. Both API availability and separate policy approval are required before fetching monthly evidence. Malaysia-local review creation month, source-identity deduplication and updated-rating handling are already defined. No runtime scoring caller exists; live Google modules import its types only.
- `googleBusinessProfile.ts` and `google-business/index.ts`: canonical live, fully paginated review sync with aggregate/count consistency checks, encryption, expiry and mapping/generation safeguards. Reuse this boundary for any later approved integration; do not introduce another sync job or review store.
- `crew_google_set_monthly_target` / `crew_google_target_history`: authenticated permission/outlet/month-scoped target configuration, positive integer, prior/new value/actor/time audit, locked after an outlet/month finalization. Settings intentionally hides the controls while scoring is disabled. An existing target is configuration evidence, not automatically proof of a new approval workflow. No default target may be invented.
- `crew_performance_period_employment`: verified People timeline determines eligible active Service Crew and period outlet. Unsupported history remains unresolved; material intra-month changes require review. No individual Google reviewer/employee attribution is permitted.
- `crew_refresh_performance(uuid,date,boolean)`: preserves finalized results; eligible open results use Attendance 30, Service 30, Customer 20, Knowledge 15 and Team Review 5. Customer is null/Pending and final total is null. `crew_performance_finalize` explicitly refuses pending Google evidence. Customer Feedback is not a fallback.

## Recovered model

Positive = 4–5 stars, neutral = 3, negative = 1–2. Quality denominator includes all eligible monthly reviews, including neutral. Positive component is `min(positive / approved monthly outlet target, 1) × 15`.

| Monthly negative rate | Quality points |
| --- | ---: |
| ≤2% | 5 |
| >2% to 5% | 4 |
| >5% to 10% | 3 |
| >10% to 15% | 2 |
| >15% to 20% | 1 |
| >20% | 0 |

These bands already exist in the canonical domain contract and dormant adapter; no thresholds were invented. Missing/invalid target, incomplete evidence or zero eligible reviews remains Pending, never zero or an assumed five Quality points. The score is shared by eligible employees in the same outlet/month.

## Read-only Staging findings

Management catalog/aggregate queries found four explicit outlet mappings; connection status `expired` (generation 2); zero inbox caches; zero monthly target rows and zero approved configured targets. All 26 existing Performance rows are `review_required` with null Customer scores. The current server definition retains the finalized-result early return, Pending Customer/null total and finalization refusal. No records were refreshed or mutated to produce this evidence.

## Compliance and missing contracts

[Google Business Profile API policies](https://developers.google.com/my-business/content/policies#content_storage), checked 2 November 2026, limit stored content to temporary secure storage of no more than 30 calendar days and prohibit manipulating/aggregating stored content. API allowlisting and OAuth consent do not resolve whether review-derived employee scoring or permanently retained derived Performance evidence is permitted. Treat this as an unresolved compliance blocker, not as permission to bypass expiry by retaining only ratings, counts or scores. Obtain authoritative clarification/approval covering the proposed computation and durable derived evidence before implementation of operational scoring.

After that gate is resolved, define the smallest closure contract: completed Malaysia calendar month and evidence cutoff; mapping identity for that month and remapping behavior; count-consistent full reconciliation with generation/revision/freshness guards; missing/deleted/updated reviews; target approval/version and concurrent finalization locking; permissible evidence fields/retention/deletion; and explicit handling of later source changes without rewriting finalized results. Use the existing People scope and scoring engine, not a new employee attribution model. Current-month progress, if approved later, must be explicitly provisional.

## Smallest safe scope and verification

Retain the operational Pending/finalization gates and hidden target UI. Strengthen synthetic contract coverage for independent API/policy gates, neutral classification/denominator and invalid targets; run the existing Quality boundary, pagination, deduplication, target-history, People eligibility and finalized-evidence contract suites. No app behavior, migration, Edge Function or Cron change is necessary before the blocking contracts are established. No real Google content was aggregated for employee scoring during this audit. No Staging deployment is needed for documentation/test-only changes.

Verification completed: 49 tests passed across six suites (`googleReviewsContract`, `googleBusinessProfile`, `crewGoogleReviewsFoundation`, `crewGoogleTargetHistory`, `crewPerformanceEmploymentPeriod`, `crewPerformanceV2OnlyCutover`). `git diff --check` passed. QA classification: L1 documentation/test-only change with read-only Staging catalog/aggregate inspection; no canonical authority change. Full scoring activation would be L3 and remains unverified/blocked. No build or authenticated UI cycle was repeated because runtime code did not change.
