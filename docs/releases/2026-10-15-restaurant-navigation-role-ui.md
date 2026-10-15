# Restaurant navigation and Role UI release candidate

Prepared 15 October 2026. **Not deployed or merged.**

## Verified baselines

- Production project `fnb-system` / `prj_1UOKHvE6Ft4a2WXrZyZGc9LZRWLP`: READY deployment `dpl_GB86fc5PMePbDXDYMfUVzXDVJPHp`, source `05780c92182b461699fd4155c92f350614afe3f9`, aliases include `os.feedx.my` and `feedx.my`.
- Canonical Staging project `fnb-system-staging`: READY deployment `dpl_BJSHdNw4t27LaK6GrG8Z2TaxUigo`, source `9411c1ef13eb50909a99a7f36b9df17dbdd86cec`.
- Refreshed origin/main and origin/dev match those deployed commits. The existing user checkout has unrelated work; it was not changed. Candidate branch `codex/restaurant-navigation-role-ui-release` is isolated from exact Production base.

## Differences and scope

Production already has Brands, its route owner and the current Marketing baseline. Only Outlets' registry section differs: Operations versus System. Change this one field, retaining its ID, permissions, route `/operations/outlets` and canonical route resolution. Bring the existing Staging `roleAccess` exception for Outlets so moving to System does not remove Outlet-only role scope.

Production Role Detail/Edit use duplicated category-tab tables with a global set of action columns. Bring the existing shared Staging `RolePermissionMatrix.jsx` and CSS, its caller changes and regression tests. This provides Search, Workspace and Module filters, workspace grouping, applicable action columns, shared DataTable mobile layout, permission-owner descriptions, accurate active-cell counts and theme tokens. Keep existing Role summaries, assigned-employee reads, retry/snapshot saves, protected-role rules, Outlet scope and server authorities. Include Staging's client delegation lock so newly ungrantable actions remain disabled; this enforces existing server delegation, not a grant change. Import the existing generic Configure label and seven permission-description overrides, without changing codes.

Shared `DataTable`, `AdminFilterToolbar`, `AdminSearchField`, `SelectField` and `roleService` are identical between the compared branches. No shared component, service, dependency, API, RPC or schema upgrade is required.

### 99 versus 101

Production registry: 119 distinct IDs, 99 permission-owning modules, 373 permission codes. Staging registry: 134 distinct IDs, 101 permission-owning modules. The two extra permission owners are `guest_ai` (Access/Developer) and `recruitment` (View/Manage). The other thirteen added entries reuse permissions or are route/navigation containers. No duplicate IDs were found. Exclude all fifteen unrelated modules and Finance/Guest workspace additions. The candidate deliberately retains 99 modules and exactly the original 373 codes; the release contract test verifies a SHA-256 digest of their sorted code set. Counts are registry-derived presentation, not role grants or an instruction to insert database records.

## Verification and reused evidence

QA level: L2 release-compatibility preparation; no trusted authority changes. Existing Staging permission integration evidence is `f8f776249` / `docs/audits/marketing-permission-integration-2026-10-13.md` on dev. Its historical role-wide Brand-scope discussion is superseded by the later member-scope authority and is not a release requirement.

- 39 tests across five focused suites passed: shared matrix, Role lifecycle, Payroll permission split, role security contract and new scoped release contract.
- Covers filter/toggle persistence, read-only behavior, existing trusted save/retry, canonical employee assignment reads, protected/delegated restrictions, exact permission inventory, unchanged Outlet route and Outlet-only scope.
- Production build passed. Existing large-chunk warning remains; no dependency upgrade is in scope.
- `git diff --check` passed.
- Read-only authenticated Production browser confirms old categories and 99 modules, Outlets under Operations, Brands/Audit Logs under System.
- Authenticated Staging browser confirms System contains Brands/Outlets/Audit Logs; Search finds Media Library's existing permission owner; Workspace limits action columns; selecting Marketing Workspace leaves only Access. No role, grant, employee or Outlet record was saved.
- Existing canonical components and Staging responsive/theme evidence are reused; no full external or integration QA was repeated. Candidate has not been deployed, so post-release Production presentation remains unverified.

## Approval and rollout

Approve only the reviewed candidate code commit atop the verified Production baseline for project `fnb-system`, plus read-only post-release smoke. No database migration, credential, membership, grant or provider change is included. This preparation does not authorize main merge. If the normal release path requires main advancement, obtain explicit merge authorization in addition to deployment approval; do not promote the entire dev branch. Recheck the Production alias SHA before rollout; rebase/review and rerun focused checks if it changed.

After approval, verify canonical Production identity and existing Production configuration, build/deploy only the candidate, then read-only smoke: System navigation/deep links, existing Outlet list, Role Detail filters/search, Edit entry/cancel without save, narrow layout and theme. Observe runtime errors. Do not save any business Role or Outlet merely for verification.

Rollback: restore the exact prior READY deployment `dpl_GB86fc5PMePbDXDYMfUVzXDVJPHp` if release smoke fails. There is no database rollback because no data/schema change is included. Obtain rollout authorization that explicitly covers rollback if needed.

Remaining blocker: explicit scoped Production release authorization. No known code/schema dependency blocker was found. Provider/execution readiness is unrelated and is not activated by this UI release.

Documentation Impact: Updated `docs/domains/people-identity-rbac.md`.
