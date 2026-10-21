# WhatsApp Phase 2 dormant Production candidate

22 October 2026. Local branch `codex/whatsapp-dormant-production`, isolated from Production/main/live `4dcef1a96ded917051acb4952cd02065b5aef896`. Not pushed, deployed or activated. The final handoff identifies the single commit containing this packet. [Exact manifest](2026-10-22-whatsapp-dormant-production-manifest.json).

## Verified baseline and source reconciliation

Production `os.feedx.my` remains READY deployment `dpl_8huixQ2XwTe2FiBf9hJG94eNm5Bt` at the exact baseline SHA, ledger **845**, zero WhatsApp connections. Staging remains `704cf9be9ec8892e5e4020d06e26ed69c1f113b8`. Rechecked before sealing the candidate. Production functions remain Meta v26, Inbox v25, Worker v29, Privacy v19, Ads v18 and Drive v19.

Four historical source files are recovered byte-for-byte from their actual Production ledger statements: `20261015071332_factory_dashboard_single_snapshot`, `20261015170923_google_reviews_production_sync_dispatch`, `20261016041905_platform_team_nickname_projection`, and `20261016083440_marketing_task_attachment_documents`. The attachment source alias `20261016074750` is replaced by its already-applied Production identity; content is identical. These four files are **source recovery only**, never release execution. No scheduler SQL is replayed.

The manifest reconciles all six Staging aliases: Creator source `20261014030902` → receipt `20261014032018`; `20261014033913` → `20261014033939`; `20261014045243` → `20261014045332`; ownership `20261019030353` → `20261019031703`; status `20261019034153` → `20261019034718`; attention `20261019035046` → `20261019035150`. Five pairs are byte-identical. Historical XHS preview SQL differs: preserve the existing Production variant and prior current-authority reconciliation, not replay or rename either live ledger. Production status/attention are already applied; broader Staging ownership is excluded. No edits to dev, Staging source, or either shared ledger were made.

The candidate's migration source identities now equal **all 845 actual Production receipts plus exactly five new files**. Source-history drift is reconciled locally; no remote `migration repair`, SQL replay, broad `db push` or ledger equalization is authorized.

## Exact new migration execution order

Use the allowlist below in this order, within an approved guarded transaction and with exact receipts. The CLI-generated compatibility timestamp is later than its dependents: it **must run first**. Do not infer execution order from a directory sort.

1. `20261021173525_marketing_whatsapp_production_compatibility.sql`
2. `20261021140812_marketing_whatsapp_connector_foundation.sql`
3. `20261021150315_marketing_whatsapp_embedded_signup.sql`
4. `20261021150808_marketing_whatsapp_signup_recovery.sql`
5. `20261021163645_marketing_whatsapp_lifecycle_readiness.sql`

Expected Production ledger after separately approved execution: **845 → 850**, provided preflight detects no intervening release. The four WhatsApp files match installed Staging receipt bytes exactly. The new compatibility file adds only `inbox_automation_owner` (default unknown, existing vocabulary constraint) and nullable `inbox_automation_generation`; it does not add ownership commands, provider-context projection, native-automation policy or social AI lifecycle. No approvals, credentials, connections or fixtures are seeded.

## Frontend and Edge scope

Connections mounts `WhatsAppConnections` with the existing Brand scope, services, permission checks, feedback surfaces and Modal. Its official v4/v5 SDK helper remains dormant. Inbox adds WhatsApp filtering, identity fallback, disabled reply copy and a WhatsApp-only mobile-echo label; existing FB/IG labels and parser remain intact. Existing CRM identity and consent authorities are unchanged. No package or lockfile changes.

Deploy **only `marketing-meta` and `marketing-inbox`**, preserving `verify_jwt=false` and their in-handler Auth/provider-signature boundaries. Candidate entry points and every transitive local dependency have exact SHA-256 fingerprints in the manifest. Supabase assigns deployment versions at execution time; no prospective version is reserved. Captured rollback baselines are Meta **v26** (`be12b98651f9658857f02f1faaa416abf9fdea2165220ee1fb50f19c61ffbc25`) and Inbox **v25** (`e8c1c67c3d4419d2c4547613df157fd67f8c3bcd430a3ea3e0175f79d3332bd2`).

Meta adds the WhatsApp handler and onboarding helper. Inbox adds the WhatsApp message/status/echo normalizer and encrypted lifecycle helper. The shared social adapter explicitly rejects other delivery channels. Production runtime identity, origins, OAuth routing, encryption and the social verification/parser remain exact main bytes; the WhatsApp callback uses `RUNTIME_SUPABASE`. A type-only annotation makes the retained Creator diagnostic result type-check without changing its runtime behavior.

Meta's older deployed dependency snapshot converges to already-committed Production/main helpers on redeployment: shared execution adds existing independent AI guards, Graph has existing bounded/redacted profile diagnostics, Inbox has existing operational-risk/outlet context, Privacy has existing stronger deletion read-back, and Creator catch handling has existing type-safe access. These are preserved main dependencies, not Staging additions. The manifest lists every difference from each live bundle and its original rollback fingerprint. Existing Production route/privacy/execution regressions cover the resulting bundle.

