# Marketing Production runtime and release candidate

15 October 2026, Asia/Kuala_Lumpur. Isolated local preparation; no remote push, deployment, main merge, live migration, secret installation, provider configuration or external execution.

**GO for review of the isolated candidate; NO-GO for Production rollout.** The scoped application builds against Production main and the runtime is environment-specific and execution closed. The exact 133-migration rehearsal is retained. Separate security delivery, dependency security review, Production configuration/bootstrap and external access approval remain gates.

## Source and isolation

Production baseline: `5224eeade2e7438c7810c2aa8524422443e9e1ab`, verified READY at `os.feedx.my` on `fnb-system`, deployment `dpl_GBpXCwHdWMLECajwb5n3PSPAq1Ws`. Canonical Staging: `b416d9075af3a332c5c4d240ba42c9289977b955`, verified READY on `fnb-system-staging`, deployment `dpl_ACwqZa7ZoLjvSLAuCvDut5c8VEc4`. The two commits after the rehearsed Staging source `63eb493b3` affect Google Business only; Marketing implementation and its migration set are unchanged.

Candidate directory: `/private/tmp/feedx-marketing-production-rc`, branch `codex/marketing-production-runtime-rc`, descended directly from Production main. Candidate SHA is recorded in the accompanying final report and Git commit, avoiding a self-referential document hash.

Included: canonical Marketing/Brands UI and services; required shared form/table/media/calendar controls; scoped Admin route/access, module registry, shell Inbox count and Outlet Brand presentation; Creator free public-inspection API; six Marketing Edge Functions and their shared dependencies; CSV/XLSX templates and parsing; 133 exact ordered migration files, with canonical applied-version filenames; one forward environment overlay; targeted tests and deployment documentation. Existing Production routes and unrelated business services remain on main. Only Creator extraction dependencies were added to the existing package manifest; existing toolchain ranges were preserved.

Excluded: Finance prototype, Guest AI, Recruitment, Google Business/Crew development, unrelated pending migrations, XHS session Reader backend and blanket dev-to-main changes. The security hotfix is retained as a separate prerequisite patch, not applied to this candidate.

## Runtime changes and closed execution

`supabase/functions/_shared/marketingEnvironment.mjs` fixes known Staging/Production project, Admin origin, OAuth/Drive/webhook callbacks, Meta App and Login Configuration IDs, Vercel project and branch. Unknown Supabase URLs, explicit environment-label mismatches and cross-environment Meta IDs fail closed. No arbitrary origin or project is accepted. Production CORS removes localhost; exact HTTPS OAuth redirect and server-derived return URLs remain intact.

Production Meta App: **2182829996001809**, Login Configuration: **2027095767950085**. Staging retains App **2204918033458414**, Configuration **1398015649111006**, and all existing callbacks. Production configuration advertises only the seven installed discovery/reporting scopes. Actual OAuth tokens and granular provider grants remain authoritative, never inferred from these configured identifiers.

The existing one-time OAuth state hash/consume RPC, Auth user validation, app/user token checks, token expiry/generation checks, scoped account bindings, signature verification, durable queues, deduplication and retry controls remain unchanged. Privacy journal prefix, evidence project validation and AES-GCM associated data now bind to the selected project rather than Staging. Production cannot consume Staging erasure evidence under its own namespace.

Production publishing jobs are not claimed, even with copied test-account flags. Staff sends, Ads execution and AI provider requests are hard closed in this candidate. No autonomous reply executor is introduced. These code closures require a reviewed future change for activation; setting an environment flag alone is insufficient. Internal review/approval, draft and reporting workflows remain present. The Meta App remains unpublished; no Meta assets, callbacks or provider state were mutated during this task.

Google Drive uses an independent client/key set, the Production callback and existing `drive.readonly` scope, PKCE/state consumption, identity and generation validation, Brand-root mapping and temporary publishing-cache lifecycle. No Google OAuth/folder change or duplicate media store was created.

## Database and scheduler scope

The 133 feature/dependency migrations match the reconciled manifest hashes exactly. The new local forward file `20261014184308_marketing_production_runtime_overlay.sql` is byte-identical to the rehearsed overlay. It changes seven environment-bound functions to Production and keeps `feedx_marketing_meta_worker`, `feedx_marketing_meta_housekeeping` and `feedx_customer_import_worker` inactive using `cron.alter_job`. It requires the explicit `feedx.release_target=oyfobxdoyfuzsodogpgs` preflight marker. Do not use blanket migration push or replay Production-only migrations from this checkout.

CRM background batches remain database-owned, resumable and idempotent; no parallel Edge importer was added. Activate only the internal CRM schedule after approved authority/bootstrap and queue checks. Meta worker/housekeeping schedules require independently installed server/Vault scheduler credentials and compatible Edge services. No duplicate Vercel Cron is introduced.

Fresh read-only Production preflight now shows **657 migrations**, versus 651 at rehearsal, and **zero public Marketing tables**. The six additions are Google Business versions `20261014094703`, `20261014103818`, `20261014130653`, `20261014132350`, `20261014135852`, `20261014181028`; all are excluded. Current catalog contains 993 application/inventory functions: all previous 988 definitions, security attributes and grants are unchanged, with five added Google functions. Structural comparison shows no removed/changed tables, columns, constraints, indexes, policies, triggers or grants; one column was added. This supports reuse of the isolated rehearsal; the candidate was not replayed against real Production or its business records.

