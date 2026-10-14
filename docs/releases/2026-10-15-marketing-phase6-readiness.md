# Marketing Phase 6 — Production security and configuration readiness

15 October 2026, Asia/Kuala_Lumpur. **GO for isolated release preparation; NO-GO for Production rollout.** This report supplements the completed migration rehearsal, runtime report and dependency ledger. No live deployment, main-branch merge, migration, secret installation, provider mutation, connection or external execution was performed.

## Baseline and scoped changes

Input RC: `606d1efbaeacbbd0c12647c75db11f0a2cf1d9ed`. Current Production is READY at `os.feedx.my`, SHA `7e9c6a187f00314d5920d2b85cd1df0a7bb23930`, deployment `dpl_DMao69JNVByNVBXrNuwn1sQcKSaT`. Its intervening Google Reviews release is incorporated into the isolated candidate to preserve already deployed behavior; it is not a new Marketing deployment scope. Main itself remains untouched.

Two confirmed preparation defects were corrected: the assembled candidate omitted the canonical Google Reviews OAuth route override, restored in `src/app/routeOwnership.js`; the environment template omitted the independent erasure-journal encryption key and optional previous-key names, now listed. Shared Google crypto compatibility is preserved. There are no changes to the 133 rehearsed migration files or environment overlay: all 133 SHA-256 comparisons pass; overlay hash is `ef5892e8b6c6c622dd3743e2565108602917a99db91aabb5cdf9575042b25a18`.

The dependency ledger remains applicable: 14 findings, three already mitigated, eleven safely deferrable under its documented input/execution boundaries, zero confirmed dependency release blockers. No broad audit or dependency upgrade was repeated.

## Independent security release

Security-only candidate: `a089e59034368d73c558d6fc2db16562032b1a37`, based on current Production. Exact scope is four files:

1. `supabase/migrations/20261014073014_platform_role_authority_hardening.sql`
2. `supabase/migrations/20261014075736_people_migration_report_access.sql`
3. `src/auth/authService.js`
4. `src/services/employeeService.js`

The saved patch applies cleanly. Both migrations are still absent from Production's 657-entry ledger. All seven live permission/identity helper definition hashes match the rehearsed preflight. The identity guard is absent; the retained People migration-report table still has RLS disabled and seven anon grants. Consequently this protection remains necessary, not an already delivered mitigation.

The first migration makes canonical employee identity authoritative, hardens protected-role/access helpers and guards identity/role changes. The second enables scoped report RLS and removes anonymous report access. Auth fallback only matches an unlinked employee; login cannot claim an already linked identity. Employee saving preserves existing Auth linkage. No new persisted role grant or Marketing authority is bundled into this release.

Compatibility: 16 focused Auth/Employee tests pass on the patched current-main checkout. The completed isolated security scenario and five Marketing RLS/RPC suites are reused because their seven dependency definitions are unchanged. This is not a fresh live security smoke or a claim about untested production-volume data. The security patch is not applied to the Marketing candidate.

**Next authorization:** separately authorize these two security migrations in order and the two client compatibility files against current main, including backup/recovery custody and a narrow authenticated/disabled-employee/role/report-access smoke. Marketing release, provider setup and external execution are excluded. Keep the SQL and client compatibility changes coordinated; prefer forward repair over reverting the security restrictions.

## Configuration checklist — prepared versus installed

Inspection used secret names/digests and environment metadata only, never values. Presence does not prove a secret is correct. Production has no `MARKETING_*` Supabase secrets, no Marketing server environment names in Vercel metadata, no six Marketing Edge Functions and no Marketing cron jobs. Existing Vercel publishable frontend configuration is present; its values were not read. Existing Google Business credentials/function serve Crew Google Reviews and do not prove Marketing Drive readiness.

