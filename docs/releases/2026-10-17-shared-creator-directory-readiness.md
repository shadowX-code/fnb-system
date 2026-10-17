# Shared Creator Directory — completed Production release

Status: released to Production on 17 October 2026. QA level: completed Staging L3 Canonical plus focused authenticated Production acceptance. The pre-release baseline and approval scope below are historical evidence, not pending execution instructions.

## Completed Production receipt

- Production/main SHA: `cefc744c10b75da0683b75060253524bcdfe8b87`.
- Vercel deployment: `dpl_2y9LjzMqQfsbudMsk1YUZu4XoPoJ`, READY and serving `os.feedx.my`.
- Only the reviewed `20261016165619_creator_shared_directory.sql` migration was applied; ledger 811 -> 812. SHA-256: `9694fb7a1ca41d293eab2d8560a23e9876d04ccfbcb6079c06e095756357089f`.
- Functions: `marketing-meta` v23 and `marketing-worker` v24. Ten affected authority functions match the tested Staging definitions.
- Authenticated acceptance passed shared Directory Grid/List, optional Worked with Brand filtering, unsaved cross-Brand reuse, saved Koh Kah avatar/31 followers and Brand-scoped reads. At 390px there was no document overflow. No Collaboration or profile was saved during acceptance.
- Captured identity, evidence, relationship and connection hashes and scheduler states remained unchanged. Restricted-member and synthetic legacy-note scenarios reuse completed Staging L3 evidence; Production had no legacy profile notes, so those cases were not freshly reproduced there.
- Organization-level Meta enrichment remains gated; Brand credentials are not borrowed.

The original [Production receipt](2026-10-17-shared-creator-directory-production-receipt.json) is retained verbatim. This documentation reconciliation performs no migration, function delivery, application deployment or Production write.

## Ownership and migration

Creator Master and Social Profiles were already stored with organization_id. Brand ownership came from the Creator visibility/edit predicates and page context, not a Creator Brand column. The change removes that implicit ownership without recreating records.

- Shared Master/social identity: active tenant member + Marketing workspace/Creator View; shared edits additionally require Manage Creators.
- Private Collaboration costs, notes, lifecycle, Posts and Insights: existing canonical Brand Access and Role permissions. Shared profile editing grants none of these.
- One external Post identity remains unique per tenant/platform/Post key, with one explicit Brand/Collaboration attribution. Inaccessible duplicate records expose no record ID, caption or metrics.
- Proven identity constraints remain unchanged. Neither matching names nor Brand names trigger merging. Production read-only inventory found no duplicate social IDs or Posts requiring a merge.
- New shared_notes defaults empty; existing notes is retained verbatim as private legacy Brand-context evidence. It appears read-only only with access to every original Brand context (or original author/full-scope staff for an unlinked profile). Shared commands/replays cannot expose or overwrite the legacy value.
- Existing Creator IDs, Social Profile IDs, primary account resolution, revisions, public evidence and Brand relationships remain intact. No tenant, Brand, grant or provider connection is written.

## Verified Staging

- Canonical dev / READY Staging SHA: ea142f50d16b5ac6fa4bcd69c6f355589172e3e3.
- Vercel project fnb-system-staging / prj_t6uJtKPDu9GuyefG6IqAfxh5YoIi; Git deployment dpl_2s67g6LkrgYccgAbhXwaNNf9mPBF; canonical aliases assigned.
- Supabase ujkzdaaadnvcfayuldmh ledger 846→847. marketing-meta v63 / marketing-worker v72.
- Exact preservation hashes match before/after: all six Creator records, nine Social Profiles (identity/display/avatar/follower evidence/revision), Collaborations, Posts and metric snapshots. Archived fixtures remain archived; two active profiles appear normally.
- Rollback-only database suite: tenant isolation, shared-only/no-Brand member, restricted Brand A/B managers, read-only viewer, commercial/metric isolation, private legacy notes, old-receipt redaction, optimistic revision, retry identity, exact social/Post duplicates, anonymous/direct-table denial, stale follower completion and saved evidence preservation. Suite passes against the applied migration.
- Focused Staging React/service tests pass (103 tests across the affected tests, including the added Post deep-link case); build passes. Production-isolated candidate: 96 tests across its available focused tests; build passes. Existing bundle-size warnings remain.
- Authenticated desktop/mobile Light/Dark: shared Directory Grid/List, optional Worked with Brand, shared edit audience, real saved avatar loading, Detail's authorized Happiness/Hola history, Brand-scoped Collaboration/Post/Insights navigation. Actual mobile CSS width 390px: no document overflow. Original List/Light and viewport restored.
- Instagram Refresh Public Profile correctly reports workspace-level authorization required; no Save performed. Unit/DB contracts verify no provider/inspection-quota request and no Brand-token enrichment.
- Existing URL workflow/deep links, source timestamps, unavailable/zero metric semantics and canonical media references remain intact.

