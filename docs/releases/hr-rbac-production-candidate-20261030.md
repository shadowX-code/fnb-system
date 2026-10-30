# Isolated HR/RBAC Production candidate

Base: `0cc6df7a02b80bbcae457bacd45a640bdbb20625`. Source: canonical Staging `1751b142dcb3dfc00f332b37c4da6f034894271f`.

## Decision: BLOCKED pending executable migration rehearsal

This is a local, buildable candidate only. No main push, Production deployment or Production mutation is authorized/performed by preparation.

HR composes existing Employees, Payroll, Organization and Compliance plus shared platform Roles/AI Integrations. Recruitment navigation/permissions/routes and Finance/Guest AI development are excluded. Shared registry, routing and shell conflicts were reconciled on Production; Staging files were not substituted wholesale. Existing Production Factory/Gateway runtime, catalogs, Edge Functions, token authorization, grants and credential policies are unchanged. Only human Matrix presentation and explicit supported actions change.

Dependencies include canonical shared Card/MetricCard/FilterToolbar props, workforce pagination, company/Run drill-through and legacy route aliases. Role editor and roleService delta payload changes are in this same candidate. Deploying either separately is unsupported.

## Exact migration order

- `20261030052423_role_explicit_grant_changes.sql` SHA256 `4c24f144c4f31d49b87dc6070a93a25e39c2785cb86b079f1df65d53c8a21567`
- `20261030053149_role_grant_changes_scope_normalization.sql` SHA256 `e249254d8cb73d84fbfe89cb06915f43314f8784591f8d8ea6a301a15a491dcb`
- `20261030055000_rbac_business_permission_coverage.sql` SHA256 `9fd6cf6f3ffcf7822c077c122539eeed514631c8bbe9775a5dc57517526234c1`

Only these three forward migrations are added. Production ledger read = 924; expected after approved application = 927. No catalog/grant backfill is required. Do not run an unrestricted migration push.

Read-only preflight: original save RPC signature exists; new helper and intent column are absent; draft-delete signature exists. No collisions found. The migrations do not execute business role-grant mutations at application time. Existing snapshot authority is retained internally and still enforces current Production machine-role restrictions.

Executable Production-compatible migration rehearsal was NOT completed: Docker daemon is unavailable and there is no local PostgreSQL binary. Existing Staging rollback-only SQL QA remains valid evidence, but is not represented as a new Production-shaped rehearsal. Required next step: execute these exact scripts on an isolated copy of the relevant Production schema/grant dataset, verify metadata save, one-code revoke, concurrent edits/retry, all 1,243 grants, scopes and machine guard, then roll back disposable fixtures. Do not rehearse by mutating Production or replacing Staging's applied authorities.

## Grant evidence (Production read-only)

- All role grants: 1,243; fingerprint `b813b986b4fd4551bc9a6886b75b9b35`.
- Manager: 251; code fingerprint `8e94a2b753964de67c0a07891d9a0350`.
- Agent role: 24; code fingerprint `6db6eeb2e083044fbc8bb9629472e36e`.
- Owner/Admin: 355 each; code fingerprint `7571121eeaae10da96e4d1a146b6dac8`, including retained compatibility grants.

These were read, not rewritten. Production preservation after executing the migrations remains an uncompleted rehearsal gate. Existing Staging tests cover hidden grants, explicit deltas, scope normalization, conflict/retry and agent selection preservation.

## Verification

Candidate build passes. Scoped HR/workforce, Matrix, role service/editor, AI Integrations and capability-selector tests: 83/84 initially passed; the only failure was a parallel 5-second timeout; its complete 20-case file passed independently. Six release isolation/HR routing checks passed. Factory/Gateway catalogs are byte-identical to the Production base. No new Edge Function deployment is included. No browser deployment/smoke was performed for this local candidate.

## Future governed release / recovery

After rehearsal passes, recheck live/main drift; snapshot fingerprints, apply only the three approved migrations, push the approved candidate to main once, wait for Git READY/exact SHA and run read-only smoke. Old cached role editors fail closed after migration and must reload. Stop on failure; no automatic rollback. Do not reverse the explicit-delta migrations or restore unsafe snapshot saving; any app recovery must retain the compatible editor/service or keep role editing unavailable pending a forward fix.

## Exact application/test/document diff

- `config/modules.ts`
- `docs/architecture/trusted-authorities.md`
- `docs/audits/factory-agent-human-matrix-20261030.md`
- `docs/audits/rbac-workspace-reconciliation-20261030.md`
- `docs/domains/people-identity-rbac.md`
- `src/app/AdminApp.jsx`
- `src/app/__tests__/HrProductionIsolation.test.jsx`
- `src/app/__tests__/HrWorkspace.contract.test.jsx`
- `src/app/__tests__/routeOwnership.contract.test.js`
- `src/app/routeOwnership.js`
- `src/app/routes.jsx`
- `src/components/layout/AdminFilterToolbar.jsx`
- `src/components/layout/__tests__/AdminFilterToolbar.test.jsx`
- `src/components/ui/Card.jsx`
- `src/components/ui/MetricCard.jsx`
- `src/features/company-users/components/RolePermissionMatrix.jsx`
- `src/features/company-users/components/RolePermissionMatrix.test.jsx`
- `src/features/company-users/pages/DepartmentsPage.jsx`
- `src/features/company-users/pages/EmployeeCompliancePage.jsx`
- `src/features/company-users/pages/JobPositionsPage.jsx`
- `src/features/company-users/pages/LegalEntitiesPage.jsx`
- `src/features/company-users/pages/PayrollPage.jsx`
- `src/features/company-users/pages/RolesPage.jsx`
- `src/features/company-users/pages/UsersPage.jsx`
- `src/features/company-users/pages/__tests__/PayrollControlCenter.test.jsx`
- `src/features/company-users/pages/__tests__/RolesLifecycle.test.jsx`
- `src/features/company-users/pages/__tests__/UsersPageLifecycle.test.jsx`
- `src/features/hr/HrDashboardPage.jsx`
- `src/features/hr/__tests__/HrDashboardPage.test.jsx`
- `src/features/hr/__tests__/workforceOverview.test.js`
- `src/features/hr/workforceOverview.js`
- `src/features/integrations/ExternalAgentsPage.jsx`
- `src/features/integrations/ExternalAgentsPage.test.jsx`
- `src/layouts/AppShell.jsx`
- `src/services/__tests__/businessPermissionCoverage.test.js`
- `src/services/__tests__/employeeWorkforceRead.test.js`
- `src/services/__tests__/roleServiceContracts.test.js`
- `src/services/employeeService.js`
- `src/services/roleService.js`
- `src/styles/index.css`
- `supabase/migrations/20261030052423_role_explicit_grant_changes.sql`
- `supabase/migrations/20261030053149_role_grant_changes_scope_normalization.sql`
- `supabase/migrations/20261030055000_rbac_business_permission_coverage.sql`
- `supabase/tests/rbac_sensitive_business_denials.sql`
- `supabase/tests/role_explicit_grant_changes.sql`
- `supabase/tests/role_grant_scope_normalization.sql`
- `supabase/tests/role_hidden_agent_grant_preservation.sql`
- This release manifest.