| Requirement | Prepared contract | Production readiness / approval gate |
|---|---|---|
| Environment | Exact Production project `oyfobxdoyfuzsodogpgs`, `https://os.feedx.my`; optional `MARKETING_ENVIRONMENT=production`; reject unknown/cross-environment IDs | Code verified; installation approval pending |
| Managed keys | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` supplied server-side | Managed platform keys; never expose service role through Vite |
| Meta identity | `MARKETING_META_APP_ID=2182829996001809`, `MARKETING_META_LOGIN_CONFIG_ID=2027095767950085`, Graph `v26.0` | Provider identifiers/configuration confirmed; server installation pending |
| Meta secrets | `MARKETING_META_APP_SECRET`, independent 32-byte token key `MARKETING_META_TOKEN_ENCRYPTION_KEY`, optional previous token key | Missing Marketing secret names; approve secure provisioning, no Stage copy |
| Webhook | `MARKETING_INBOX_WEBHOOK_VERIFY_TOKEN`; exact signed callback below | Endpoint not deployed/registered; approve endpoint then provider registration separately |
| Scheduler | `MARKETING_WORKER_SECRET` and matching database Vault routing credential | Missing; independent custody and coordinated installation required |
| Privacy custody | `MARKETING_ERASURE_JOURNAL_ENCRYPTION_KEY`, optional previous key; `MARKETING_ERASURE_JOURNAL_READ_WRITE_TOKEN` for independent private Blob store | Missing; approve private store, encryption and restore/replay custody |
| Drive | `MARKETING_GOOGLE_DRIVE_CLIENT_ID`, `_CLIENT_SECRET`, `_TOKEN_ENCRYPTION_KEY`, optional `_PREVIOUS_TOKEN_ENCRYPTION_KEY` | Missing; independent OAuth client/consent readiness unverified |
| Internal identity | Canonical organizations/Brands, eligible existing Outlets and per-member Brand Access | `public.organizations` and `public.brands` absent; four existing Outlets counted, no records copied. Bootstrap assignments require explicit approved mapping |
| CRM import | Canonical database queue, resumable batches and consent/suppression guards | Migrations/permissions/bootstrap needed; no parallel Edge importer or real-customer import performed |

Source of required names: `runtime/marketing-production.env.example`, `_shared/marketingEnvironment.mjs`, `_shared/metaSecurity.ts`, `_shared/privacyJournal.ts` and the existing runtime/rehearsal reports. Optional previous keys are for same-environment rotation only. Never reuse Staging sealed tokens, test peers, asset allowlists or execution approvals.

Privacy journals use project-bound namespaces and AES-GCM associated data outside the restorable database. A restore must remain quarantined until erasure/revocation replay, generations and key custody are reconciled. A Blob token alone is insufficient without its independent encryption key.

## Meta self-service and permission gates

Production App `2182829996001809` remains **Unpublished**. Business Portfolio Isaac - The Y verification remains **In review**. App Review/Advanced Access for general customer use is not verified. Installed permissions marked ready for testing are not evidence of Advanced Access.

The approved General login configuration has exactly seven reporting/discovery scopes: `ads_read`, `business_management`, `pages_read_engagement`, `pages_show_list`, `read_insights`, `instagram_basic`, `instagram_manage_insights`. The exact registered redirect is:

`https://oyfobxdoyfuzsodogpgs.supabase.co/functions/v1/marketing-meta/callback`

Inbox needs `pages_messaging`, `pages_manage_metadata`, `instagram_manage_messages` in actual OAuth grants and applicable Advanced Access. The first two are installed in the app but excluded from the login configuration; Instagram messaging is not installed/selected. Approval is required to add that permission and extend the configuration with these three scopes, then submit the applicable review. Review evidence must cover a deployed privacy/deletion flow, permission-specific screencasts, reviewer access/test accounts and verification/Tech Provider requirements applicable in Meta's dashboard. No submission or guarantee of approval is claimed.

Code supports Connect → Select Accounts → Confirm → automatic setup and sync after the one-time platform setup. Bind selection validates actual grants/Page tasks/Instagram linkage, organization/Brand ownership, OAuth state and credential generation. Account confirmation queues social synchronization/health and Ads initial 30-day reporting. Accounts with insufficient authority report actionable failure; console changes are not required per Brand once app-level eligibility is approved.

Eligible subscriptions are reconciled for this App, preserving existing fields and other app installations. Facebook app/Page fields include `messages`, `messaging_postbacks`, `message_deliveries`, `message_reads`, **`message_echoes`**. Instagram app fields are `messages`, `messaging_postbacks`, `messaging_seen`; its linked-Page installation uses `messages`, `messaging_postbacks`, `message_reads`. Do not register an unsupported Instagram object `message_echoes` field; Instagram echo envelopes arrive through messages.

Connection health is leased and bounded: three-minute lease, successful check due after six hours, failure backoff of one, two, four and eight minutes, with the fifth failure resetting attempts and deferring for six hours; explicit follow-up is no sooner than one minute. Durable intent prevents blindly repeating an unknown subscription outcome. Existing durable ingestion, deduplication, generation checks, retry/recovery and Brand-scoped reads are preserved.

UI distinguishes OAuth Connected, Configuration Verified, Awaiting First Delivery, Delivery Verified and Needs Attention. Only genuine current-generation signed inbound evidence can verify delivery; an eligible subscription or historical import cannot. Bounded history recovery remains API/permission/privacy gated and never promises complete history.

