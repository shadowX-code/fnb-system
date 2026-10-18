# Consolidated Marketing release readiness — 18 October 2026

Prepared only. Production mutation requires explicit approval of the final candidate commit.

## Baselines and isolation

- Production main/live: `bcdcb31b13dc8708c2a1461f8a11387711579f47`; ledger 825.
- Existing READY deployment: `dpl_44UVNxcS2aSUWRxwXPLChK17jC8N`, project `fnb-system` (`prj_1UOKHvE6Ft4a2WXrZyZGc9LZRWLP`).
- Production Supabase: `oyfobxdoyfuzsodogpgs`; Inbox v22, Meta v25, Worker v27.
- Canonical Staging: `791576c696a40d10e0dd389ad69014f34114c8a5`, `ujkzdaaadnvcfayuldmh`, READY `dpl_DtsubV3eKokSfGxroSzykLzyybP8`.
- The candidate is isolated on Production main, integrating the 24 verified commits from `18c5aada` through `791576c6`, including requested milestones `62974de446`, `6d5cf8428`, `9386ed2da`, `791576c69`. It does not merge dev.
- Excluded: Recruitment, Finance, Guest AI, XHS Reader Pilot and all unrelated Staging changes. No package or Creator API changes are required.

## Included behavior

1. Brand Knowledge V3: one five-domain workspace; Restaurant-backed product identity and reliable facts; Marketing product descriptions; direct scoped promotions; canonical Outlet references; saved/unsaved tone preview. Existing uploaded menu history is retained outside the primary product workflow. Unknown prices, availability and Outlet context remain unknown.
2. Inbox assistant V2.1/V2.2: deterministic Active FAQ matching first, bounded semantic/context retrieval, multilingual suggestions, cited sources, handoff reasons, stale-source invalidation and usage evidence. Suggestions remain editable and never send, assign or close automatically.
3. Restaurant Brand/Outlet drawers: Brand owns logo/accent; relationship additions/removals require explicit confirmation; Outlet owns contact, regular/special hours, policies and attendance/GPS. Marketing consumes Outlet facts read-only through source links.
4. Creators: canonical uniqueness remains enforced; duplicate XHS identity errors identify only an authorized existing shared Creator and provide navigation, including when enrichment is unavailable. No automatic merges or relationship writes.

The candidate deliberately preserves Production's runtime-aware Inbox origin/environment/execution checks rather than copying the Staging handler wholesale. Shared execution, Meta, privacy, profile and authorization helpers retain exact Production bytes. Routing preserves Production modules; only Outlet source-link query state is added. Creator changes exclude the unapproved Reader Pilot.

## Ordered migrations

Apply only these ten files in their listed dependency order; expected ledger **825 → 835**. All ten match installed Staging receipts byte-for-byte. SHA-256 values are in the accompanying release manifest.

1. `20261017171806_marketing_inbox_hybrid_assistant.sql`
2. `20261017173943_marketing_inbox_assistant_match_evidence.sql`
3. `20261017175137_marketing_inbox_assistant_source_projection.sql`
4. `20261017184711_marketing_practical_brand_knowledge.sql`
5. `20261017190028_marketing_knowledge_tone_preview.sql`
6. `20261017191511_marketing_knowledge_price_conflicts.sql`
7. `20261018022218_restaurant_marketing_operational_knowledge.sql`
8. `20261018045227_canonical_brand_branding_and_outlet_editors.sql`
9. `20261018045829_brand_logo_storage_authority.sql`
10. `20261018050437_marketing_creator_account_conflicts.sql`

Dependencies run from assistant evidence → direct knowledge/tone → Restaurant operational sources → canonical Brand branding/storage ACL → Creator conflict authority. These include the private `marketing-knowledge` Storage bucket (5 MB PDF/JPEG/PNG/WebP cap), new revision/history tables and existing `outlet-logos` policy changes. No credentials or provider provisioning are needed.

Production preflight confirms the replaced Creator, Inbox and Platform function bodies match repository baseline; the Creator's exact conflict-handler needle and three unique indexes exist. Sixty existing referenced database identifiers are present; two additional names are produced by the earlier ordered function renames. New tables/bucket/columns are absent as expected, and both legacy logo policies exist. Operational needle patches resolve against functions introduced earlier in this same ordered migration set.

No Staging records, customer facts, Brand mappings, Creator identities, consent or approvals are copied. Existing Production Outlet logo/accent fields are all null, so the guarded branding-inheritance migration has no source asset/color to assign. Existing legacy source fields and objects are retained; old Outlet branding writes are intentionally closed in favor of Brand authority.

## Deployment sequence after approval

