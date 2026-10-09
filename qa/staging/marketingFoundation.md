# Marketing foundation verification

QA level: L3. Environment: canonical Staging only (`ujkzdaaadnvcfayuldmh`, `fnb-system-staging`). No Production mutation or provider request.

## Phase 0 decisions

Repository, Staging catalog, privileges and existing domain contracts established these owners:

| Concern | Authority / decision |
| --- | --- |
| Auth / employees / roles | Supabase Auth, `employees.auth_user_id`, `employees.role_id`, canonical role save RPC and permission catalog |
| Organization / brand | No existing hierarchy in Staging; user approved additive shared Platform ownership, explicit memberships and brand–outlet relationships |
| Outlet | Existing canonical `outlets`; mapping checks existing outlet access, no cloned outlet master |
| Company / legal employer | Existing `legal_entities` belongs to People/payroll, kept separate from organization and brand |
| Customer / loyalty | No restaurant member/loyalty authority established; Factory customers and anonymous feedback cannot become a marketing customer master |
| Feedback / finance | Existing owner read contracts remain authoritative; no new customer identity, attribution or financial writes |
| Storage | Existing Supabase private Storage, prepared upload/finalize authority, immutable same-brand references |
| Background jobs | Existing domain-specific payroll/recruitment jobs do not constitute a shared publishing queue; additive Marketing job ledger and service-only contracts, no active worker |
| AI / providers | Existing domain AI credentials are not implicit Marketing authorization; server interfaces and unavailable capability status only |

Documentation owner: `docs/domains/marketing.md`; shared boundaries: `docs/architecture/platform.md`.

## Verified automated and database behavior

- 24 relevant test files / 90 tests pass, including route ownership, launcher, role contracts, Marketing component scope fencing, timezone/DST conversion and provider fail-closed handling. Production build passes (existing large-chunk warning).
- Three append-only Marketing migrations applied to the verified Staging ref. The third fixes a job-claim alias/unused-variable ambiguity discovered by rehearsal.
- `marketingFoundation.rollback.sql` passes using an authenticated fixture employee and custom role, actual canonical RPCs and service-only worker calls, within one rolled-back transaction.
- Tenant/brand denial, direct table denial, anonymous/private-credential grants, revoked membership and protected service boundaries verified.
- Exact content retry identity, changed-payload denial, stale revisions, version-bound approval/invalidation, review/rejection, schedule/calendar/audit, cancellation, knowledge revision/provenance verified.
- Canonical role save preserves exact Marketing grants. Selected-brand managers cannot grant future all-brand scope. Approval queues preserve authoritative totals across pages.
- Prepared media is uploader-scoped and unreadable before finalization. Missing objects cannot finalize. A real Storage upload/preview remains part of later populated UI verification.
- No production provider configuration can execute; sandbox and expired fixture connections cannot claim. Rollback-only lease fixtures verify single claim, rejection of missing receipts and uncertain responses entering reconciliation without resend. No provider post ID is created.
- After rollback, organizations, brands, content and jobs remain empty. No real organization/brand/outlet mappings were inferred or persistent QA permissions granted.

## Canonical UI verification

Deliver through clean `dev` and Vercel Git Integration, run `verify:staging-vercel-target`, confirm READY alias SHA, and verify with the existing authenticated Staging Admin session. Check launcher, independent Marketing navigation, all five routes, explicit empty membership/setup state, representative Restaurant return navigation, narrow viewport layout and console errors. UI mutation of real ownership is intentionally deferred until explicit real organization/brand setup; mutation authority is covered by rollback fixtures above.

## Remaining dependency and next scope

Phase 1 locally verifiable foundation is delivered. Official Meta OAuth exchange, server credential vault/configuration, test-account network adapter, publishing worker, social synchronization and platform insights remain unconnected and unverified. Schedules remain visibly Blocked, never Published. Connection metadata distinguishes test and production authorization; neither is seeded.

Phase 2 begins with an explicitly authorized Marketing AI provider and permitted research configuration, then planner/creative capabilities, EN/ZH/BM drafts, scripts/storyboards, source freshness and approved integration into Content revisions. No Inbox, audience/customer master, WhatsApp, Ads, spending, SaaS billing or public onboarding is implemented early.
