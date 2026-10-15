# Phase 7 — security release outcome and controlled Marketing preparation

15 October 2026, Asia/Kuala_Lumpur. Security release **PASS / deployed**. Marketing release **NO-GO for deployment pending its separate authorization and configuration**. No Marketing database/application/function deployment, provider mutation, real asset connection or external execution occurred.

## Security release completed

The user explicitly approved the exact four-file release after reviewing the verified baseline and approval packet. Previous Production main/READY deployment was `7e9c6a187f00314d5920d2b85cd1df0a7bb23930`. Released Production/main is now **`a089e59034368d73c558d6fc2db16562032b1a37`**, Vercel `fnb-system` / `prj_1UOKHvE6Ft4a2WXrZyZGc9LZRWLP`, READY deployment **`dpl_BEW3du4T9N1ZZs78Fah1NRFAVP8Q`**, confirmed serving `os.feedx.my` through Git Integration.

Exact scope: `20261014073014_platform_role_authority_hardening.sql`, `20261014075736_people_migration_report_access.sql`, `src/auth/authService.js`, `src/services/employeeService.js`. No Marketing or unrelated application files were included. SQL SHA-256 values are respectively `f03f41e89eef8b238060b2387a36301abcd830d87759966c0462f406e328c9ef` and `2a9f99b5f3868d12a0df6cc139386061303b1f1f7ebdbdc999896eb0697e3180`.

Supabase Production `oyfobxdoyfuzsodogpgs` is ACTIVE_HEALTHY on PostgreSQL 17.6. The migration CLI first refused an incomplete isolated local history without applying either migration. Already-applied history was fetched locally; preflight then confirmed all 657 existing versions and exactly the two approved pending files. Both ran in order under their original version identifiers; the ledger is now **659**, with zero Marketing versions. No remote migration history was repaired or reset.

Verified live: both identity guard triggers installed; report RLS enabled; anonymous report SELECT and permission-helper EXECUTE denied; linked employee count remains 12, duplicate Auth links remain zero, retained report rows remain zero. A focused transaction exercised real linked-administrator permission/employee reads, denied self login-access and self role changes, and denied anonymous helper/report/profile reads. The transaction was rolled back; it grants no role or access. This is trusted SQL-role/RLS smoke, not a fresh lower-privilege user login. The existing authenticated Production owner browser reloaded the released application successfully and retained its read-only role view without an inactive-profile error. No UI role/employee Save was performed.

The seven preflight helper hashes matched the completed isolated security rehearsal, so its broader protected-role/disabled-employee scenarios and earlier 16 focused compatibility tests were reused. Canonical dev already contains byte-equivalent copies of all four released files; no redundant Staging push/deployment was needed.

Recovery point verified: completed physical backup `1964175970`, 2026-10-14 16:54:02 UTC / 15 October 00:54 MYT. PITR is disabled. No backup restore was performed or authorized. Prefer forward repair preserving the security restrictions; any database restore needs a separate decision and data-loss assessment.

## Marketing RC reconciliation and XHS exclusion

Input Marketing RC: `977fc446d282845fffdeb631f25bcb9e5644e388`. The isolated successor is on `codex/marketing-phase7-release-preparation` in `/private/tmp/feedx-marketing-production-rc`; its exact final SHA is recorded in the delivery artifact. It incorporates the released security RC as an ancestor, preserving those two client files exactly. No main merge or push of this Marketing branch occurred.

Confirmed scope defect corrected: the input RC excluded the Reader backend but still exposed a dead XHS QR drawer/button. Removed the drawer, entry point, pilot-only UI test and unused Reader environment-template flag. Reader API/worker/session modules are absent; the built asset bundle contains no XHS Reader Pilot. No session credentials, tunnels or Reader infrastructure are included. The local/Staging implementation remains preserved outside this candidate. Existing XHS canonical Post IDs, exact original URLs, shared Post navigation and manual/unavailable evidence remain intact; public inspection still sets `allowPaid:false`.

One test-only compatibility correction adds the missing `.is()` query mock and checks `auth_user_id IS NULL` in the normalized-email fallback. It does not change the approved security application code or broaden its release.

All **133** manifest SQL hashes still match (126 Marketing + 7 Platform dependencies). The separate `20261014184308_marketing_production_runtime_overlay.sql` remains byte-identical to rehearsal, SHA-256 `ef5892e8b6c6c622dd3743e2565108602917a99db91aabb5cdf9575042b25a18`. Security versions are not part of that manifest and must not be reapplied. Expected ledger after a separately approved unchanged Marketing sequence: 659 + 133 + 1 overlay = **793**, subject to a fresh no-drift preflight. Never blanket-push every pending file from the candidate checkout.

## Only remaining configuration and authorization gaps

Read-only inventories confirm no Production `MARKETING_*` Supabase secret names or Vercel environment names, no six Marketing Edge Functions and no three Marketing schedules. Production organizations/Brands have not been installed; four existing canonical Outlets are present. Existing Google Business credentials/function belong to Crew Reviews and are preserved, not evidence of Drive configuration.

