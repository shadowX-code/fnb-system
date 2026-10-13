# Marketing member Brand access — Staging acceptance

Date: 13 October 2026. QA level: L3 Canonical. Scope: canonical Platform authorization and Marketing Team & Brand Access; no Production or external execution.

## Verified behavior

- Three disposable Supabase Auth users signed in through the real password/token endpoint. The privileged key was held only in process memory for fixture setup/removal; all tested RPCs used the users’ JWTs.
- Two members with the same regular Role had independent Brand selectors and authorized reads. Cross-Brand and cross-tenant reads across Settings, Planner, Creators, CRM, Conversations and Ads were rejected with `42501`.
- Self escalation, replacing another member’s hidden Brand scope, and direct scope-table writes were rejected. Revocation immediately denied the existing JWT; the other member remained authorized and the access fingerprint changed.
- Rollback SQL additionally verified retries, stale revisions, restricted Brand Master mutations, dormant-member assignment visibility, assignees, scheduled publishing actors and Inbox/Ads execution authority.
- Existing business membership and Role-grant checksums were unchanged after cleanup: `e650c85613a355a7eb46c68f9c722a71` and `5a5d1c722f45eea3eb3c22f5d445b2aa` respectively. Existing selected legacy scope remained equivalent after migration.
- Auth users, QA tenant, Brands, member scopes, Role and synthetic Marketing request/events were removed. Three inactive synthetic employee baselines remain because canonical employment revisions prohibit deletion; they have no Auth link, system login, Role or Brand access. No immutable evidence guard was disabled.

## UI and delivery

Authenticated canonical Staging Owner UI verified the member table, All Brands/Brand filters, Role labels, multi-selection drawer, protected Owner read-only access, Save availability and unsaved-change cancellation without saving any real member change. Desktop/mobile Light/Dark presentation was inspected; no horizontal overflow. Existing membership actions reuse Platform commands; Role configuration links to canonical Roles & Permissions.

Backend/UI deployment: `c0c7ec599152cae74415001698faa86aaff1ce3a`, READY deployment `dpl_3ASswT8AzS2krwnWnwZWPhq4bCjh` on the Staging project. Follow-up delivery corrects protected-role explanatory text and Settings loading handoff only.

Focused final tests: 21 passed; production build passed. Broader relevant run: 446 tests passed in 63 files. An unrelated Deno-owned Inbox profile test was selected by Vitest and cannot run under that runner; Deno was unavailable locally. Four Role lifecycle tests hit their explicit 10-second timeout during a later resource-contended run; the earlier broader Role run passed. Unrelated Payroll/Employee failures were not changed. SQL and real JWT security acceptance passed independently.

## Revocation boundary

Every protected request and relevant worker checkpoint revalidates current canonical Role permissions and member Brand scope. Marketing cached views refresh on focus/visibility and visible polling, hiding data if access refresh fails. Previously issued private media URLs can remain valid until their existing expiry (up to five minutes). Provider operations already in flight cannot be recalled; receipts/history remain intact and later execution requires current authority. Existing approvals, connection gates and disabled execution were preserved.
