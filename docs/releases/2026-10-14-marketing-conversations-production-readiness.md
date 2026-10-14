# Conversations Production activation and Meta review packet

14 October 2026 · Read-only readiness audit; no deployment or external submission authorized.

Source: canonical dev `367aead3c62edf2aaff5b1df4df731213715ce5e`. Scope: Messenger and Instagram Messaging **with Facebook Login**, not Instagram Login or WhatsApp. Parent: [Marketing release assessment](2026-10-14-marketing-staging-readiness.md).

## Decision and verified status

**NO-GO for general-customer Production Conversations, including unrestricted staff replies.** Staging implementation and prior real acceptance are reusable release evidence, not Production approval. This audit made no OAuth, subscription, permission, member, message or business-data changes; no secret values were retrieved.

| Check | Current evidence | Consequence |
|---|---|---|
| Meta App 2204918033458414 | Dashboard: Published; Publish page offers Unpublish | Live publication alone does not approve messaging access |
| Business Portfolio 769752343368384 | Legal name The Y Advisory Sdn Bhd; Business Verification **In review** | No completed verification claim |
| Tech Provider Access Verification | Business Info: **Not verified**; app dashboard asks to become a Tech Provider before review/access to other businesses | External-business rollout blocked pending Meta requirements/decision |
| pages_messaging | Permissions and features: **Ready for testing**, 11.4k calls; Actions offers Add to App Review | No approved Advanced Access evidenced |
| instagram_manage_messages | **Ready for testing**, 189 calls | No approved Advanced Access evidenced |
| pages_manage_metadata / pages_show_list / pages_read_engagement / instagram_basic | All **Ready for testing** | Supporting permissions also need appropriate reviewed access for the external-customer use case |
| Human Agent / Business Asset User Profile Access | Add, not enabled in inspected table | No extended-window or optional profile-access claim; not requested by this packet |
| Production Supabase | 651 migrations, latest 20261013091929; zero Marketing tables/RPCs/Edge Functions/cron; Brands and member Brand scopes absent | Not an installed Marketing runtime |
| Production server configuration inventory | No MARKETING_* server secret names and no Marketing Vault entries found | Values were not accessed; independent Production custody/setup required |

Meta's UI does not show a literal Standard/Advanced column in this use-case table. Record the exact **Ready for testing** status; do not relabel it approved, rejected or pending review. App Review has not been submitted by this audit. No approval ID or completed grant is evidenced. Business Verification, Tech Provider Access Verification, App Review, OAuth grants, Page tasks and actual delivery are separate gates.

### Official requirements and channel prerequisites

Meta's [Conversations API documentation](https://www.postman.com/meta/messenger-platform-api/folder/22794852-255610cd-47f5-4f4d-b3fa-71aec360be9a) requires Advanced Access for conversations with people without an eligible app/account/Page/business role. Its Instagram Facebook Login path requires a Professional account, a linked Page, the messaging permissions and a verified app-owning business. The inspected Messenger setup explicitly requires App Review before interacting with everyone. Internal role-based testing success cannot establish general-customer availability.

