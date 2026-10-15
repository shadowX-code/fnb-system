# Production Messaging OAuth routing preparation

Scope: successor to Production application `0dbfaf4cc66217ca77dc8f4ee177766bc0241c82`. No migration, worker, Inbox function, provider configuration, credential or execution change is part of this candidate.

## Implemented contract

The shared Social Accounts service sends `purpose=publishing|messaging`. The authenticated `marketing-meta/authorize` handler resolves a server-owned configuration before creating canonical OAuth state. Publishing remains `2027095767950085`; Production Messaging requires `MARKETING_META_MESSAGING_LOGIN_CONFIG_ID=2180882642780186`, the existing Publishing OAuth opt-in, and `MARKETING_META_OAUTH_INBOX_ENABLED=true`. Unknown purpose, missing configuration and environment mismatch fail closed. Callback, encryption, state consumption, exact account selection and reconnect authorities are unchanged. A client-supplied configuration ID is ignored.

Publishing uses the existing nine provider-configured scopes. Messaging uses those same nine plus `pages_manage_metadata`, `pages_messaging`, `instagram_manage_messages`. Neither manifest nor a configured route establishes actual grants or Advanced Access. Staging keeps its existing app/configuration; no Staging provider mutation is required.

## Verification and limits

- Canonical Staging Git deployment: `6c2e96cfe21c49caca05232545b1626534ae3604`, READY `dpl_buuR4ac2qi3ErP8sdg9pa8VGhfkn` on fnb-system-staging. Local dev/origin/dev/READY SHA and the project verification script match.
- Staging marketing-meta v60 deployed; public configuration reports both routes available with the exact Staging callback and Production execution false.
- Authenticated Owner selected both connection purposes in the Staging modal and cancelled before Continue to Meta. Existing Hola FB/IG account health remained visible. No OAuth, subscription installation, credential replacement or messages were used for QA.
- Staging focused routing, UI, security, connection health, Inbox verification, subscriptions, execution and publishing tests: 75 passed; build passed.
- Candidate Production handler fixtures additionally verify nine/12-config selection, server-only config ownership and denied reconnect. Existing runtime environment tests pass. These are synthetic contract checks, not live OAuth evidence.
- The existing Inbox verification fixtures contain Staging callback URLs and must run with explicit Staging server environment; running them with a local Production server environment produces three callback-mismatch failures. Explicit Staging fixture environment passes. One existing selection UI test timed out in a combined run, then passed independently; no implementation change was made to mask it.
- Read-only Production preflight: both exact Idamans connections generation 2, publishing eligibility/execution true; jobs 10/12 inactive, job 11 active every minute; ledger 795.

## Smallest next release authorization

After rechecking concurrent main and live application/function baselines, deploy only marketing-meta from this candidate and its frontend through the existing Vercel Git release. No worker/Inbox deployment or migration is required. Preserve Publishing configuration, execution allowlist and opt-in. Keep Messaging OAuth disabled until the separately authorized reconnect is ready. If Vercel automatic assignment is paused, promotion of only the exact READY candidate to existing Production domains must be included in the release authorization.

Then separately authorize setting only the Messaging configuration ID above and the Inbox OAuth opt-in, followed by one immediate, user-controlled Meta consent using Isaac Yap and the saved 12-scope Messaging configuration. Do not edit either provider configuration. Preserve all previous authorized assets and select only the existing Idamans pair for FeedX confirmation:

| Channel | Provider account | Existing connection | Expected generation |
| --- | --- | --- | --- |
| Facebook | 622626120924115 | f2a894a9-7592-4671-bccc-ac89613cf96a | 2 → 3 |
| Instagram | 17841473217923034 | f5d8e879-94b0-4675-b5b6-0f20d74b32d4 | 2 → 3 |

Brand stays `bbe67e01-af51-401c-9dd8-b44e9a4c7f77`. Use the existing Brand-scoped Connect/selection flow for a paired confirmation: a single-account Reconnect intent intentionally permits only that account. Validate actual grants, identity, linkage and expected IDs/generations before canonical confirmation. Stop on changed generation, unexpected assets, permission denial or unresolved publishing/reply outcomes. Never force a counter or overwrite credentials directly. Other Brands and assets remain untouched.

Binding advances each generation and invalidates old authority. Fresh independent Publishing health must pass before controlled account execution is restored. Existing pending jobs remain generation-pinned and may require canonical reapproval; do not requeue them automatically. Inbox failure must not suppress independently verified Publishing.

## Subscription and live acceptance boundary

Canonical post-bind health and active Job 11 may automatically install/repair eligible subscriptions and reconcile a bounded recent Inbox window. Therefore the reconnect approval must explicitly include that existing behavior; a credentials-only approval cannot safely exclude it. No installation or reconciliation was triggered during this task.

Existing app callbacks stay unchanged. Prepare Facebook Page fields `messages,messaging_postbacks,message_deliveries,message_reads,message_echoes`; Instagram app fields `messages,messaging_postbacks,messaging_seen`, with the canonical linked-Page subscription contract `messages,messaging_postbacks,message_reads`. Preserve existing compatible fields via the existing subscription planner and generation-guarded intent/repair authority. Require provider-supported permission/task evidence; do not replace a denied field or broaden scope.

Only after configuration checks, separately approve one genuine inbound test per eligible channel: Messenger Isaac Yap App-role identity, Instagram @isaacyap with its actual role/link eligibility verified. Configuration Ready/Awaiting First Delivery cannot become Delivery Verified from a historical import or provider test flag. Verify signed real events, canonical deduplication and correct Brand attribution.

Staff Reply and AI Auto Reply remain disabled throughout these steps. A later exact-account/exact-peer reply gate, approved reply and genuine provider receipt are separate authorization; ongoing staff-reply activation follows successful per-channel acceptance. Current evidence establishes Standard/App-role testing access, not general-customer Advanced Access. General-customer messaging remains blocked pending actual Meta eligibility/review.

Documentation Impact: Updated docs/domains/marketing.md and the Production runtime environment example.
QA: L3 focused OAuth/authority verification; existing live Publishing acceptance reused. Production OAuth and delivery intentionally unverified.
