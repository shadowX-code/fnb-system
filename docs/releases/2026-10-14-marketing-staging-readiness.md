# Marketing Hub Staging readiness and Production release assessment
14 October 2026 · QA L3 for the scoped Meta subscription correction. This is a readiness assessment, not Production release authorization.

> Later Conversations audit: [current Meta access, Production configuration and draft App Review packet](2026-10-14-marketing-conversations-production-readiness.md). The baseline delta below supersedes the earlier snapshot for this audit; earlier Creator crawler statements describe the earlier cycle, not current platform coverage.

## Decision
**NO-GO for a blanket dev-to-main release.** Existing CRM, Planner, Publishing, Inbox, manual WhatsApp, Ads Analytics and Creator CRM acceptance is retained. The remaining echo correction is a small shared adapter change. Creator crawling is not deployed; the operator selected a separate implementation/hosting proposal rather than rebuilding it in this cycle.

Production has no Marketing database baseline or Marketing Edge Functions. Source integration guards deliberately permit Staging only. A Production release therefore requires an isolated dependency manifest, environment changes and rehearsal before its separate approval. Existing Staging credentials, test account eligibility, grants, folder mappings and callback registrations are not Production evidence.

## A / B / C / D assessment
A = implementation ready for inclusion in a scoped Production candidate; does not mean installed on Production.
B = ready after specified configuration/migration work.
C = needs separate external/operator approval.
D = not yet verified.

| Area | Class | Evidence and next requirement |
|---|---|---|
| CRM customer workflow | A | Prior authenticated acceptance retained: row click with interactive-control/text-selection exceptions, direct Edit/Consent, optional names persisted as null, compact import confirmation, 13 import fields plus Consent/Activity/Actions, user column preferences and POS-source projection. No actual customer was changed in this cycle. |
| Content Planner | A | Release 1fd58f663: optional revision feedback across Board/List/Drawer; independent blocking with optional reason/owner; contextual removal with confirmation; canonical Month Picker including Dark styling. Prior 57 tests, rollback checks and desktop/mobile acceptance retained. No repeated task mutations. |
| Creator CRM / manual Post entry | A | Canonical Creator/platform-account separation, explicit matching and manual fallback remain. Current Staging has zero saved Creator posts; no existing four-platform acceptance URLs can be sampled from that table. |
| Meta echo onboarding/repair | A / B | Facebook desired app/Page fields now include message_echoes; existing scope/task/account/callback, generation and write-ahead guards remain. Approved Idamans repair and Hola recheck use the canonical health queue. Live results are recorded below. |
| Fresh signed echo delivery | D | Subscription API configuration is distinct from receiving a new real echo. No new external message is authorized or sent in this cycle. Prior recovered Hola replies/receipt evidence remain valid. |
| Production database + runtime | B / D | 111 candidate migrations identified and hashed; no Production apply, compatibility rehearsal or Production smoke yet. All Marketing Edge Functions require explicit environment adaptation before Production. |
| Meta OAuth and Inbox external rollout | C | Production callback/OAuth/deletion endpoints and grants need separate configuration/authorization. Published app is not proof of Advanced Access for unrelated customer businesses. Review exact permission access levels and eligible assets at release. No scope expansion requested. |
| Google Drive | B / C | Staging connection is Connected, generation 2; only Happiness has a mapped root. Idamans/Hola mappings need explicit selected-folder approval. Production needs its own OAuth/environment setup and authorization. External restricted-scope verification/exception decision is unresolved. |
| Ads Analytics | B | Shared account remains an internal-tenant connection; each campaign's explicit Brand attribution is separate. Preserve MYR, account timezone and Unassigned organization-only totals. Production needs its own connection, explicit mappings and scheduler. No Stage campaign IDs or mappings copied automatically. |
| Controlled Ads execution | C | Remains disabled. Earlier account-status restriction and Malaysia advertiser/payer identity prerequisite remain separate from analytics access; no new identity or account-health verification in this cycle. Paused acceptance Campaign 120250881980710774 and recovery evidence must survive release. No creation/retry/spend approval. |
| CRM import background processing | B | Staging feedx_customer_import_worker is active every 10 seconds; no queued/running jobs at inspection. Prior 10,000-row disposable acceptance retained. Production must install and test the canonical job/RPC authority, with no duplicate scheduler. |
| Member Brand Access + RBAC | A / B | Retain canonical Role actions intersected with per-member Brand scope and workflow authority. Prior real restricted-token/revocation acceptance retained; no role or business-member changes now. Production migration/bootstrap must explicitly review any newly registered permissions/grants. |
| Restaurant Brand/Outlet | B | Production Outlet/Role masters exist, but Brand Master/mappings do not. Staging has five active business Brands and one mapping; do not copy Staging IDs, QA Brands or infer mappings by name. Approve actual Production Brand bootstrap and Outlet mapping separately. |
| Creator crawler V1 | D | No deployed Playwright service, server endpoint or crawler found in canonical dev or other Marketing checkout. XHS/TikTok remain manual; Facebook/Instagram inspector uses permitted retained Meta evidence. Separate proposal prepared; no automated platform coverage claim. |
| Privacy operations | C | Public Policy v1.0 does not settle DPO, controller registration, category retention, export inventory, key/recovery custody or processor/transfers decisions. Existing decision registers remain open; no automated category purge or legal filing. |

