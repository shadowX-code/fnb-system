# Ads Attribution Review correction — 16 October 2026

## Confirmed cause

Production Postgres logs for 05:35–06:05 UTC locate the Ads read statement timeouts inside the catalog statement of `marketing_ads_read`, including `ads_project`'s discarded `attribution_spend` calculation. The configuration-only catalog passed the complete latest historical snapshot into the full reporting projection. EXPLAIN VERBOSE confirms the flattened lateral expression expanded `ads_project` three times for configs/account/scope. The existing snapshot primary-key lookup already uses an index; adding another index or raising the eight-second API timeout is not the corrective action.

The forward migration materializes one authorized catalog projection per connection and passes only configuration/account plus empty Insights. Catalog shape and scope are unchanged; original exact-period reports, observations, Brand projection, credential generations, permissions and jobs remain canonical. Production was inspected read-only; its function has not been changed by this preparation.

Read-only Production plan samples: old catalog expression 456 ms; revised expression 202 ms (not installed). Staging's applied full canonical account read measured 101 ms. Timings vary with load; these are observations, not a latency guarantee. Production logs establish the failing statement independently of warm query timing.

## Confirmation behavior

Review and confirmation show campaign/ID, selected-period spend and reason when missing, known/total stored-ad identity coverage, proposed Brand and promoted identities. Returned zero remains zero. Unsupported/missing results are not manufactured or allocated from account spend. The selected date range remains visible when there is only an unsynced configuration catalog.

Positive assignment and batch selection require every stored ad to supply a valid promoted identity, no conflicting/unknown identities and one unique connected canonical Brand match. Partial evidence cannot share a verified group or prefill a positive assignment. Unassigned partial campaigns cannot be confirmed as assigned. Existing assignments may still be cleared explicitly; current Role/tenant authority, optimistic revisions, request identities, idempotency and atomic batch RPC remain unchanged. Names remain unverified hints. Identity completeness describes the stored configuration observation, not guaranteed lifetime creative history.

## Preserved Production proposals

Only these five campaigns are evidence-complete for Hola Brand `965ed560-5427-4e3c-ab06-e75bcc228804`, Page `113234221623434`, Instagram `17841457435511713`:

| Campaign | ID | Stored ads with identity |
|---|---|---:|
| Hola Awareness Video – CTS | 120211987048750774 | 4/4 |
| Hola Hiring Ads | 120211923697060774 | 1/1 |
| HOLA XHS X FDM Awareness | 120211843422720774 | 3/3 |
| MemberGold – HolaIpoh | 120211300921170774 | 4/4 |
| Hola Membership Prize | 120211163810570774 | 1/1 |

The remaining 47 Production campaigns remain Unassigned: 43 unavailable and four partial (HappiCTS 2/6, Special Promo 1/10, VFORCE Giveaway 1/2, VFORCE 18/12 9/15). This correction writes no mappings. The year report contains no campaign Insights rows for the five proposals, so confirming them later would leave Hola totals unavailable, not zero. The account's original MYR 11,586.94 remains unchanged. Campaign-level MYR 11,586.98 is independently reported and is not balanced to account spend.

## Verification

L3 focused: rollback-only Staging rehearsal compares complete read results before/after the migration with a synthetic year-sized payload; actual current, unsynced and Brand-scoped outputs remain identical. Applied read-contract and existing tenant/Brand isolation fixtures pass and roll back; anonymous Ads read remains denied. No provider requests, historical imports or durable attribution writes were used as fixtures.

45 affected tests pass across seven files. Staging build passes, with the existing chunk-size advisory. Mechanical UI check reports no findings. Authenticated canonical Staging verification opened the exact five-campaign group and confirmation without saving, and verified a genuine Unassigned VFORCE 18/12 partial case has disabled confirmation. Desktop/mobile Light/Dark, 390px document width without overflow, and restored appearance/viewport verified. The final bounded correction supplies the unsynced review header date fallback and explicit mobile spend label. Existing Staging assignments (including its already-mapped five Hola campaigns) are preserved, never reset to imitate Production.

Evidence: `/private/tmp/feedx-ads-review-qa/`; logs and rollback receipts: `/private/tmp/feedx-ads-attribution-*.log`, `/private/tmp/feedx-ads-attribution-*-result.json`.

## Smallest Production release proposal

Reconcile exact current main/live `18d7595a684ca0081a0892f8ab9716a5be552b95`, ledger 803 before action; stop on drift. Preserve all concurrent Media Picker/Planner and integration releases. Apply only `20261016061610_marketing_ads_catalog_projection.sql` (803→804), SHA-256 `5d068416659c698d5d925cb43521544ade9022e0759194378f688e60504f6edb`. Deploy the isolated successor frontend through one existing Vercel Git deployment; promote only that exact READY deployment to existing domains if needed. No Edge Functions, worker, environment, scheduler, credential, provider or execution changes are needed.

Focused Production acceptance is read-only: read current/year/unsynced and Brand-scoped reporting, open the five-item confirmation, check partial exclusion and preserve stored observation/totals. Do not save attribution. Production release approval and the exact five mapping approvals remain separate.

Rollback frontend to verified READY deployment `dpl_45WBqtCqr1b7GCRJDpJcZ2zsPPXu`. The additive read optimization can remain in place; if a query defect is found, prepare a forward repair restoring the previous function definition. No data restore, down migration or rewriting reporting evidence is needed.

## Production reconciliation — successor approval required

The approved `3c415ea0be2a153cbe33d6ad6f3be1445961b97f` predates live/main `18d7595a684ca0081a0892f8ab9716a5be552b95` (Planner working attachments). The successor merges that exact main unchanged. Production ledger is 803, with newer Planner conflict, authorization-plan and task-attachment receipts. The Ads migration remains unapplied. Its complete reviewed replacement string still matches the live RPC (function MD5 `8fb869baf9a135b964890a846c7d69c4`); its file checksum and all Ads runtime/test changes remain byte-identical to the approved RC. No Production writes occurred during reconciliation.

The revised authorization must name the successor and ledger 803→804. Apply only the exact reviewed Ads migration; do not replay unrelated source migrations or deploy Edge Functions. Recheck main/live, ledger and the exact RPC guard immediately before execution and stop on further drift. Existing Staging acceptance remains applicable because the Ads changes are unchanged. Focused merged-build and Ads/attachment compatibility checks accompany this successor; Production acceptance remains pending approval.

Successor compatibility verification: 53 tests pass across seven Ads/Media files; production build passes with the existing chunk-size advisory. Documentation Impact: updated release evidence and deployment/rollback baseline only; no new business contract.
