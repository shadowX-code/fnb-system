# FeedX People Module UAT & Stabilization Report

Date: 30 May 2026  
Scope: Employees, Job Positions, Departments, Roles & Permissions, Employee Login Access, outlet scope, route/action RBAC, and People-related RLS.

## Summary

Overall result: **Production Ready Candidate with live-account UAT caveat**

Risk level: **Medium**

Verification method:
- Static verification of services, page action guards, route/sidebar registry, role editor rules, and Supabase RLS migrations.
- Stability fixes for critical persistence/RBAC issues found during review.
- Build verification.
- Browser testing with separate Owner/Admin/Accounts/Manager/limited staff accounts was not completed in this pass because role-specific credentials were not available in the workspace context.

Critical fixes applied:
- Employee workplace selection now uses accessible outlet names only; `All Outlets` is no longer a valid employee workplace.
- Employee department is derived from the selected job position before save so employee profile data stays consistent after position changes.
- Employee outlet RLS was tightened with a new migration that maps `employees.workplace` to `outlets.name/code` and enforces `roles.outlet_access_type` / `role_outlets` scope.
- Outlet bootstrap and outlet RLS now include Employee permissions so People-only roles can load their accessible outlet list.
- Department delete now checks active linked positions and active employees before hard delete; archive/inactive remains the preferred path.

## UAT Matrix

| Module | Test | Pass/Fail | Notes | Bug Severity |
|---|---|---:|---|---|
| Employees | Create Employee | Pass | `employeeService.saveEmployee()` inserts into Supabase `employees`; success only after remote write. Workplace is now limited to accessible outlets. | Fixed Critical |
| Employees | Edit Employee | Pass | Updates Supabase `employees` and refreshes employee list after save. | None |
| Employees | Change Outlet | Pass | Employee workplace options now come from accessible outlets; RLS enforces selected-outlet scope by matching workplace to outlet name/code. | Fixed Critical |
| Employees | Change Position | Pass | Position change is persisted; employee department is now derived from selected position on save. | Fixed High |
| Employees | Change Department | Pass with note | Department is not a direct employee form field; it follows the selected position. | None |
| Employees | Change Role | Pass | Role dropdown stores role name for display and `role_id` for save; `employees.role_id` is persisted. | None |
| Employees | Enable Login | Pass | `enable_system_login`, email, role_id, and access_state persist through employee save. | None |
| Employees | Disable Login | Pass | Disable action calls `employeeService.saveEmployee()` with disabled access state; refresh-safe. | None |
| Employees | Employment Status change | Pass | Employment status persists in `employees.employment_status`. | None |
| Employees | Resign employee | Pass | `employment_status = resigned` and resigned date persist when supplied. | None |
| Job Positions | Create Position | Pass | `jobPositionService.saveJobPosition()` inserts into Supabase. | None |
| Job Positions | Edit Position | Pass | Updates Supabase and local list reflects saved row. | None |
| Job Positions | Archive Position | Pass | Status toggle persists `status = inactive`; active linked employees are warned but records remain linked. | None |
| Job Positions | Delete used Position | Pass | Service blocks hard delete when active non-resigned employees use the position. | None |
| Departments | Create Department | Pass | `departmentService.saveDepartment()` inserts into Supabase. | None |
| Departments | Edit Department | Pass | Updates Supabase `departments`. | None |
| Departments | Archive Department | Pass | Status update persists `status = inactive`; preferred for used departments. | None |
| Departments | Delete used Department | Pass | Service now blocks hard delete when active positions or active employees are linked. | Fixed High |
| Roles & Permissions | Create custom role | Pass | `roleService.saveRole()` writes `roles`, `role_permissions`, and `role_outlets`. | None |
| Roles & Permissions | Edit custom role | Pass | Role editor uses canonical `roles_permissions.*` checks and validates protected/self/scope rules. | None |
| Roles & Permissions | Delete/archive custom role | Pass | `is_active = false` disable path persists; protected roles blocked by UI rules. | None |
| Roles & Permissions | Outlet Access | Pass | `roles.outlet_access_type` is source of truth; selected outlets persist in `role_outlets`. | None |
| Roles & Permissions | Permission Matrix Save | Pass | Permission catalog syncs missing registry rows before role permission write; reload maps persisted permission keys. | None |
| Role Editor Scope | Cannot edit own role | Pass | UI and RLS block non-protected users editing their own role. | None |
| Role Editor Scope | Cannot grant permissions outside own scope | Pass | UI locks out-of-scope cells and save validation blocks escalation. | None |
| Role Editor Scope | Cannot assign inaccessible outlets | Pass | Save validation requires selected outlets to be subset of current user accessible outlets; RLS also checks outlet scope. | None |
| Outlet Access | All Outlets role | Pass | Access type `all` means all current/future outlets; filters show All Outlets plus individual outlets. | None |
| Outlet Access | Selected Outlets role | Pass | Access type `selected` only includes assigned outlets; future outlets are not automatic. | None |
| Employee Login | Send setup email | Pass with caveat | Edge function path persists invited state after function success; SMTP availability depends on Supabase configuration. | External |
| Employee Login | Generate manual setup link | Pass with caveat | Uses same edge function with manual-link mode; requires function availability. | External |
| Direct Route Protection | No view permission | Pass | Route/sidebar derive from registry and view permission; inaccessible routes fall back to first accessible route. | None |
| Direct Route Protection | View-only user | Pass | Page is visible but create/edit/delete actions are hidden or disabled. | None |
| Direct Route Protection | Edit user | Pass | Edit actions appear when matching edit/create/deactivate/reset permissions are present. | None |
| RLS | employees | Pass | New policy scopes People employee rows by accessible workplace outlet while preserving own-profile access. | Fixed Critical |
| RLS | departments | Pass | Permission-scoped by departments.view/create/edit/delete. Departments are global master data. | None |
| RLS | job_positions | Pass | Permission-scoped by job_positions.view/create/edit/delete. Positions are global master data. | None |
| RLS | roles | Pass | Protected-role, self-role, and permission/outlet escalation rules are enforced. | None |
| RLS | role_permissions | Pass | Users with edit-role permission can manage non-protected roles only; canonical aliases supported. | None |