## Production baseline: verified read-only
- Vercel project fnb-system / prj_1UOKHvE6Ft4a2WXrZyZGc9LZRWLP: READY deployment dpl_GBpXCwHdWMLECajwb5n3PSPAq1Ws, Git main 5224eeade2e7438c7810c2aa8524422443e9e1ab.
- Supabase oyfobxdoyfuzsodogpgs: 651 migration records; latest version 20261013091929. brands, brand_outlets, platform_customers, platform_member_brand_scopes are absent. outlets and roles exist.
- No public marketing_* RPCs, no Marketing cron jobs and no Marketing Edge Functions found.
- Staging has 799 migration records. Comparing versions gives 158 differences, of which 104 Marketing migrations plus seven Platform/Brand authorization dependencies are scoped candidates. The other 47 are excluded from this candidate list; their presence is not permission to deploy them.
- [Candidate manifest](2026-10-14-marketing-production-migration-candidates.csv) lists exact file names and SHA-256. **Not an executable approval or proof of dependency completeness.** Inspect function/table references, provider URLs, seed DML, grants, preconditions and baseline drift; rehearse on a disposable Production-schema clone before finalizing the release list.
- Platform candidates: Brand/Outlet management, new-work serialization, Brand-facing context, per-member Brand access, save guard, scoped consumers and team projection.
- Preserve internal tenancy and isolation even though Organization is not business-facing. Brand/Outlet creation remains canonical; do not replace security tenancy with global Brand access.
- Isolate Marketing source and shared dependencies onto the then-current Production/main baseline. Do not merge all dev or include unrelated People/Payroll/Factory changes. Recheck Production drift at release time.

## Environment and provider dependencies
### Meta
Staging app 2204918033458414 and its existing Login Configuration are retained. Staging FB/IG bindings are unchanged. Existing account-level read/publish/message evidence is preserved without activating those writes.

Current scope must be verified per operation: Messenger pages_messaging + pages_manage_metadata and explicit MESSAGE task; Instagram instagram_basic + instagram_manage_messages plus linked-Page task/granular targeting. Publishing and Insights have their own contracts. ads_read does not imply ads_management, and Page ownership never implies Ads Account access.

Production preparation must explicitly establish:
1. Approved frontend origin and fixed Supabase origin; do not simply remove STAGING_SUPABASE/STAGING_ORIGIN guards.
2. Production redirect under marketing-meta, Inbox callback under marketing-inbox/webhook, signed deauthorization/deletion callbacks and server-held app secrets/token encryption key. Register only after separate authorization.
3. Separate provider credential grants/bindings and current exact-account authority; never migrate encrypted Staging tokens into Production by copying rows.
4. App callback fields plus each eligible Page installation, then genuine inbound acceptance independently. Facebook desired fields: messages, messaging_postbacks, message_deliveries, message_reads, message_echoes. Instagram retains its current messages/postbacks/seen app fields and linked Page receipt fields.
5. Approved access levels for external customers; test-role/Accounts Center workarounds are not a production SaaS onboarding model.
6. Sending retains current account/peer allowlists, standard messaging-window enforcement, staff permission, member Brand scope, draft/approval policy and independent execution flag. Absence of delivered/read events never turns a provider-accepted reply into failure.

