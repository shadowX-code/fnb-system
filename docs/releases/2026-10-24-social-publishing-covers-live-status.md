# Social Publishing Studio: Reel covers and provider availability

Prepared 24 October 2026. Production mutations are NOT authorized by this packet.
Documentation Impact: authority/schema change; canonical owner docs/domains/marketing.md updated. This document is a release packet, not another domain authority.

## Exact baselines

- Production main/live: 4cf7291b582679f1a85225a7f633b74ba2dc6657; Supabase oyfobxdoyfuzsodogpgs, ledger 861.
- Production verified READY rollback deployment: dpl_E4DF5ETksejVxWfxpG1vC2r3cmrN.
- Production Worker v41 (same accepted v39 bundle), Inbox v34, Drive v27. Exact source hashes are in the private bundle manifests.
- Staging dev: 02099a83f0b73704aad4f9a890c9ca5fd51495c0; canonical fnb-system-staging READY dpl_BxYpuQ7dfkXPQQDFJ8kYbwk5wuxo.
- Staging Supabase ujkzdaaadnvcfayuldmh, ledger 897; Worker v94, Inbox v73, Drive v22.
- Local Production branch: codex/social-studio-completion-production. Exact final commit recorded in /private/tmp/feedx-social-studio-completion/readiness.json; not pushed.
- Parent 2470f34277a83f5ad12921292337017029a1c640 carries ONLY the three previously deployed Publishing backend corrections. It preserves the live receipt recovery and expiring-format guards absent from main. Those already-applied migrations are history catch-up, not new deployment instructions.

## Included behavior

Instagram Reels support Automatic, video-frame offset and custom JPEG covers. Cover selection is bound to the exact video UUID and canonical revision, pinned separately from primary video media, validated before provider submission and included in the immutable publishing snapshot. Existing approval invalidation and uncertain-send protections remain authoritative. The frame preview is local; no duplicate frame image is stored. Custom cover selection uses existing Media Library/Drive authorities. Independent channel captions/media remain intact. Changing the video invalidates its cover binding.

Facebook Reel cover parameters are not exposed: the reviewed official publishing endpoint does not provide an equivalent verified control. Reel 9:16 and profile-grid 3:4 previews are indicative; Meta controls final crop. Custom image contract: 9:16 JPEG, 540–1440 pixels wide, at most 8 MB.

Live availability is a private sidecar keyed by connection/generation/post, separate from Published receipts, dates and Insights. Existing Social Sync records positive feed evidence plus at most one known-post GET per account turn, capped at five seconds with state-specific backoff. Calendar, List, Detail and Social Analytics use canonical projections. Unknown, unavailable, permission-restricted and transient failures never imply deletion. Only exact known-post removal evidence from a signed Facebook Page feed webhook can establish Removed. Replay, old generations, stale echoes and restoration require distinct proof. HMAC validation remains ahead of persistence. No subscriptions are installed.

## New Production mutation scope, after explicit approval

1. Recheck main/live, ledger 861, all three exact function hashes, seven SQL fingerprints, protected jobs/connection identities and the release file manifest. Stop on drift and prepare a successor when required.
2. Apply ONLY migration 20261024035434_marketing_reel_covers_publication_availability.sql. SHA-256: 5045d8a7310e024d89acc2410152fb7788d820214c946c813e770f92814c8aa1. Expected ledger 861 → 862. The prepared guarded transaction also records the exact migration source and reloads the PostgREST schema cache; it is NOT executed.
3. Deploy ONLY the three reviewed target-specific bundles, preserving every other live dependency:

| Function | Verified Production baseline | Changed bundle files | Preserved live files |
|---|---:|---:|---:|
| marketing-worker | v41 | 5 | 28 |
| marketing-inbox | v34 | 2 | 16 |
| marketing-drive | v27 | 3 | 7 |

4. Fast-forward main to the exact approved RC once for the existing fnb-system Vercel Git integration. If domain assignment is paused, promote only its matching READY deployment to the existing Production domains without rebuilding.
5. Focused authenticated read-only acceptance below. No Production test drafts, publishing, provider changes or execution activation.

DO NOT apply 20261023181858 or 20261024023626 again: both are already in ledger 861. Do not deploy marketing-meta or any additional function. Do not change credentials, consent, jobs, scheduler cadence, flags or leases.

## Verification completed