| Area | Prepared contract | Still required |
| --- | --- | --- |
| Meta identity/OAuth | App `2182829996001809`, Login Configuration `2027095767950085`; exact callback `https://oyfobxdoyfuzsodogpgs.supabase.co/functions/v1/marketing-meta/callback` | Install app secret and independent token-encryption key server-side; deploy callback under separately approved Marketing runtime scope. Preserve Staging App `2204918033458414`. |
| Meta eligibility | Phase 6 last verified unpublished app; seven discovery/reporting scopes: ads_read, business_management, pages_read_engagement, pages_show_list, read_insights, instagram_basic, instagram_manage_insights | Business Verification/App Review/Advanced Access evidence for intended users remains unresolved; no fresh provider test/submission/publication was performed. |
| Inbox/webhook | Prepared signed `/marketing-inbox/webhook`, verify token and automatic eligible subscription/health setup | Deploy then separately authorize callback registration. Messaging config needs pages_messaging, pages_manage_metadata and instagram_manage_messages in actual eligible grants; Instagram messaging installation/config expansion/review remains separately gated. No assets or subscriptions changed. |
| Privacy | Independent journal namespace/private store, journal encryption key and Blob token; token keys and erasure/revocation replay contract | Approve secure key/private-store provisioning and restore/operator custody. Do not reuse Staging keys or sealed credentials. |
| Drive | Independent marketing-drive callback, PKCE/state, drive.readonly and canonical Brand-folder mapping | Approved Production OAuth client/secret/encryption key, consent/verification eligibility, owner and exact folder mapping. Existing Crew OAuth does not supply this authorization. No Google setting or scope changed. |
| Worker/CRM | Existing bounded DB import queue; worker secret/Vault routing; inactive runtime overlay | Provision matching independent server/Vault credentials. Approve later scheduler activation; CRM needs no parallel importer. No real customer import is authorized. |
| Bootstrap | Canonical organization/Brand/Outlet/member authorities | Approve exact Production organization/Brand names, eligible mappings for the four existing Outlets, initial administrators and per-member Brand Access. No Stage fixtures or blanket role grants. |

The maintained environment template lists required names only. No credentials were generated, installed or exposed. Publishing, staff messaging, AI automatic replies and Ads execution remain hard closed by Production code as well as disabled flags. Do not install test asset/peer allowlists or execution approvals.

## Exact ordered Marketing deployment plan — not executed

1. Reconfirm Production SHA `a089e590...`, 659-version history, recovery custody and all 133 checksums/overlay. Obtain separate approval for the exact successor Marketing SHA and explicit migration/runtime/frontend scope.
2. Apply only the ordered 133 files in `2026-10-14-marketing-execution-order.csv`, then `20261014184308_marketing_production_runtime_overlay.sql`. Set its required `feedx.release_target=oyfobxdoyfuzsodogpgs` marker in the executing connection. Verify ledger/catalog and all three jobs inactive. Stop on drift/failure; resume only verified committed versions.
3. Under approved credential/storage custody, install server-only runtime/private journal/Vault material. Deploy `marketing-meta`, `marketing-worker`, `marketing-inbox`, `marketing-privacy`, `marketing-ads`, `marketing-drive` and required shared dependencies plus Creator public-inspection API. Preserve `google-business` and existing functions/schedules. Do not register provider callbacks or connect assets yet.
4. Execute the approved organization/Brand/Outlet/admin/member bootstrap through canonical authorities. Release only the scoped Marketing application through main's existing Git Integration after its separate merge/deployment approval. Verify exact Production project/ref/SHA and narrow approved internal workflows.
5. Only after credential/authority checks, separately activate intended internal CRM/housekeeping workers. Prepared schedules: meta worker each minute, housekeeping each ten minutes, customer import each ten seconds. External reporting/health activity needs separately authorized connections and grants. Avoid duplicate Vercel schedulers.
6. Separately authorize any Meta permissions/review/publication/callbacks/assets and Google OAuth/folders. Keep real historical message/customer imports privacy-gated. Genuine signed inbound events are required for Delivery Verified; configuration alone is insufficient. Publishing, sends, automatic replies and Ads execution remain disabled.

Rollback/forward recovery: pause only new Marketing jobs/writes and restore compatible frontend/Edge artifacts; retain security restrictions, data and independent privacy journals. Prefer targeted forward fixes. No destructive schema unwind, blind provider retry or database restore without its own approval and journal replay/generation reconciliation.

## Verification and decision

Completed: approved Production security deployment and focused live authorization checks; authenticated owner UI reload; 36 focused Creator/XHS tests before reconciliation; 17 targeted Auth/Employee/Creator tests after reconciliation; Production-profile placeholder-key build after security merge; all 133 hashes and overlay; Reader/QR absence in built output; clean diff checks. A stale mock failed once and was corrected; the current targeted run passes. Existing large-chunk build warnings remain. Placeholder build credentials test compilation, not live provider configuration.

Reused: 133-migration isolated rehearsal/data-preservation/RLS evidence, Phase 6 runtime checks and 14-finding dependency disposition (zero confirmed release blockers under its documented boundaries). No broad audit, repeat migration rehearsal, unrelated module QA or external provider execution was performed.

**Security: GO / completed. Marketing: compatible isolated candidate, NO-GO to deploy now.** Exact next release authorization must name the final successor SHA, 133 migrations plus overlay, six functions/Creator API/scoped frontend and controlled internal smoke, with XHS/real provider connections/external execution excluded. Before that can be fully actionable, approve secure independent credential/private-journal custody and the exact Production bootstrap mapping; those missing facts must not be guessed.

Documentation Impact: Updated this release plan, Marketing Production exclusion contract and environment template. No additional Production documentation-only release is bundled.