1. Recheck main, actual live alias, ledger, function versions/source hashes, ten checksums and migration/function preconditions. Stop on drift; never silently substitute a successor.
2. Apply exactly the ordered ten migrations with guarded transaction/receipts; any pre-commit failure rolls back the transaction. Verify ledger 835 and receipts before continuing.
3. Deploy **only `marketing-inbox`**, including its three new helpers (`inboxAssistant.ts`, `inboxAssistance.mjs`, `brandKnowledgeAI.ts`) and unchanged Production dependencies. Preserve existing JWT/handler authentication configuration. Do not deploy Meta, Worker, Privacy, Ads or Drive.
4. Fast-forward main once to the exact approved candidate for one existing Vercel Git Integration deployment. Do not use a second CLI/API deployment. If separately included in release approval and automatic assignment is paused, promote only that exact READY deployment to existing Production domains.
5. Perform focused authenticated read-only acceptance below. No environment changes, AI calls, seeding, messages, posts, enrichment extraction, new historical imports or relationship saves are part of release acceptance.

## Verification and acceptance

Reused Staging L3 evidence includes operational-source rollback assertions (scope, idempotency, versions, unknown/multiple Outlets, special/overnight hours and stale-source rejection) and Brand/Outlet editor rollback/browser checks (ACL, immutable assets, relationship confirmation, desktop/mobile, Light/Dark). Latest Creator changes and assistant refinements are included exactly. Existing Staging usage records independently show completed deterministic zero-token runs and semantic `gpt-5-mini` runs; no additional provider calls were made for release preparation.

Isolated candidate verification: **173 tests across 16 files passed**, including Production execution guards, routing, assistant/provider fallbacks, source-aware Knowledge, Inbox drafts, Creator conflicts and unified editors. Production build passed; existing large-chunk warnings remain. Two inherited migration EOF whitespace warnings are retained to preserve installed SQL checksums. No new Deno type-check was run; the existing deployed Staging helper/source parity and focused handler tests are reused.

After deployment, verify:

- Exact live SHA, ledger/receipt hashes and Inbox function receipt; Meta/Worker and other function versions unchanged.
- Read existing populated/partial/empty Brand Knowledge with one domain navigation; Restaurant source products, unavailable price/availability, promotions validity, read-only Outlet source links and Tone states.
- Open Restaurant Brand/Outlet editors without saving. Check appropriate permissions, sections, current values and relationship review UI. No business fixtures or asset replacements.
- Existing Messenger/Instagram conversation selection, identity, composer readiness, separate note/reply drafts and FAQ suggestions. No sends, assignment changes or AI generation. Confirm current canonical send guards remain intact.
- Creator Directory/detail and duplicate conflict navigation presentation using existing permitted evidence; never save a duplicate against Production for QA.
- Preserve Publishing enabled/controlled policy, Staff Reply enabled/normal, Job 10 inactive, jobs 11/12 active; no automatic AI sending, Ads execution or privacy activation. Capture before/after policy/config digests without credential values.

## Remaining runtime requirements

No confirmed code or migration compatibility blocker remains for this scoped release. Production AI is currently explicitly disabled (`MARKETING_AI_ENABLED=false`), `MARKETING_AI_MODEL` is absent and there are no Brand Inbox AI consent policy rows. Existing provider key presence alone is insufficient. Keep all of these unchanged. Provider suggestions and Tone Preview remain unavailable until a **separate** scoped model/runtime configuration approval and authorized Brand consent setup; deterministic assistance also remains subject to Brand consent and permissions. Do not copy Staging consent/settings or silently select a model. General-customer Meta Advanced Access remains outside this release.

## Rollback and failure handling

- Before migration commit: abort and roll back all ten; retain ledger 825. No partial schema progression is intended.
- After commit: preserve new schema/history/storage/receipt evidence; do not run destructive down migrations, restore a database or reset migration receipts.
- If function/frontend acceptance fails: stop release work and report. Proposed rollback is redeploy captured Inbox v22 source with its exact dependencies and re-promote existing READY `dpl_44UVNxcS2aSUWRxwXPLChK17jC8N`; those Production rollback actions require explicit approval unless the release authorization expressly includes them.
- Reverting the frontend does not reverse canonical Brand ownership. The old Outlet branding controls would remain denied by the forward schema, so keep those writes paused and use an approved forward correction. Preserve settings/Brand relationships and all background-job states; do not disable existing business operations as a rollback shortcut.

Documentation Impact: Updated Marketing and Restaurant domain contracts, platform/source-route ownership and focused testing documentation; this release packet records only the scoped integration and operational plan.
