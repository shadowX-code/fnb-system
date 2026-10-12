# Staging Meta connection and Inbox reliability — 13 October 2026

## Confirmed causes

The 12 October 18:37 UTC OAuth discovery returned one Page from Meta (`me/accounts`, HTTP 200): Idamans `622626120924115`, linked Instagram `17841473217923034`. `pages_show_list`, messaging, metadata, engagement and publishing granular targets contained only those Idamans assets. No permissions were declined/expired. FeedX accepted the one returned Page; it did not exclude a returned Hola/Happiness Page. At 18:54 UTC a later authorization returned and FeedX accepted both Idamans and Hola (`113234221623434`, Instagram `17841457435511713`), with both exact IDs in the relevant granular grants. Happiness was absent from that authorized response. These are sanitized provider discovery logs, not name-based inference.

Discovery requests 50 Pages per cursor page, at most 10 pages; incomplete traversal fails explicitly rather than silently presenting a truncated set. The granted-Page fallback runs only when accounts enumeration is empty, with at most 50 explicit `pages_show_list` target IDs. Candidates require a numeric exact ID and returned Page token; linked professional IG assets come from that Page. Brand-scoped selection marks assets owned by another brand unavailable; it never reassigns them. Smallest remaining action for an absent Happiness asset is administrator review of exact Page access and Meta's authorized asset selection, followed by a separately approved authorization if needed. No permission expansion or ownership change was performed in this task.

Hola's Messenger and Instagram webhook events actually arrived at approximately 19:08 UTC, passed signature validation, resolved to the correct connections/generation and were durably queued. Each remained blocked with `messaging_authorization_unverified`, despite `receive_verified=true`: `inbox_channel` also required `webhook_verified=true`. The signed-event recorder stamped the inbound timestamp but did not promote delivery or schedule a new check. The first message therefore needed prior first-message verification. The shared fix separates configuration from signed delivery evidence and releases authorized queued DMs after configuration verification.

Fresh canonical service checks at 19:37 (Facebook) and 19:38 (Instagram) established configuration and the stored genuine signed receipts independently. The existing minute scheduler processed both into one correct-brand conversation each. No new messages, outbound replies, sync command, reconnect, permission change or asset reassignment was used. Idamans generation 5 and Hola generation 1 ownership and disabled publishing execution were preserved.

## Implemented synchronization limits

| Behavior | Facebook | Instagram | Code / configuration evidence |
|---|---|---|---|
| Initial post history | No date lookback parameter; newest-first provider edge, `limit=2` | Same; `/media` instead of `/posts` | `supabase/functions/_shared/metaSynchronization.ts` |
| Pagination | One cursor page per worker sync; max 40 pages per cycle (normally 80 requested posts); truncation recorded when more exists | Same | `20261011052048_marketing_post_media_insights.sql`, `sync_pages>=39` |
| Persistence batch guard | Max 25 records and 1,000,000 bytes per RPC batch; not the normal Graph request size | Same | `marketing_meta_sync_finish` |
| Incremental behavior | Re-traverse recent head after cycle completion; exact post/generation upsert, no timestamp watermark | Same | `marketing_meta_sync_claim/finish` |
| Automatic cadence | Eligible after 30 minutes; pending cursor/manual request immediately eligible; one sync account per minute worker invocation after higher-priority work | Same | `20261009172624_marketing_meta_execution.sql`, minute Cron, worker |
| Insights refresh | During post synchronization; likes/reactions/comments/shares and individually supported lifetime views/viewers, unavailable values explicit | During post synchronization; likes/comments plus individually supported reach/views/interactions/shares/saves, Reel watch-time metrics | `metaSynchronization.ts`; optional denial never discards core posts |
| Observation retention | One latest post projection per connection/generation/post, overwritten metrics and `observed_at`; retained rows across generations are not daily metric history | Same | `marketing_social_posts` unique key + sync upsert; no append-only daily metric series |
| Inbox coverage | Signed incoming/attachment/echo/delivery/read events, separate supported comment ingestion; postbacks are subscribed but not normalized into conversation messages | Signed incoming/attachment/echo and exact message seen receipts; separate supported comments | `marketingInbox.ts`, `metaInboxAdapters.ts`, `marketing-inbox/index.ts` |
| Queue | Default 20 events per minute worker drain; RPC accepts 1–50; dedupe by connection/generation/kind/provider event ID; max 5 processing attempts, 30/60/120/240-second retry delays | Same | `marketing_inbox_process_events`, privacy-erasure migration |
| Historical Inbox before this change | No automatic message backfill or missed-event sweep; webhook queue retries only | Same | Existing worker/verification code |
| Recovery after this change | One verified response page, 5 conversations × 20 messages, 24 hours and after connection time; exact incoming text only | Same with `platform=instagram` | `metaInboxRecovery.ts`, shared health verifier, `marketing_inbox_reconcile` |

The 30-minute post/Insights interval is eligibility, not a guaranteed delivery SLA. Health checks now have their own six-hour due time, one three-minute account lease per worker tick, and at most five transient attempts with 1/2/4/8-minute delays before a six-hour cooldown. The configuration read is reused for recovery. API recovery always declares completeness false and never verifies webhook delivery. Older/attachment-only/ambiguous/inaccessible messages may remain unrecoverable. Neither channel receives automatic outbound replies.

## Verification

L3: migration + Facebook/Instagram fixture contracts passed in rolled-back Staging transactions; fixture data never persisted. Checked first-delivery/configuration separation, API provenance, exact scope, replay, stale generation, browser denial, privacy tombstones and retry scheduling. Focused integration/UI/privacy tests passed (53 tests); representative Inbox/security/Page task/sync/role regressions passed (40 tests); Deno profile privacy tests passed (2 tests). All three Edge Functions passed Deno type checks and the production build passed. `git diff --check` passed.

The broad suite exposed pre-existing stale Marketing workspace tests (module count and removed Evidence availability heading) and a Deno-only test collected by Vitest; unrelated planner/outreach timing failures passed on a bounded-worker rerun. This task does not change those unrelated contracts.

Migration applied to `ujkzdaaadnvcfayuldmh` as `20261012193420_marketing_meta_connection_reliability`. Server-side Edge bundling returned HTTP 500; official local bundling succeeded. Canonical UI deployment and background health evidence are recorded after rollout below. Production is untouched.
