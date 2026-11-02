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

## Official-policy follow-up to audit f0b495698

Rechecked the official pages on 2 November 2026. This is an engineering activation decision, not a legal opinion or a Google approval. No explicit permission for this employee-scoring use was found.

| Classification | Finding |
| --- | --- |
| Explicitly supported general purpose | The [GBP API policy](https://developers.google.com/my-business/content/policies) permits managing/reporting authorized business listings. It does not specifically authorize employee scoring. |
| Explicit restriction | That policy's Content storage section limits secure cached content to 30 calendar days and disallows manipulating/aggregating stored content. A monthly scoring computation over FeedX's persisted review cache cannot be treated as permitted under this text. |
| Unresolved interpretation | The policy does not specifically classify independently calculated monthly counts, rates, employee scores or source fingerprints as retained Content, or grant a derived-evidence retention exception. A new name, anonymization or deleting reviewer identity is not evidence of an exception. Live in-memory computation is not an established workaround. |

The [GBP API terms](https://developers.google.com/my-business/content/terms) establish precedence: Business Profile Additional Terms, then GBP API policies, then general Google API terms. The [Additional Terms](https://support.google.com/business/answer/9292476) concern the business profile and do not supply an explicit employee-scoring/derived-retention exception. [General API terms, sections 5 and 8](https://developers.google.com/terms) also restrict content copying/derivation and require deletion of cached/stored content on termination; they do not establish that this scoring use is permitted.

The [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy) mentions aggregated internal operations as an exception to a human-access restriction in its conditional Limited Use requirements. This is not a clear override of the GBP-specific storage restriction or a durable-retention permission. Its disclosure rules also require accurate secondary-use disclosure and notification/consent before a new use. Whether the current FeedX privacy policy covers this purpose is unverified: the public privacy URL was not retrievable by the research tool. No legal text or consent configuration was changed.

### Conditional minimum monthly lifecycle — not approved for activation

This design may proceed only if Google's written clarification permits the computation and required retention. If immutable evidence cannot lawfully be retained, do not activate the model merely by giving snapshots a short cache TTL.

1. **Target approval.** Reuse the existing outlet + first-of-month target key, setter, permission/outlet checks and target audit. The whole Malaysia calendar month is its effective interval; never silently inherit a missing target or prorate mid-month. Bind explicit approval and its server actor/time to one immutable target audit revision. The current setter records an authorized edit, not a distinct approval; add approval/revision concurrency to this authority only after policy clearance. Target approval and monthly close must share an outlet/month transaction lock, including the first target insert, so approval/edit/finalization cannot race.
2. **Monthly evidence.** Reuse the existing Google gateway, provider pagination/count checks, source-identity deduplication, token refresh and generation/mapping guards. No additional fetcher, Cron job, raw store or durable count store. A closed month's interval is `[month start, next month start)` in Asia/Kuala_Lumpur based on `createTime`, with the latest valid rating at reconciliation. Use all valid stars in the Quality denominator. Reconcile after month end; require complete source coverage and an unexpired canonical 24-hour snapshot immediately before closing. Validate current mapping revision/connection generation and record the permitted cutoff/provenance only if retention is approved. A sync timestamp, official lifetime aggregate, filtered Inbox page or absence of cached rows is insufficient.
3. **Readiness and scoring.** Default activation remains off server-side. Require separate policy clearance, approved target revision, closed month, complete/fresh evidence and verified eligible period employment/outlet. Reuse `previewGoogleCustomerScore` for the existing 15 + 5 computation; do not fork thresholds or substitute Customer Feedback. All eligible Service Crew in the same outlet/month receive the same Customer component. No Google reviewer-to-employee attribution. Missing or zero-denominator evidence remains Pending/null; final total and finalization stay blocked. Existing People mixed/unverified periods retain their review/unresolved behavior.
4. **Closure/finalization.** Feed the verified shared component into the existing Performance engine and result/snapshot structure, not another scoring authority. Within the outlet/month lock, recheck target revision, mapping/generation, evidence expiry and readiness immediately before finalization. Pin only the minimum Google-permitted source basis, target version, formula version and result, alongside existing People evidence. Retention duration, permitted fields and deletion/revocation obligations must be explicitly established first. Leave historical finalized scores unchanged; never backfill them just because Google is connected later. Current-month preview, if ever added, is provisional and cannot finalize.
5. **Mapping and corrections.** Do not apply a new location to an old month's score by matching names or using today's mapping alone. If resource identity changed and historical ownership/coverage cannot be proven, keep that month Pending; automatic multi-location blending is outside this minimum scope. Prior to closure, rating edits/deletions require a new complete reconciliation and invalidate readiness; target edits invalidate the approved revision. After closure, late source changes can flag a review but cannot silently rewrite final scores. The existing employment recalculation authority rejects finalized results; it is not a Google correction authority. Any required finalized correction needs separately approved versioned correction semantics rather than reopening old evidence.

### Reuse versus missing infrastructure

| Reuse unchanged | Missing, conditional on policy permission |
| --- | --- |
| Existing target table/month key, audit and scoped RPCs | Explicit approved revision and shared outlet/month close lock |
| Google sync/cache, pagination/count consistency, expiry, mapping/generation checks | Monthly readiness/closure validation without a new review storage authority |
| Dormant 20-point scorer and approved bands | Default-off server activation gate and trusted Performance component wiring |
| People period eligibility and existing Performance result/finalization authority | Approved minimum immutable evidence/retention contract; fail-closed finalization integration |
| Existing permissions/outlet scope and audit authority | Approved secondary-use disclosures and any required consent |

### Exact official clarification request — prepared, not sent

Use the [Business Profile APIs support page](https://developers.google.com/my-business/content/support) → Business Profile APIs team → Contact support (`https://support.google.com/business/contact/api_default`) while signed in as the approved project's owner, preferably referencing the existing API approval case and project number 523893489763. The unauthenticated link redirected to the Help Center during research; this does not establish that the signed-in support route is unavailable. The policy-linked [Business User Data Availability form](https://support.google.com/business/contact/dma_data_request) explicitly excludes non-EEA businesses, so it is not the appropriate Malaysia route. Do not submit a false EEA claim. A community answer alone is not project-specific written permission. No support request has been submitted.

Proposed request:

> FeedX uses the official GBP Reviews API for explicitly authorized Malaysian outlets. We propose a monthly, outlet-shared internal Service Crew Performance Customer component: 15 points from positive-review target achievement and 5 from negative-review rate. No reviewer-to-employee attribution, review resale or AI training is involved. Please confirm whether this employee-scoring purpose is permitted, and whether computation from our encrypted 24-hour review cache is compatible with the GBP Content storage prohibition on aggregation. If not, is any expressly approved computation method available? May we retain month/outlet, positive/neutral/negative counts, denominator, rates, target/formula version, Customer score, and non-content reconciliation/approval audit after cache expiry or account disconnect/revocation, without review text, reviewer identities, photos or individual ratings? Which of those derived fields or fingerprints remain Content, what exact retention/deletion obligations apply, and may an immutable employee Performance snapshot retain the resulting Customer score and total? Please identify the applicable policy provision or project-specific written authorization, including any disclosure/consent requirements. We will keep scoring disabled pending clarification and can provide the proposed retention duration for approval.

Follow-up verification: repeated read-only Staging metadata/aggregate checks confirm connection `expired`, four mappings, zero targets/caches, 26 Performance rows with null Customer and zero finalized rows, and the server Pending finalization guard. No Google calls, reconnect, employee writes, new evidence storage, migrations or deployment. The existing 49-test result remains applicable because this follow-up changes documentation only; tests/build/UI QA were not repeated. `git diff --check` is required before committing this follow-up.

## Request-local Customer preview implementation

The subsequent scoped request authorizes a non-persistent preview while durable scoring remains disabled; it does not resolve the policy questions above. Performance Overview now exposes the original monthly target setter/history and a manual Customer Preview. The gateway requires the existing Google View/Sync scope and authenticated Performance outlet/month access. It reads directly through the existing GET-only provider/full pagination/count-consistency path, never from the stored cache, then rechecks target, permission and connection/mapping basis. The shared month classifier and dormant 15+5 scorer are reused without new bands or employee attribution. Current/future months, missing targets, missing mapping, expired authorization, incomplete/expired evidence and zero denominator remain Pending. The response is no-store and expires after five minutes; the UI clears the score/breakdown at expiry or outlet/month/target change. Eligible open employee detail may display the matching outlet/month preview separately from saved evidence. No saved total, finalization or Reward consumes it. No Google-derived preview data is written to any persistent authority or browser storage. This is not a claim of Google approval for durable scoring.

Verification: 82 focused tests passed across nine suites, including complete/incomplete/expired evidence, Malaysia month boundaries, request permissions, stale outlet responses, target save failure/retry, People eligibility and finalized-result protection. Production frontend build passed. Existing target save → readback → audit history, invalid target rejection and unauthenticated rejection passed in one rolled-back Staging transaction using the existing safe QA outlet. No target or employee Performance record was committed for QA. A stale test selector was updated from button to option to match the existing shared SelectField semantics; product dropdown behavior was not changed. Only `google-business` was deployed to Staging; no migration, Cron job, credentials or Production change is required.