### Google Drive
- Existing implementation requests only https://www.googleapis.com/auth/drive.readonly, with server-held credentials and brand-root containment checks.
- Current Staging redirect: https://ujkzdaaadnvcfayuldmh.supabase.co/functions/v1/marketing-drive/callback.
- Candidate Production redirect after environment adaptation: https://oyfobxdoyfuzsodogpgs.supabase.co/functions/v1/marketing-drive/callback. It is **not registered or authorized by this report**.
- Configure Production client ID/secret, encryption/rotation keys, origin and callback; choose intended Drive owner and explicit Brand roots/Favorites. Keep browsing read-only.
- Google classifies drive.readonly as restricted. External apps in Testing normally receive seven-day refresh tokens for this scope; evaluate restricted-scope verification, security assessment and any applicable exception before external rollout. Do not silently switch scopes or claim verification.
- Official sources: [Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), [OAuth refresh-token behavior](https://developers.google.com/identity/protocols/oauth2/), [restricted-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification).

### Jobs, storage and privacy
- Current marketing_tick SQL hardcodes the Staging worker URL. The candidate manifest requires a reviewed environment-specific scheduler definition; never install a Production cron pointing to Staging.
- Staging Marketing worker runs each minute and housekeeping every ten minutes. Ads reporting is six-hourly eligibility through the shared worker, not a delivery SLA; preserve bounded reporting jobs, original timezone/currency and distinct historical periods.
- CRM import uses its existing database worker every ten seconds, not the Edge marketing-worker. Preserve progress/retry/idempotency authority and reconcile in-flight imports during release.
- Install private media buckets/policies, immutable publishing snapshots and reference-safe cleanup authorities. No blanket legacy-media deletion.
- Production requires an independent erasure journal outside its DB restore boundary, with separately authorized server credentials and recoverable keys. Do not reuse the Staging Blob store/token as evidence of Production readiness.
- No restore may reopen access before erasure/revocation replay and operator validation. Retain tombstones, legal holds, provider receipts, approved revisions and unknown-result checkpoints.
- Legal decision owners and unresolved items remain in [privacy operations](../legal/feedx-privacy-operations.md), [legal review](../legal/feedx-privacy-review.md) and [retention proposal](../legal/feedx-retention-proposal.md). No decisions were marked resolved.

## Execution and release controls
Keep these closed at initial Production rollout:
- No new publishing execution authorizations/test-account grants.
- MARKETING_INBOX_SEND_ENABLED disabled; no unrestricted peer allowlist. Current adapter additionally hardcodes Idamans acceptance account IDs; general production messaging needs a separately reviewed replacement of this test gate, not bypass.
- Autonomous FAQ/AI replies off; Suggest only. Existing Staging OpenAI use approval is not Production AI approval.
- MARKETING_ADS_EXECUTION_ENABLED disabled and exact execution approvals absent. Copilot remains advisory; production provider/model/budget/cost configuration needs approval.
- WhatsApp remains manual Click-to-Chat with staff confirmation, consent rechecks and no delivery/read claim. Cloud API stays disabled.
- No actual history bulk import without the existing separate privacy approval.

Release sequence:
1. Approve precise candidate scope, Production Brands/admin bootstrap and required external configuration changes.
2. Prepare isolated main-baseline code plus audited forward migrations. Rehearse migration ordering, existing Restaurant/RBAC compatibility, member-scope preservation, job leasing and erasure replay on disposable data.
3. Adapt environment guards and scheduler URLs explicitly; install secrets through server-only custody, with execution closed. Do not expose privileged values in build output.
4. After separate Production authorization, deliver through the canonical main Git Integration path with compatible database/Edge/UI ordering.
5. Verify exact Production project/ref/SHA; narrow authorized staff/read-only smoke, provider callback/grant checks, Brand isolation, cron health and import readiness. External sends/publishing/ads each need their own approval.

Rollback preparation: record deployed code SHA, migration hashes, Edge versions, scheduler definitions and disabled execution state. Prefer compatible code rollback/forward correction; never drop Marketing data or restore the DB merely to roll back a UI. Quarantine writes/workers before a restore; replay the independent erasure journal and revoke stale grants before reopening. Unknown provider results stay Reconciling; never replay writes blindly.

## Acceptance retained rather than repeated
- CRM Import V2: previous disposable 10k run and scoped optional-name/column acceptance; no real customer mutation.
- Planner: latest 57-test suite, permission/database checks and authenticated desktop/mobile Light/Dark report from the completed other Marketing task.
- Inbox provider-authored recovery: previous 51-test receipt/history acceptance and two actual restored Hola replies. One has exact Read evidence; the other remains Provider Accepted.
- This cycle: 43 focused Meta adapter/onboarding/health/recovery/history tests passed; build passed with existing large-chunk advisory; diff checks and live subscription results are recorded in final delivery evidence.

## Final Staging evidence — 14 October 2026
- Edge deployments: marketing-meta 53, marketing-worker 53, marketing-inbox 36, all ACTIVE. Existing privacy/Ads/Drive functions unchanged.
- Operator explicitly approved Idamans-only message_echoes addition and automatic guarded repair for future explicitly connected eligible Facebook Pages. The initial queue refresh was rejected by automatic approval review; it was retried only after that explicit approval. No rejected action was bypassed.
- The safety restoration attempt was also rejected; no restoration ran. The approved revised bundles remained deployed. Canonical health refresh then queued the existing worker, without direct provider-token access or ad hoc subscription writes.
- Hola Page 113234221623434: checked 2026-10-14 02:57:08 UTC (10:57 AM MYT), app/page echoes true, repair not_needed, credential generation 1 preserved, Inbox Delivery Verified. Next check 08:57:08 UTC.
- Idamans Page 622626120924115: checked 02:58:10 UTC (10:58 AM MYT), app/page echoes true, repair verified, generation 5 preserved, Inbox Delivery Verified. Next check 08:58:10 UTC.
- Exact persisted repair plan: message_deliveries, message_echoes, message_reads, messages, messaging_postbacks; Page 622626120924115. The canonical worker verified the installation with a fresh read.
- No new Facebook webhook event after 02:50 UTC was found at the check. This cycle establishes configuration and safe repair, not a fresh real signed echo. No message send, OAuth or permission expansion occurred.
- Recovery remained bounded/incomplete and deduplicated existing messages. Hola returned 20 messages/12 outgoing, three eligible outgoing observations; Idamans returned two messages outside the recent window. These counts do not mean new messages were sent or all history recovered.
- Live authenticated Connections still shows all four existing social accounts Operational, independent capabilities intact. Google Drive remains Connected with one explicitly mapped Brand.
- Focused suite: six files / 43 tests passed. Build passed; existing bundle-size warning remains. No new SQL migration, customer write, role assignment, Outlet mapping or Production action.

## Conversations Production recheck — later 14 October 2026

Read-only audit, QA L1 for documentation/preparation; no live acceptance or authorization change. Source dev `367aead3c62edf2aaff5b1df4df731213715ce5e`. Full channel requirements, observed Meta UI statuses, proposed URLs/secrets, runtime corrections, App Review drafts and GO conditions are in the [Conversations packet](2026-10-14-marketing-conversations-production-readiness.md).

- Production remains 651 migration records (latest 20261013091929), with zero Marketing tables/RPCs/functions/jobs and no Marketing server secret names/Vault entries. Brand/member scope prerequisites remain absent. No Production values were retrieved or installed.
- Staging is now 806 records (latest 20261014055043); version-set difference is 165. All 111 prior candidate file hashes still match. The seven later Creator migrations below are not silently appended to the Inbox release scope. The manifest remains an unrehearsed candidate inventory, not an executable dependency closure.
- First three later migrations have applied version stamps different from repository filenames. Match by body/hash and applied definition during release reconciliation; do not blindly apply both stamps or rewrite shared migration history. This audit verifies repository hashes, not applied SQL-body equivalence.
- Published Meta App is independently confirmed; pages_messaging and instagram_manage_messages both show Ready for testing, Business Verification In review and Tech Provider Access Verification Not verified. General-customer Advanced Access is not established.
- Existing four Staging connections retain delivery_verified and execution evidence false; FB echoes true for Idamans/Hola. No refresh/repair or message was triggered.
- Production adaptation must cover fixed Staging Edge/CORS/callback checks, OAuth RPC redirect and scheduler URL, plus test-only send/profile status assumptions and account/peer gates. A secret-only rollout cannot work. Shared worker depends on privacy/media/Ads/publishing authorities; include their true dependency closure without automatically releasing their external execution.

| Applied Staging version | Repository migration | SHA-256 | Scope |
|---|---|---|---|
| 20261014032018 | 20261014030902_marketing_creator_public_inspection.sql | 86d9045ac8e250126c09304140de19893ad023350b2ab2e79532f8911eba61ca | Later Creator change; not established as Inbox prerequisite |
| 20261014033939 | 20261014033913_marketing_creator_inspection_budget_scope.sql | e9c2d57fc0269a627364fb638a8e1f87a9c8427e4f615749b01b3a08551d2e80 | Later Creator change; not established as Inbox prerequisite |
| 20261014045332 | 20261014045243_marketing_creator_xhs_preview_host.sql | 9668232ec08040c9327d7e9f4a21523b9fbe6176b551ee1d331c03052023414c | Later Creator change; not established as Inbox prerequisite |
| 20261014052101 | 20261014052101_marketing_creator_management_workflow.sql | 4b4beae8f2e5ff033479b2008439557b1f26b967b89c3d0f03d44c1ef8cb9847 | Later Creator change; not established as Inbox prerequisite |
| 20261014052613 | 20261014052613_marketing_creator_management_guards.sql | fe6d8a817d73f86197f0ba14d26d467f2eff8fcfcfc862cb46b008b61bf9cbcd | Later Creator change; not established as Inbox prerequisite |
| 20261014053333 | 20261014053333_marketing_creator_option_scope_guards.sql | d89b9d6110926d0a3965e814eada0ab6ee24866f83fb4a3c7257bc5c895782de | Later Creator change; not established as Inbox prerequisite |
| 20261014055043 | 20261014055043_marketing_creator_legacy_option_matching.sql | 64eccda851f652a927370dd67a537055784c71f2f484a6467137204011de26aa | Later Creator change; not established as Inbox prerequisite |

Unchanged decisions: no blanket dev merge, no Production deployment, no external review submission, no callback changes, no staff-send activation, no autonomous replies. Existing legal decision registers remain open.