Separate prerequisite remains `20261014073014_platform_role_authority_hardening` plus `20261014075736_people_migration_report_access` and the two client Auth/employee identity compatibility changes in `runtime/production-security-hotfix-prerequisite.patch`. These migrations are absent from the fresh Production ledger. Do not silently include or bypass this protection.

## Verification

- Reproducible candidate dependency install and Production-target Vite build passed. Production-target build uses only a synthetic build key, no real credential. Existing large-chunk warnings remain.
- Six Edge Functions pass complete esbuild dependency/bundle checks; no dangling relative imports. This is syntax/import verification, not managed Deno deployment or live runtime smoke.
- Five environment tests pass: both routing profiles, exact app/login bindings and rejection of unknown/mismatched projects.
- Focused worker tests pass, including Production refusing publishing claims despite copied test flags and rejecting Staging app credentials before database work.
- Broad focused Marketing run: 78 suites passed; one outreach timing assertion failed under concurrency. All 18 outreach tests passed serially; the subsequent five-suite security/worker/Inbox/Creator/outreach run passed 46 tests. Final sensitive suites and build evidence are retained with the handoff. No user-facing defect was proven by the concurrent-only timeout.
- Reused all 133 migration hashes, byte-identical overlay, isolated preservation/RLS/RPC suites and existing Staging L2/L3 evidence. No unrelated module QA or provider test was repeated.
- `npm audit` reports 14 dependency findings (8 high, 3 moderate, 3 low). They require triage before release. High findings include existing toolchain packages and jsdom's Undici 8.10.0; Creator's Cheerio resolves Undici 7.30.0, outside the reported 8.x advisory ranges. No broad dependency upgrade was silently included. Audit findings are not represented as confirmed exploitable Production business-path vulnerabilities.

## Configuration and release sequence

See `runtime/marketing-production.env.example` for names, public identifiers and disabled flags; it contains no real secrets. Supabase supplies base server keys. Install independent Meta App Secret, 32-byte token-encryption key, webhook verification token, worker/Vault secret, erasure journal credentials/custody and Google client/encryption credentials only after explicit approval. Optional previous keys belong solely to the same environment. Never copy sealed Staging tokens, peers, asset allowlists, Ads approvals or server secrets into Vite.

Production callbacks under `https://oyfobxdoyfuzsodogpgs.supabase.co/functions/v1`:

- `marketing-meta/callback`, `marketing-meta/deauthorize`, `marketing-meta/data-deletion`
- `marketing-inbox/webhook`
- `marketing-drive/callback`

Frontend return origin: `https://os.feedx.my`. Meta's exact OAuth callback is already registered. Other callbacks are preparation only, until endpoints are deployed and registration is separately approved. The new App remains unpublished and its configuration alone proves neither Advanced Access nor live data delivery.

Release order: approve/deliver separate security prerequisite; resolve dependency findings; recheck current baseline and manifests/backup custody; authorize exact 133 migrations plus forward overlay with jobs inactive; install independent private storage/secret/privacy custody and Production-bound functions/API; bootstrap canonical Brands/Outlets/admin/member scopes; deploy scoped frontend through the existing Production Git Integration only after explicit main/deployment approval; perform narrow authorized Production smoke; activate only approved internal workers. Provider connections and external execution remain separate gates.

## Remaining approvals and GO or NO GO

1. Separate security-hotfix release and dependency security resolution/acceptance.
2. Explicit Production migration, runtime/API/frontend release and main-merge authorization for the reviewed candidate/manifest; no authorization is implied by this preparation.
3. Brand/Outlet mappings, initial administrators, member Brand access and independent secret, scheduler, erasure-journal/backup custody decisions.
4. Meta Business Verification (last inspected In review), applicable Tech Provider/access verification and separate new-app App Review/Advanced Access. The seven reporting scopes are installed/configured but general-customer access is unverified. Messaging/publishing scopes are outside the login configuration; adding them requires separate approval.
5. Google OAuth/client/restricted-scope readiness, authorized Drive owner and canonical Brand folder mappings. No live Google connection is claimed.
6. Separate callback registration, app publication, real asset connection and privacy authority for historical customer-message import. Publishing, staff messages, automatic replies, paid AI and Ads execution each require explicit later activation authorization.

**Production release: NO-GO.** Candidate review/build and environment preparation are complete; installation and runtime/provider acceptance remain gated. Managed Deno runtime, real OAuth, webhook delivery, Production grants and final smoke remain unverified because no deployment or provider mutation was authorized.

Rollback/forward recovery: keep compatible main/Edge artifacts, pause only new Marketing schedules and writes, preserve the separate security protection and existing module authorities, and prefer narrow forward fixes. Do not DROP imported metrics/customers, undo audit evidence or blindly repeat unknown provider outcomes. A database restore remains quarantined until independent erasure/revocation evidence, credential generations and operator custody are reconciled.

Documentation Impact: Updated `docs/domains/marketing.md`, documentation router and this release report.
