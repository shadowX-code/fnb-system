# WhatsApp receive-only message lifecycle

## Delivery and verification

This correction extends the canonical Inbox message kinds with append-only provider `edit` and `revoke` evidence, the existing worker with generation-fenced reconciliation, and existing read projections with current-message state. It adds no alternate Inbox or queue. New private helpers have no client/service-role EXECUTE grants; public RPC ACLs remain unchanged. A nonblocking per-connection/generation transaction lock serializes original/correction materialization; busy events remain pending for a later worker pass.

Original message rows retain body, ID, sequence, occurrence time and provenance. An edit cannot become an inbound message or reopen its reply window. An unmatched correction is retained in the original durable queue but creates no conversation. Materialization requires exact connection, generation, peer, target provider ID and direction. Revocation is permanent in the current projection; late edits cannot resurrect it. Same-time edits order by exact provider event ID. Superseded content is excluded from ordinary list preview/search. Correction evidence remains within the existing privacy-erasure lifecycle.

The webhook verifies the original raw bytes before interpreting anything. Bounded invalid items are omitted individually with counts-only diagnostics; valid siblings still reach canonical durable ingestion. Oversized/global malformed envelopes return errors. Encryption or database failure is never silently treated as successful processing. No provider requests occur during parsing.

Focused fixtures:
- `whatsappInbox.test.ts`: edit/revoke identity and targets, inbound/mobile direction, malformed messages/metadata/statuses/collections and bounded envelopes.
- `whatsappWebhookBatch.test.ts`: real handler with synthetic raw-body HMAC, partial acceptance, signature rejection, JSON rejection, durable failure and no payload logging.
- `whatsappOnboarding.test.ts`: isolated malformed lifecycle changes, encrypted quarantine and fail-closed encryption.
- `WhatsAppConversations.test.jsx`: existing Inbox presentation and provider lifecycle provenance with disabled reply/AI controls.
- `qa/staging/marketingWhatsAppReceive.rollback.sql`: synthetic official authority setup; early edits and revocations, mobile echoes, exact deduplication, malformed normalized sibling isolation, target peer/direction/Brand/phone/generation rejection, stale queued events, unchanged original evidence and reply window, list/detail/search projections, grants and absent CRM/consent/AI effects. Everything rolls back; never run on Production.

Reuse completed Conversations/Lifecycle fixtures rather than repeating broad QA. Live Meta event delivery remains unverified while onboarding is disabled.

## Smallest future authorized history-to-Inbox contract — NOT IMPLEMENTED OR ENABLED

1. Explicit privacy/operator approval pins one tenant/Brand, connection, current generation, exact WABA/phone, provider synchronization request receipts, purpose, retention period and bounded time interval. Staff must also have existing Inbox Configure access. Meta history-sharing consent is separate from marketing consent; neither permits CRM/contact creation.
2. Accept only unexpired encrypted quarantine produced after valid Meta HMAC and exact provider identity validation. Pin immutable payload hashes, synchronization phase/chunk/progress and receipt lineage. Verify declared sharing or decline. Never treat an API request receipt, missing chunks or an empty phase as proof of complete history. Existing 24-hour quarantine may expire before approval; do not extend it silently or replay once-only synchronization.
3. A service-only, leased and generation-revalidated worker promotes bounded provider-authorized 1:1 text evidence into the existing canonical event/message stores under `historical_import`. Reuse the history job/approval lifecycle with an explicit WhatsApp adapter; its existing FB/IG authority must not be widened by a channel allowlist alone. No browser-supplied bodies, bulk table writes, address-book import or global history enumeration.
4. Deduplicate across live, mobile and historical evidence by connection/generation/provider-message ID, preserving peer/direction identity and immutable originals. Apply existing edit/revoke evidence before projection; no import may resurrect deleted evidence or bypass privacy tombstones. Retain provider occurrence time separately from import time, keep live activity/unread/AI/reply-window state unchanged and label imported provenance.
5. Report honest coverage/gaps and provider limits. Current Meta guidance describes up to 180 days, excludes groups, and supplies historical media IDs only for recent media. Initial scope should be text only with honest placeholders; media retrieval needs a separate privacy/retention contract. No synthetic filler or promise of all mobile history.
6. Pause, disconnect, expiry, revoked Brand permissions and generation changes stop promotion. Verified privacy erasure removes original/correction/import/quarantine evidence under the existing authority; immutable request receipts may retain only permitted operational metadata. Uncertain synchronization requires provider/support evidence, not automatic replay/offboarding.

Prerequisites: Meta Business/Tech Provider/permission eligibility and dedicated Coexistence config; exact pilot authorization; review of provider history consent and real payload sizes; signed fixture coverage for phases, out-of-order chunks, live/history overlaps, edits/revocations and privacy deletion; separately approved retention and coverage UI; Staging L3 verification and exact Production approval. None is seeded by this correction.

Official reference: https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users (read 25 October 2026). No live onboarding, provider settings, history promotion, sends or AI activation are part of this delivery.

## Staging delivery evidence — 25 October 2026

- Forward migration receipt/source `20261024185401_marketing_whatsapp_message_lifecycle`, SHA-256 `7a2f3c1cf3631fdf9040c5288fb81c54e93c7b7736e2805366bbf787d72ec990`. Rehearsed transactionally before application, then the full fixture passed against the applied authority with all synthetic rows rolled back.
- `marketing-inbox` v74 ACTIVE, bundle `c163cd05753343af11f008a6fa52adfd72e97091e767fcc53c7b06a7b44dffb4`. Replaced only its entry point and the two WhatsApp normalization helpers; all other deployed dependency bytes were preserved. No marketing-meta or Worker Edge deployment.
- Seven focused test files / 70 tests passed, including shared FB/IG parsing, signed HTTP boundary, UI rendering, onboarding/quarantine and outbound-disabled adapters. `npm run build` and `git diff --check` passed. The SQL fixture passed both in migration rehearsal and after application, including early inbound edits and mobile revocations.
- No platform readiness, pilot approval, WhatsApp connection or quarantine row remains on Staging. No new security advisor finding for the private correction helpers; client EXECUTE remains revoked.
- Production remains a separately approved release: one migration, the scoped Inbox provenance UI, and only the marketing-inbox Edge changes, preserving its own existing runtime origins/dependencies. Migration before Edge, then frontend through canonical Git. Rollback requires separate approval; preserve append-only correction rows, deduplication and privacy evidence. Do not drop the new kind allowance after any correction evidence exists, replay synchronization, or enable execution as a recovery action.
