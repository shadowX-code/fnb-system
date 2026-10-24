# Marketing publication availability verification

Canonical availability is independent from immutable publication receipts and historical Insights. Manual confirmation requires Content Publish and View with Brand access; provider confirmation remains service-only signed evidence.

Run the focused postAvailability, PostAvailabilityPanel, PostDetail, ContentManagement and metaPostAvailability tests. The Staging rollback contract is `qa/staging/marketingPublicationRemoval.rollback.sql`; it uses isolated transactional identities and rolls everything back, with no provider calls.

Verify:
- Manual confirmation derives actor/time, retains staff provenance, rejects stale expected revisions and replays one request idempotently.
- Same-tenant unauthorized Brands, missing membership, unknown identities and direct client/private-table writes are denied.
- Clear confirmation appends a decision and preserves provider evidence, receipts and Insights.
- Unavailable/restricted reads do not prove deletion or erase manual confirmation.
- A pre-confirmation in-flight lease and owned-feed echoes cannot establish recovery; subsequent exact-object reads expose conflicts. The existing one-object availability target forces this read for both manual and provider-confirmed removal.
- Calendar hides fully confirmed removed multi-channel records or channels satisfying the independent repeated explicit-not-public policy, before day counts/pagination. Show Unverified / Removed and List retain history; live, unknown, failed or uncertain sibling channels remain visible.
- Shared Detail immediately consumes the canonical returned projection, and status/identity/metrics remain unchanged.
- Desktop/mobile Light/Dark controls wrap and remain accessible.

Browser mutation acceptance must use a dedicated labelled QA Brand and synthetic posts on disconnected, credential-free connections with `posts=false` and execution disabled. Never mark existing business posts as removed for QA. Provider-confirmed fixture presentation is not real signed webhook acceptance. Do not publish/delete provider content, activate formats or alter existing access merely to exercise this workflow.

Run `qa/staging/marketingCalendarVisibility.rollback.sql` for repeated-check timing/lease deduplication, stale evidence, no first-verification hiding, all-channel eligibility, current-generation isolation, error/outage resets, recovery, Brand isolation, Calendar counts and List/history preservation. Three repeated permission or ambiguous missing-object failures must never hide records. No live provider requests are required.