- 239 focused core/regression tests across 20 files; 16 final UI checks after the three narrow empty/selection-state refinements. These totals overlap and are not additive.
- 43 rollback-only SQL assertions against applied Staging schema: scope/identity, cover references and retention, revision validation, lease/generation checks, signed-event replay/chronology, restoration and restricted Brand reads. Fixture mutations rolled back.
- All six exact Staging/Production Worker, Inbox and Drive bundles type-check successfully.
- Production compatibility: 88 tests across nine files, final two-file UI checks 16/16, production build passed. Staging build passed.
- Authenticated real Staging draft saved/reopened frame offset 2400 ms, then custom JPEG; both revisions retained, independent FB/IG captions, loaded 1080×1920 cover and zero publishing jobs. Re-clicking Custom Image retains its saved selection. No-video/no-image states are actionable and neutral.
- Desktop/mobile, Light/Dark and fixed save actions checked. Light appearance, desktop viewport and Calendar preference restored.
- Existing Social Sync produced real Live on Meta observations for T3, T4 and T5. Actual restricted Facebook reads and unavailable Instagram objects remain distinct from deletion. Detail preserves Published and source provenance.
- Current Production read-only recheck: seven existing publication jobs, zero pending/uncertain work, zero active temporary format leases; jobs 10 inactive, 11/12 active. No Production changes occurred.

Staging fixture: fe4221fb-8cb8-469d-8987-8315c34cb22a, clearly labelled QA Studio cover acceptance — never publish; Draft revision 2, unapproved, unscheduled, zero jobs. Frame revision 1 and image revision 2 are retained for inspection. Video 656af493-4941-4970-a88b-8e5f8dcbc94e; cover b2f4758c-5df5-435f-938a-d4fc011b238e. Neither is public.

## Provider acceptance and limitations

- Reused T3 Facebook Video and T4 Reel success; no repeat publishing.
- T5 was already completed under the previous separate approval, contrary to the initial stale task baseline: Instagram 18099943967385775, https://www.instagram.com/p/De3KPBnAEuy/, JPEG then MP4, published 24 October 2026 11:26:07 MYT; durable receipt 11:26:14. No T5 execution occurred in this cycle.
- Cover parameter formation, validation, preview and persistence passed; actual public Meta cover appearance has NOT been accepted. A later exact isolated cover-publishing approval is required for that external test.
- Signed Facebook deletion handling passed isolated fixtures, not a real deletion/subscription test. Existing channel feed subscriptions must be separately verified/approved before claiming live deletion delivery. Instagram provides no verified definitive deletion event in this scope. Ambiguous GET failures remain unavailable.
- App-role/account-specific acceptance does not establish general-customer Advanced Access.
- Facebook Video/Reel and Instagram Extended flags remain false; zero active leases. Instagram Stories lack real provider acceptance and remain disabled. No AI or Ads execution activation.
- Permanent format enablement is NO-GO through a bare flag: current authority intentionally permits only expiring generation-bound tests (FB ≤30 minutes, IG ≤20 minutes/non-renewable). The accepted IG generation-3 T5 window is spent. Permanent operation needs a separately reviewed extension of this SAME canonical authority plus explicit activation approval; never reconnect to reset the window.

Official cover references: https://github.com/fbsamples/reels_publishing_apis/blob/main/insta_reels_publishing_api_sample/README.md and https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/page.py .

## Focused Production acceptance, read-only

Verify authorized editor rendering and saved fields using existing records; no new draft or edit. Check canonical List/Calendar/Detail/Analytics availability consistency, true unknown/restricted states, original receipt IDs/times/URLs and partial-channel results. Allow only existing bounded Social Sync reads; do not request new history or alter subscriptions. Compare protected publication/checkpoint evidence and account generations before/after; confirm disabled format flags/leases and unchanged scheduler/execution policy. Reuse Staging evidence for new cover save/validation rather than editing Production business data.

## Rollback

Stop on drift or failed acceptance. Any rollback mutation requires separate approval. Preferred frontend rollback: promote only previous READY dpl_E4DF5ETksejVxWfxpG1vC2r3cmrN; no rebuild, business-data correction or automatic SQL reversal. Retain the additive schema and evidence.

Original Production function sources and hashes are retained privately in studioProdWorker.json, studioProdInbox.json and studioProdDrive.json. Before any Worker rollback, prove there are no pending/approved/scheduled cover-bearing executions; an old Worker does not implement those settings. If any exist, do not blindly revert: obtain exact approval for canonical hold/cancellation or a forward correction. Preserve in-flight receipts/reconciliation. Inbox/Drive rollback similarly requires dependency and in-flight checks. Never drop availability evidence or immutable cover revisions to restore old code.

Private evidence, exact file/bundle manifests, prepared SQL and screenshots: /private/tmp/feedx-social-studio-completion/.
