# Facebook organic post Insights — Staging, 13 October 2026

## Root cause and trace

The deployed pre-fix worker used `metaSynchronization.ts`: core Page posts with shares, protected Likes/Reactions edges, a Comments read gated on `pages_read_user_content`, and only the two current Facebook view Insights. It hard-coded legacy Reach unavailable. Facebook Interactions was not collected; both UI consumers required all reaction/comment/share counts to derive it. Thus successful Views did not imply successful engagement. The same sync-finish RPC persisted exactly the values/reasons received; no persistence loss explained the missing engagement.

Existing Hola and Idamans Page grants include `read_insights` and `pages_read_engagement`, but not `pages_read_user_content`. Fresh token diagnostics and exact Page identity checks distinguish denied operations from a missing or revoked token. Numeric-only bounded GET probes used the current leased connection and sealed credential; no provider bodies, credentials, captions or person identities were logged. Temporary probes were removed from the final adapter.

At 01:09 UTC Meta accepted the real Hola Reel post `113234221623434_1032635969701152` (permalink `/reel/1045391245047396/`): reactions Insight `{like:10,love:1}`, activity Insight `{share:1,like:11}`, both HTTP 200. The protected Likes edge returned HTTP 400/code 10 referencing `pages_read_engagement` despite that scope being granted; Reactions/Comments returned code 10 referencing absent `pages_read_user_content`. Legacy `post_impressions_unique` returned code 100. This proves the supported Insights path independently of protected person-edge access, not a reason to expand permissions automatically.

At 01:13 UTC the ordinary carousel `113234221623434_968058329492250` returned reactions `{like:3}` and activity `{share:2,like:3,comment:1}`, HTTP 200. A nonempty activity map totals its returned reaction/comment/share actions; LIKE in that map already includes reactions (11 on the Reel), whereas the explicit reaction-type LIKE bucket is the Like-only count (10). These totals are not unique people or daily activity.

## Metric support matrix

| Metric | Ordinary Facebook post | Facebook Reel | Cause and final implementation |
|---|---|---|---|
| Views | Verified | Verified existing synchronized video records | `post_media_view`, lifetime; retained |
| Unique viewers | Verified | Verified existing synchronized video records | `post_total_media_view_unique`; kept separate from Reach |
| Reach | Unsupported legacy request in this v26 Staging scope | Same legacy failure; no replacement assumed | `post_impressions_unique` rejected code 100; never relabel viewers as Reach |
| Likes | Verified via explicit reaction-type LIKE bucket | Verified: 10 in sampled Reel | Adapter omitted supported aggregate Insight; fixed using `post_reactions_by_type_total.like`. Protected edge denial is separately recorded |
| Reactions | Verified via nonempty returned reaction map | Verified: 11 in sampled Reel | Same missing aggregate path; sum returned reaction types once, including LIKE |
| Comments | Verified when explicit comment action is returned: 1 in carousel | Sampled Reel omitted comment bucket: unavailable | `post_activity_by_action_type.comment` supports supplied evidence; protected complete edge is permission-blocked without `pages_read_user_content`. Omission never means 0 |
| Shares | Verified existing core count; supported explicit action fallback | Verified core/action evidence: 1 | Retain `post.shares.count`; use explicit action share bucket only if core absent. Missing both stays unavailable |
| Interactions | Verified: 6 in sampled carousel | Verified: 12 in sampled Reel | Adapter/consumer defect: collect sum of reported activity map; canonical value wins over optional complete-count fallback. Never add Likes to Reactions |
| Saves | Unsupported by current Facebook adapter/contract | Same | No fabricated counterpart to Instagram saved |

Instagram core likes/comments and separately returned reach/views/interactions/shares/saves remain independent definitions; optional Reels watch-time metrics are unchanged. Existing partial provider coverage remains partial. Facebook lifetime Page-post evidence is not asserted to be an organic-only/paid split; no Ads attribution is introduced.

## Canonical implementation and boundaries

- `_shared/metaSynchronization.ts`: two isolated aggregate Insights GETs with current permissions, nonempty finite integer breakdown validation, explicit missing buckets, invalid-token and authority failures still fatal. Same `limit=2`, cursor traversal, 40-page cycle and eligibility cadence.
- `_shared/metaGraph.ts`: non-secret Graph version accessor for evidence.
- `20261013011740_marketing_organic_metric_provenance.sql`: add per-metric source/definition/lifetime period/Graph version/actual collection time. Existing guarded sync authority sanitizes and persists it. Content Management explicitly projects it; Analytics inherits the same canonical social-post fields. Existing RLS/grants, generations, leases, uniqueness and brand guards remain.
- `contentManagement.js`, `dashboardProjection.js`, `MarketingDashboards.jsx`, `PostDetail.jsx`: canonical Facebook Interactions wins; latest valid metric source/time remains traceable; incompatible Facebook/Instagram Views/Interactions are compared by channel without a combined total. Reach is not summed. Secondary post diagnostics expose per-metric source.

No Inbox authority, webhook, queue, health scheduling, publishing permission or execution control was edited. Idamans/Hola ownership and generations remain intact. No Production, OAuth, permission expansion, external publication or outbound message occurred.

## Verification

QA level L3. Migration and both-channel fixtures passed in rolled-back Staging transactions before application, then passed against applied schema. Checks cover actual zero versus missing, exact provenance/time in both consumers, repeated-sync upsert, stale generations, invalid provenance, browser mutation denial and unauthorized-brand reads. The applied migration is 20261013011740 on `ujkzdaaadnvcfayuldmh`.

Focused adapter/projection/Content Management/Post Detail/UI and representative Inbox/health/recovery/Graph regressions passed (63 tests across the focused run and final provenance-display check). Deno checked both Edge consumers; Vite build and diff whitespace checks passed. Official CLI deployed both existing Edge consumers using their verified existing authentication configuration. The existing worker began persisting new real Facebook aggregate observations at 01:19 UTC, with source timestamps and `graph_version=v26.0`; no direct data repair was used. A canonical UI Sync Posts request was made for Idamans Facebook to verify that separate existing account through its normal scheduler.

Additional permissions are not required for the aggregate metrics verified here. If complete protected reaction/comment edges are needed when Insights omits a bucket, the exact currently absent scope is `pages_read_user_content`, with Meta eligibility/App Review and separately approved authorization as applicable. The Likes edge's denial references already-granted `pages_read_engagement`, so adding another scope is not claimed to resolve it. That external-access portion remains unchanged pending approval. Current-view and real-response evidence are retained; no claim that every historical post or omitted bucket is recoverable.