Evidence screenshots (local):
- /private/tmp/creator-shared-final-desktop-list.png
- /private/tmp/creator-shared-desktop-light.png
- /private/tmp/creator-shared-desktop-dark.png
- /private/tmp/creator-shared-mobile-dark.png
- /private/tmp/creator-shared-mobile-list-light.png
- /private/tmp/creator-shared-detail-mobile-dark.png
- /private/tmp/creator-shared-worked-filter.png

## Profile enrichment limitation

The actual marketing_connection_owner constraint permits Brand=null only for Ad Accounts. Current Facebook/Instagram OAuth credentials are Brand-owned. There is no approved tenant-level profile-enrichment connection or consent authority. Existing Brand connections therefore cannot be used for the new shared profile operation, regardless of their granted scopes.

This release intentionally stops Brand-token Creator profile/follower enrichment. Saved images/counts/source/capture times remain intact; expired images retain initials fallback. It does not label an API failure as a verified zero and does not use Instagram HTML scraping or paid providers. The current Meta adapter's bounded official follower reader is retained, but canonical claims cannot supply a Brand token and completion rejects stale Brand-based results.

Official professional-profile Business Discovery is the relevant provider API, not permission to pool existing Brand credentials. A dedicated tenant-level enrichment connection purpose, explicit OAuth/consent authority and its own eligibility checks would require a separate scoped implementation and approval. No current Meta settings, grants, OAuth or Page bindings need to change for the shared Directory release itself.

Provider reference: Meta's official Instagram API collection: https://www.postman.com/meta/instagram/folder/u4g5a2a/instagram-api-with-facebook-login . Its professional-account eligibility does not establish FeedX tenant-level authorization.

## Historical pre-release Production baseline and isolation

Read-only baseline verified:
- main/live 4f08f7253c089747244e870fbe61676b3aa93b63; READY deployment dpl_3HwR73WHCcV6JJF75cgZWRTBr6Vg.
- Migration ledger 811; marketing-meta v22 / marketing-worker v23.
- All eight replaced Creator function definitions exactly match the pre-change Staging baseline hashes.
- Every deployed dependency file in both Production function bundles matches the isolated candidate except the intentionally changed metaCreatorProfile.ts. Entry points, Ads packed-report finalization, execution gates, environment routing, Publishing, Inbox, privacy and other dependencies remain byte-identical.
- Candidate preserves Production Creator API environment validation and excludes the Staging-only XHS Reader UI/runtime.

## Historical approved release scope

This was the separately approved execution scope, subsequently completed as recorded above. It is retained for traceability and is not authorization to repeat any action.

1. Recheck current main/live, ledger, functions and migration checksum; stop on drift and reconcile before approval is reused.
2. Apply only 20261016165619_creator_shared_directory.sql, expected ledger 811→812.
   SHA-256: 9694fb7a1ca41d293eab2d8560a23e9876d04ccfbcb6079c06e095756357089f.
   Use one transaction with exact baseline-function, conflict-abort and identity/evidence-preservation checks; record one migration receipt. No merges/reparenting or grant changes.
3. Deploy only marketing-meta and marketing-worker from the reconciled Production candidate, retaining all other deployed dependency bytes and runtime settings.
4. Fast-forward main once to the approved isolated candidate for the existing fnb-system Vercel Git Integration. If required, separately authorize promotion of that exact READY deployment to existing domains only.
5. Focused authenticated read-only Production acceptance: shared Directory and Detail, authorized Brand history, Post identity/navigation, shared profile audience and enrichment-unavailable state; verify receipts/hashes. No Creator/profile edits, Meta calls, OAuth, new data imports or external execution during acceptance.

No migrations beyond this one, other Edge Functions, scheduler/secret/runtime flag changes, provider settings, asset/Brand rebinding, external Publishing/messages/Ads, or privacy activation are included. Existing operational authorities remain unchanged.

## Recovery

The database transaction aborts on a conflict or preservation failure. After a committed additive migration, retain shared_notes and all legacy/history evidence. A frontend rollback must use the previous verified READY deployment only under explicit release/rollback authority; keep the additive schema and investigate with forward corrections. Do not restore old broad raw-note projections, drop shared notes or reverse newly shared records automatically. Function rollback/recovery must preserve the no-Brand-token enrichment boundary. No database restore or destructive cleanup is required.

Directory release: completed and accepted on Production. Live organization-level Meta profile enrichment remains NO-GO pending the explicit connection/consent contract described above. No further Production action is authorized by this historical record.

Documentation Impact: Updated docs/domains/marketing.md and docs/architecture/platform.md.