- Messenger: Page token, `pages_messaging`, `pages_manage_metadata`; discovery/history also uses `pages_show_list` and `pages_read_engagement`. Exact authorizer must have MESSAGE/MESSAGING or the supported equivalent Page task. Revalidate current token/app/account/granular target/generation and expiry.
- Instagram with Facebook Login: `instagram_basic`, `instagram_manage_messages`, `pages_manage_metadata`, linked Professional account and exact Page messaging-task evidence. Retain the current discovery dependencies; do not substitute Instagram Login's business-prefixed scopes. Account's API-message access must be allowed. Missing linked identity or authorization stays Action Required.
- The current exact-authorizer Business assignment fallback may need existing `business_management`; justify only its actual assignment-read use if included in review. Ads/publishing scopes are not Inbox approval substitutes. Do not add scopes in this preparation.
- [Meta's Send API](https://www.postman.com/meta/messenger-platform-api/documentation/iyp204x/messenger-platform-api?entity=request-22794852-c54925d1-6422-49cd-a2d2-e275e3f559c4) requires Page messaging authority and a valid response window. FeedX implements the standard 24-hour window; no Human Agent extension or cold outbound messaging is supported here.
- Eligible external customers must not need tester roles, Accounts Center linking or Developer Console configuration. Such steps belonged to restricted test acceptance only.

Primary runtime sources: [App dashboard](https://developers.facebook.com/apps/2204918033458414/dashboard/), app Use cases → Messenger → Permissions and features/API Settings, [Business Info](https://business.facebook.com/latest/settings/business_info?business_id=769752343368384). Official Developer documentation endpoints intermittently returned HTTP 429; Meta-owned Postman documentation and the authenticated Meta UI were used. No third-party interpretation is treated as authority.

## Existing Staging implementation and evidence

Read-only canonical records retain all four Idamans/Hola channel connections as `test_authorized`, current-generation receive/send authorization and signed webhook evidence, health messaging state `delivery_verified`, execution evidence false. Send authorization describes capability, not permission to execute now.

| Brand/channel | Generation | Last health check UTC | Signed inbound retained UTC |
|---|---:|---|---|
| Hola / Facebook | 1 | 2026-10-14 02:57:08 | 2026-10-13 17:09:34 |
| Hola / Instagram | 1 | 2026-10-14 02:11:23 | 2026-10-12 19:08:04 |
| Idamans / Facebook | 5 | 2026-10-14 02:58:10 | 2026-10-11 02:12:19 |
| Idamans / Instagram | 5 | 2026-10-14 01:47:13 | 2026-10-11 02:50:00 |

Both Facebook connection-health records show app/Page echoes true. Instagram echo-field absence is not a Facebook-style echo defect. Genuine historical delivery is retained; no new webhook or send acceptance was performed. Source authorization refresh is still required before any future send; historical timestamps do not keep the 24-hour window open.

Live Meta configuration was read without saving:
- Sole displayed Valid OAuth Redirect URI: `https://ujkzdaaadnvcfayuldmh.supabase.co/functions/v1/marketing-meta/callback`; HTTPS and strict redirects enabled.
- Deauthorize and deletion URLs point to the Staging marketing-meta endpoints.
- Page and Instagram object callbacks both point to `https://ujkzdaaadnvcfayuldmh.supabase.co/functions/v1/marketing-inbox/webhook`.
- Page v26.0 subscribed fields: messages, messaging_postbacks, message_deliveries, message_reads, message_echoes.
- Instagram v26.0 subscribed fields: messages, messaging_postbacks, messaging_seen.
- Existing Login Configuration 1398015649111006 retained; no OAuth initiated or grants expanded. Permission-table access status is independent of the already granted token scopes.

Evidence retained: `qa/staging/marketingInboxLive.md`, `docs/testing/marketing-inbox.md`, scoped receipt/history/outbound-readiness rollback suites and the parent release assessment. They cover real Messenger/Instagram inbound, human-confirmed FAQ reply/API receipt, provider echoes/read evidence, role/Brand isolation and retry safeguards. No redundant inbound or send tests were run.

## Self-service contract and remaining gaps

Existing bind flow: authorized member chooses an accessible Brand → official OAuth → explicit Page/linked Instagram discovery → exact asset/ownership confirmation → encrypted canonical binding → independent capability/health verification → guarded installation/readback of eligible subscriptions → scheduled health checks and ingestion. Role actions intersect member Brand access and workflow authority on the server. Credentials and existing other-Brand bindings are not overwritten by selecting another Brand.

Automatic Page fields are the union of existing fields and the required channel fields. Facebook includes message_echoes. Instagram's app-object messaging_seen is not incorrectly installed as a Page field; its linked Page installation uses messages, messaging_postbacks and message_reads. Repairs require valid exact-account/authorizer/generation, active app callback and required permissions; durable pending/unknown checkpoints are reconciled instead of blindly rewritten. Six-hour checks retain bounded retries and recent-message recovery, distinct from signed delivery proof.

| Operational state | Required evidence / recovery |
|---|---|
| Configuration Ready | Existing UI term Configuration Verified: valid authorization, expected app callback and required subscription installation; not proof a real message arrived |
| Awaiting First Delivery | Central setup valid; wait for a genuine customer event. Do not fabricate test webhooks as acceptance |
| Delivery Verified | A genuine signed event for this exact account/generation reconciles with the provider; API-only recovery cannot establish this |
| Needs Attention | Reconnect for expired/revoked grants, authorize required account/task, or retry eligible subscription repair. App-review/callback problems route to platform administrator, not ordinary Brand staff |

**Conditional self-service, not fully Production-operational today.** Once central setup/access is approved and environment blockers below are corrected, eligible Brand administrators should not configure Developer settings. Staff then use FeedX permissions without individual Meta login. Missing Meta review, asset authority or customer account eligibility cannot be repaired by FeedX alone. This audit did not connect a new Brand or claim unrelated-customer acceptance.

## Exact one-time Production setup plan — proposed, not applied

Production frontend: `https://os.feedx.my`; backend: `https://oyfobxdoyfuzsodogpgs.supabase.co/functions/v1`. Public privacy policy remains `https://feedx.my/privacy`.

| Purpose | Proposed Production URL |
|---|---|
| OAuth redirect | https://oyfobxdoyfuzsodogpgs.supabase.co/functions/v1/marketing-meta/callback |
| Page + Instagram callback | https://oyfobxdoyfuzsodogpgs.supabase.co/functions/v1/marketing-inbox/webhook |
| Deauthorization | https://oyfobxdoyfuzsodogpgs.supabase.co/functions/v1/marketing-meta/deauthorize |
| Signed data deletion | https://oyfobxdoyfuzsodogpgs.supabase.co/functions/v1/marketing-meta/data-deletion |
| Opaque deletion status | https://oyfobxdoyfuzsodogpgs.supabase.co/functions/v1/marketing-meta/deletion-status/<confirmation-code> |
| Secret-authenticated scheduler | https://oyfobxdoyfuzsodogpgs.supabase.co/functions/v1/marketing-worker/tick |

**App/environment decision first.** Current resolver accepts one callback per object and matches the Staging URL exactly; there is no environment-routing webhook gateway. Prefer a separate approved Production Meta app/login configuration to preserve Staging. Alternatively approve an explicit existing-app callback/deauthorization/deletion cutover, acknowledging disrupted Staging delivery and shared app credential custody. Adding an OAuth redirect alone does not create two webhook destinations. No new app or cutover is authorized here; do not invent IDs or copy Staging app secrets/tokens.

Required server-only configuration:
- `MARKETING_META_APP_ID`, `MARKETING_META_APP_SECRET`, `MARKETING_META_LOGIN_CONFIG_ID`, `MARKETING_META_GRAPH_VERSION`: actual approved Production app/config values. Align supported runtime and callback field versions.
- `MARKETING_META_TOKEN_ENCRYPTION_KEY`: independent random 32-byte key, encoded base64/base64url as required by AES-GCM implementation. Rotation uses the supported previous-key slot. No Staging encrypted credential rows copied.
- `MARKETING_INBOX_WEBHOOK_VERIFY_TOKEN`: independent secret, identical only between the Production verifier and approved Production app callback setup; never expose in UI/logs.
- `MARKETING_WORKER_SECRET`: independent secret, matched by Production Vault `feedx_marketing_worker`; scheduler transmits via x-marketing-worker-secret, never URL.
- `MARKETING_ERASURE_JOURNAL_READ_WRITE_TOKEN` and `MARKETING_ERASURE_JOURNAL_ENCRYPTION_KEY`: independently approved Production private journal/store/key custody outside DB restore boundary; retain existing replay/revocation rules. No Stage store reuse or new provisioning in this audit.
- Supabase project URL/anon/service credentials must be the intended Production project's managed values; service credentials server-only.
- Keep `MARKETING_INBOX_SEND_ENABLED` false/unset. Do not populate the Staging test-peer switch as a substitute for Production authorization. Automatic AI replies remain disabled; AI provider use needs separate Production configuration/approval, not the prior Staging key authorization.
- Keep Ads/publishing execution gates closed; no Staging test account grants or ad execution fingerprints copied.

### Code/database work required before configuration can operate

These are confirmed release implementation blockers, not missing secrets alone:
1. `_shared/metaSecurity.ts`, marketing-meta/inbox/worker/privacy entry points and `_shared/metaInboxVerification.ts` fix project/origin/callback to Staging. Introduce an explicit approved environment mapping with fail-closed project/origin checks; never simply delete guards. Include all callers and crypto binding behavior.
2. Applied `marketing_meta_begin` still requires the exact Staging redirect. `marketing_tick` still posts to the Staging worker. Prepare forward environment-specific migrations plus exact CORS/callback/deletion settings; legacy migration editing is not a live correction.
3. marketing-inbox has hardcoded Idamans account IDs and test peer allowlists. Applied `marketing_inbox_send_material` accepts `test_authorized`, not `production_authorized`; related customer-profile material retains test-status assumptions. Replace acceptance-only status/account/peer checks through a separately reviewed canonical Production connection-activation policy. Retain member/role checks, exact scopes/tasks, current-generation authority, opt-out, window, version-bound draft policy and execution authorization. Until then general-Brand Staff Manual Reply is NO-GO.
4. Marketing worker is shared: it calls Ads change expiry/scheduling, Inbox events, privacy journal, media cleanup and publishing reconciliation RPCs. Empty Production cannot run only the Inbox function. Audit the smallest complete transitive schema/RPC/RLS dependency set or explicitly review worker decoupling; do not install unrelated features just to satisfy an unexamined manifest.

### Minimal activation order and rollback

1. Resolve app/environment strategy and Meta review/access approvals; retain closed execution. Approve release scope and actual Production Brand/admin bootstrap without copying QA/test identities.
2. Build an isolated then-current main-baseline candidate with the environment/activation corrections above. Review migration bodies, grants, internal tenancy, role/member scope and worker dependencies. Rehearse on a disposable Production-schema clone. Do not blanket merge dev.
3. With separate Production release authorization, install compatible database/private storage/privacy foundation, independently custodied secrets, Edge endpoints and UI, then scheduler. Preserve existing Restaurant/Factory authority. No provider mutation in this document is authorization to perform it.
4. With explicit provider-setup approval, register/verify proposed OAuth, signed callbacks and required app fields. New eligible Brand connection may then authorize its own exact assets and automatic Page installation; no Developer settings for Brand users.
5. Verify Production project/SHA and closed-send state, role plus per-member Brand denial, callback signatures, durable event processing, six-hour health scheduling, exact echo configuration and bounded recovery. Confirm first real inbound separately per channel. Read-only recovery is not webhook delivery proof.
6. Only after separately approved access and canonical execution configuration, run one approved staff-reply acceptance per intended channel within a live window. Confirm provider acceptance; add delivery/read only when exact evidence arrives. Keep AI automatic replies off.

Rollback: record code/Edge versions, migration hashes, schedules and gate states; disable sending/workers before incompatible rollback. Prefer compatible code rollback/forward migration, preserve existing records and uncertain provider results. Do not restore the DB as routine UI rollback. Any real restore requires independent erasure/revocation replay before access reopens. App callback cutback is a separate external action needing approval.

## App Review submission materials — draft only

**Purpose statement:** FeedX FNB OS, operated by The Y Advisory Sdn Bhd, lets authorized business staff receive and respond to customer-initiated Messenger/Instagram messages in a Brand-scoped Conversations workspace. The connecting administrator selects exact business accounts. Staff responses are human-confirmed; AI suggestions remain editable drafts. No autonomous replies or unsolicited messaging are included.

| Permission | Proposed justification / demonstration |
|---|---|
| pages_show_list | List only authorized Pages for explicit account selection; demonstrate discovery and exact binding |
| pages_manage_metadata | Install/read back the selected Page's Inbox subscriptions, including Page-authored message echoes; no Page-content editing |
| pages_messaging | Read customer-initiated Messenger threads, send an authorized staff response within the standard window, reconcile receipts/echoes |
| pages_read_engagement | Supported Page/conversation discovery/history evidence consumed by the existing API path; do not claim unrelated analytics for this review |
| instagram_basic | Resolve selected Page's linked Professional account and stable identity; no display-name matching |
| instagram_manage_messages | Receive/read and human-reply to the linked Professional account's DMs, preserve message identity and seen evidence |
| business_management, if required by retained assignment reads | Read exact connecting authorizer's Page assignment evidence; include only the actual implementation path and existing scope, no generic business-management claims |

Reviewer walkthrough/storyboard:
1. Sign in as a restricted authorized FeedX reviewer; show Brand scope and Connections, no Organization setup.
2. Show existing recorded official Facebook Login consent/account discovery; select exact permitted Page/linked Professional account and confirm ownership. Do not initiate another OAuth solely for this packet.
3. Show independent Configuration/Awaiting Delivery states, installed subscriptions and actual previously verified inbound Conversations evidence per channel.
4. Open the approved FAQ example: question “What is your brand name?” and human-approved response “Our brand name is Idamans Food Industry.” Show the already accepted outbound receipt, not a new send. AI output is not described as automatic.
5. Show assignment, internal notes, takeover and the disabled-expired-window reason. Distinguish provider accepted from delivered/read.
6. Show restricted Brand denial and disconnection/deletion paths using existing recordings/evidence; do not disconnect a real connection or reveal customer data/tokens.

Existing evidence: `qa/staging/marketingInboxLive.md`; `qa/staging/marketingInboxOutboundReadiness.rollback.sql`; `qa/staging/marketingInboxReceipts.rollback.sql`; `qa/staging/marketingHubInboxHistory.rollback.sql`; parent release assessment's authenticated role/Brand and subscription acceptance. These are supporting engineering evidence, not a substitute for Meta's requested video/reviewer access.

**Not yet submission-ready:** final app/environment identity, review-form questions, concise redacted screencast files, securely issued reviewer login/test assets and any required external review agreement are not provisioned/submitted here. Reuse acceptable existing recordings if available; otherwise request narrow approval before recording any new external OAuth/message action. Do not upload unredacted SQL/logs/private message evidence. Privacy URL is public v1.0; retain unresolved legal decisions in the existing privacy decision registers. Do not promise DPO appointment, universal retention or processor agreements are resolved. No Human Agent, Ads, publishing, comment or new AI permission is added to this Inbox review scope.

## GO / NO-GO gates

- **A — implementation evidence reusable:** brand-bound onboarding, guarded subscription/echo repair, signed webhook dedup/order, manual reply receipts/reconciliation, standard-window enforcement, role/member Brand isolation and prior Staging tests.
- **B — configuration/release work:** audited/rehearsed Marketing/Platform baseline, explicit environment support, Production connection activation policy, independent credentials/journal, jobs and callback setup. None is installed merely by this report.
- **C — external approval:** completed relevant Meta business/access verification and required permission Advanced Access; app/callback strategy and changes; Production release/bootstrap; staff execution configuration and separately approved real acceptance sends.
- **D — not verified:** unrelated-customer Live access, Production OAuth/token/binding/real inbound/outbound, Production restore/rollout rehearsal. Configuration checks alone cannot close these.

GO for receiving only when A+B, required Meta C and genuine channel inbound evidence pass. GO for Staff Manual Reply additionally requires reviewed Production activation policy/configuration, current account authority/window and narrowly authorized end-to-end acceptance. AI Automatic Reply remains NO-GO. Missing any applicable gate keeps that channel/capability unavailable; no fallback to unrestricted access.