The retained `test_authorized` database label describes the restricted connection mode used by the canonical onboarding RPC, not the runtime environment. Social reads, health and Ads reports accept it; changing it to `production_authorized` is unnecessary for these read workflows and would affect publishing claim authority. It is deliberately not escalated in this preparation. Production publishing claims, staff sends, AI calls/automatic replies and Ads execution are hard closed in code independently of copied flags.

## Endpoints, Google and deployment scope

Prepare under Production Supabase `/functions/v1`:

- `marketing-meta/callback` (registered OAuth), `marketing-meta/deauthorize`, `marketing-meta/data-deletion`
- `marketing-inbox/webhook` (not registered)
- `marketing-drive/callback` (not registered/verified)

Signature verification and environment allowlists remain enforced. Do not register webhook/deauthorization/deletion callbacks until authorized compatible endpoints are deployed. No real Meta asset has been connected in this task; Staging App `2204918033458414`, callbacks and assets were untouched.

Marketing Drive uses independent credentials, `drive.readonly`, PKCE/single-use state and Brand-root mapping. Existing Crew Google Business OAuth does not authorize it. Google Production consent/testing/verification state, authorized folder owner and Brand-folder IDs remain missing evidence, requiring read-only inspection or separately approved setup. No broader Google scope or duplicate media store is planned.

Required Edge Functions: `marketing-meta`, `marketing-worker`, `marketing-inbox`, `marketing-privacy`, `marketing-ads`, `marketing-drive`, plus their shared modules. Include the Creator server API with Production project/branch guards and scoped frontend; preserve deployed `google-business`. CRM background work remains database-owned.

Schedules: `feedx_marketing_meta_worker` every minute, `feedx_marketing_meta_housekeeping` every ten minutes, `feedx_customer_import_worker` every ten seconds. The unchanged forward overlay installs Production routing and leaves all three inactive. Confirm independent Vault/worker credential agreement before activation. Ads reporting refresh remains scheduled at six-hour eligibility; avoid a second Vercel scheduler.

## Minimal ordered release and acceptance

1. Authorize and deliver the independent four-file security release; verify its narrow identity/RLS compatibility.
2. Recheck Production SHA/catalog, backup/restore custody and manifest preconditions; approve the exact 133 migrations plus unchanged forward environment overlay. Keep jobs inactive and don't blanket-push pending migrations.
3. Approve independent keys/private journal/client credentials and install server/Vault configuration. Deploy six Edge Functions and Creator API with verified routing; no provider callback registration yet.
4. Approve canonical organization/Brand/Outlet mappings, initial administrators and member access. Deploy the scoped Marketing application through existing release controls; narrow internal smoke with synthetic data only unless customer-data approval is explicit.
5. Activate approved internal CRM/housekeeping and reporting/health workers only after authority, credentials and execution closures are checked. Provider-dependent jobs need an authorized connection; activation does not authorize outbound execution.
6. Separately approve Meta permissions/review/publication and callback registration, Google OAuth/folder mapping, then intended real asset connections. Verify each supported channel independently. A real signed inbound event is still required before claiming Delivery Verified. Historical customer-message import needs privacy approval. Publishing, staff messaging, AI replies and Ads execution remain disabled pending separate future reviewed activation.

Rollback: pause only new Marketing schedules/writes and restore compatible frontend/Edge artifacts; preserve security restrictions, imported records and erasure evidence. Prefer targeted forward fixes. Never blindly retry unknown provider operations or restore/reopen access without journal replay and generation reconciliation.

## Focused verification and decision

Passed: current-main patch application; seven security dependency hash comparisons; 16 Auth/Employee tests; canonical Google OAuth route compatibility test; current-Production-based candidate Vite build; Google function dependency bundle; 133 migration hashes and unchanged overlay. Existing migration/RLS/preservation suites, Staging L2/L3 evidence and dependency triage were reused. Logs are retained in the Phase 6 artifact package. Build retains existing large-chunk warnings.

Not claimed: live Production runtime smoke, managed Deno deployment, fresh OAuth, current Advanced Access, delivered webhooks, real imported messages, Google folder access or customer-wide self-service success. These require installations/approvals deliberately outside this task.

**NO-GO for Production Marketing rollout today.** Independent security preparation and configuration contracts are ready for approval, but the security hotfix, Marketing baseline/bootstrap, secret/privacy custody, runtime installation and provider access evidence remain outstanding. There is no newly proven migration or dependency blocker. The smallest next authorization is the separate security-only release above; Marketing/provider approval can follow after its acceptance.

Documentation Impact: Updated this release report and the runtime environment template; no business workflow or authority documentation change is required.