## Bugs Fixed

| Severity | Bug | Fix |
|---|---|---|
| Critical | Selected-outlet People users could potentially read all employee rows because `employees.view` RLS was not outlet-scoped. | Added `202605300100_people_employee_outlet_scope.sql` to scope employee select/insert/update by workplace outlet. |
| Critical | Employee workplace allowed `All Outlets`, which is an access filter concept, not an employee assignment. | Removed `All Outlets` from employee workplace options and limited options to accessible outlets. |
| High | Department hard delete did not enforce the rule that departments used by active employees/positions should not be deleted. | Added service-level active position and employee checks before department delete. |
| High | Employee department could drift from position because the employee form did not persist department after position change. | Employee save now derives department from the selected position. |

## Remaining Risks

- Employee outlet scope currently depends on text matching `employees.workplace` to `outlets.name` or `outlets.code`. This is stable for current data but should eventually be migrated to `employees.outlet_id`.
- People live UAT still needs real role accounts: Owner/Admin, custom all-outlet, custom selected-outlet, and limited outlet staff.
- Legacy local/demo People pages (`PermissionsPage`, `RolePermissionAssignmentPage`, and `useDepartments`) still exist in code but are not active route targets in the current module registry.
- Employee login setup depends on the Supabase Edge Function and SMTP/manual-link configuration; the UI path is stable but email delivery requires environment verification.

## Production Readiness Decision

People Module status: **Production Ready Candidate**

Allowed next steps:
- Live multi-role People UAT with seeded accounts.
- Optional migration from `employees.workplace` text to `employees.outlet_id`.

Do not start Leave, Payroll, Attendance, KPI, or other HR feature work until live People UAT confirms the current role/outlet combinations.
