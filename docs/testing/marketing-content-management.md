# Marketing Content Management verification

QA level: L3 (scoped read RPC, immutable planning payload validation, optional social preview projection).

- Run `npm test -- src/features/marketing src/app/__tests__/MarketingWorkspace.contract.test.jsx`, `npm run build`, `deno check --no-lock supabase/functions/marketing-worker/index.ts`, and `git diff --check`.
- Verify Staging Supabase ref `ujkzdaaadnvcfayuldmh` before `qa/staging/marketingContentManagement.rollback.sql`. All fixture identities, content, receipts and social observations live in one rollback transaction and make no provider calls. The receipt fixtures are synthetic test evidence and never represent a real publication.
- Rehearsal covers org/brand/action isolation, direct-table denial, planning retries/validation/version-bound approval, dated pending approvals, undated exclusion, grouped variants, independent planned/scheduled/actual times, reconnection deduplication, FeedX receipt association, independent account identity, bounded list pagination and complete 131-record daily overflow counts.
- UI tests cover initial List, user-specific view preference, consistent KL filter bounds, date navigation, zero/unavailable/incomplete metrics, read-only external detail, shared filters, overflow-to-day List, stale scope responses and per-channel evidence without execution actions.
- Adapter tests cover optional thumbnail rejection/unavailability, trusted HTTPS media hosts, token-material exclusion and preserved credential/authority failures. Existing sync, publishing, OAuth, Inbox and route regressions remain in the focused Marketing suite.
- Deliver through clean `origin/dev`, matching READY Git deployment on `fnb-system-staging`, then authenticated List/Calendar/Library/Analytics checks. Verify existing historical Meta posts, actual zero metrics, read-only detail, month/week/date navigation, persistent preferred view and mobile no-overflow behavior. A read-only sync refresh may verify current thumbnails using existing credentials; no OAuth changes or publishing execution is involved.
- Record a representative screenshot. Preserve connection bindings, publishing Unverified/execution disabled and Production unchanged. Do not create persistent content fixtures when rollback mutation evidence and existing real social posts suffice.


### Deleted schedules and recovery

Run `qa/staging/marketingContentDeletion.rollback.sql` against canonical Staging. It verifies explicit/stale confirmation, Calendar/List/legacy-reader history visibility, unchanged payloads/media and terminal jobs, same-ID new Draft revision, fresh two-channel scheduling authorization, duplicate/retry and generation/Brand guards, in-flight claim exclusion and partial/uncertain visibility. Synthetic provider identities are rollback-only evidence; the suite makes no provider call and claims no real publishing delivery. UI regressions cover exact channel/time confirmation, failure/retry feedback, duplicate-click exclusion, Draft reopening and independent Show Deleted versus Meta visibility controls. Authenticated desktop/mobile QA uses existing content without saving, deleting, restoring or scheduling real records.

### Published media after temporary snapshot cleanup

`postMedia.test.jsx` covers the Happiness failure shape: retired image snapshot plus exact synchronized Instagram image; thumbnail and Detail/Performance must render the provider image without signing the retired object. Also verify a ready snapshot signing failure falls back only once, expired CDN evidence shows unavailable, refreshed normal-Sync URLs recover, carousel order stays intact, untrusted hosts/token-bearing URLs are rejected, and a late prior-channel signed URL cannot replace the current channel. Never restore or indefinitely retain temporary publishing files for preview QA.

Facebook numeric zero, omitted action buckets, denied protected count edges, current Views/Unique Viewers, and Instagram metrics retain the existing `metaSynchronization.test.ts` and `PostDetail.test.jsx` contracts. Empty provider aggregate objects are unavailable, never invented zero; Unique Viewers is not relabelled Reach.