Do **not** deploy Worker, Privacy, Ads, Drive, Google Business or any other function. Keep Job 10 inactive, jobs 11/12 active and existing Google review scheduling unchanged. Worker v29 already invokes the patched canonical Inbox drain; no Worker code or scheduler change is required.

## Disabled authority and verification

Leave `MARKETING_WHATSAPP_ONBOARDING_ENABLED` absent/false; install no WhatsApp configuration secrets and seed no platform/pilot approvals. Deployment grants no number selection or provider mutation authorization. WhatsApp SQL send-material and AI-prepare authorities reject execution regardless of `MARKETING_AI_ENABLED`; adapter rejection and unchanged campaign execution whitelists remain independent boundaries. Preserve the existing general AI flag and FB/IG Publishing/Inbox policy.

L3 scoped Production integration: reused completed Staging `704cf9be9` lifecycle, provider, concurrency, scope/RLS, expiry/cleanup/reconnect and once-only-sync evidence; no broad QA repeated. Candidate verification:

- **148 tests / 15 focused files passed**: WhatsApp UI/SDK/provider, Production app/origin/auth checks, signed durable ingestion and failure acknowledgement, FB/IG Inbox/Connections, Graph, OAuth, privacy/execution gates and Worker scheduling.
- **72 manifest/runtime tests passed**; exact artifact and dependency fingerprints, retained Production bytes and five-file allowlist.
- Both Edge entry points pass Deno type checking; frontend build passes with existing chunk-size warnings.
- All five migrations pass against a local **PostgreSQL 17.6** schema-only clone of actual Production columns/types/defaults/constraints/indexes, function definitions and relevant triggers. Only the nine expected existing authorities change. Synthetic local assertions preserve FB/IG rows/ownership values, deny WhatsApp identity/generation/phone conflicts, keep receiving/send/AI closed, and protect immutable receipts/private helper privileges. Everything rolls back; no Production rows or credentials were copied.

The local catalog is a scoped compatibility clone, not a full Supabase Auth/RLS/runtime replica. Existing Staging L3 supplies those lifecycle/security results. No real Meta eligibility, number or delivery is claimed. Reproduce offline with `node qa/release/rehearseWhatsAppDormant.mjs <absolute-schema-capture-directory> <absolute-embedded-postgres-module-file>` using the retained local read-only capture under `/private/tmp/feedx-whatsapp-production-evidence`; the runner accepts no remote database URL. The temporary test runtime adds no FeedX dependency.

## Separately approved delivery and rollback

After approval for the exact candidate SHA only:

1. Recheck main/live SHA, ledger count/version fingerprint, baseline Edge versions/hashes, zero WhatsApp connections, disabled gates, existing runtime policy and scheduler states. Stop on drift.
2. Execute only the five new files in explicit order, with lock timeout/advisory guard and exact ledger receipts in a transaction. Any failure before commit rolls back all five. Verify ledger 850 and receipt fingerprints before continuing.
3. Deploy only the two allowlisted bundles from the exact candidate, preserving authentication settings; record actual resulting versions and fingerprints. No secrets, Meta settings or approvals are part of delivery.
4. Advance main once to the approved candidate for one canonical Production Vercel Git deployment. Verify READY exact SHA and the existing Production aliases; no second CLI/API deployment or unapproved promotion.
5. Proportional read-only smoke: dormant WhatsApp states, existing populated FB/IG Connections/Inbox/Publishing, CRM/Ads/Drive reads and unchanged worker/scheduler health. No messages, AI generation, campaign run, real number or provider write for smoke.

Before SQL commit, roll back the transaction on failure. After commit, retain forward schema and immutable evidence; do not drop tables/columns, replay/down-migrate history, restore a database or rewind receipts. Stop and report failures. Proposed application rollback is the captured Meta v26 and Inbox v25 **separate original bundles**, plus prior READY frontend deployment `dpl_8huixQ2XwTe2FiBf9hJG94eNm5Bt` / baseline SHA. Preserve original per-function dependencies rather than reconstructing an old bundle from current main. Read-only capture `read-only-baseline.json` retains their source; manifest records every rollback file fingerprint. Rollback deployments/promotions or forward corrections need explicit approval unless expressly included in release authorization. An application rollback does not remove forward schema.

## Meta and pilot remain separate

Current Production app `2182829996001809` is published, but business verification remains In review and Tech Provider access Not verified. WhatsApp Advanced Access is unproven; existing two General/User-token configs are FB/IG configs, SDK login is off, allowed SDK domains empty, and the WhatsApp callback/five fields are unconfigured. Graph runtime is v26.0; it is independent of signup v4/v5.

Separate Meta approval must cover verification/App Review and required WhatsApp permissions, a dedicated Coexistence configuration, exact SDK origins and Production callback `https://oyfobxdoyfuzsodogpgs.supabase.co/functions/v1/marketing-inbox/webhook` with `messages`, `smb_message_echoes`, `account_update`, `history`, `smb_app_state_sync`. Preserve existing social configs. A later one-Brand pilot separately authorizes exact business/number or staged approved-number hash, encrypted binding, WABA subscription and once-only contacts/history synchronization. No phone registration/deregistration, replacement, sending, AI or campaigns is included. Local Pause/Disconnect is separate from provider/mobile offboarding.

Documentation Impact: Updated `docs/domains/marketing.md`; this packet/manifest records release provenance and operational approval boundaries.
