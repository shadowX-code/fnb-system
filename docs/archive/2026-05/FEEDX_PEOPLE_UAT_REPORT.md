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
- Staging browser/remote verification on 31 May 2026 for the separated Employment Type and Employment Status fields.
- Browser testing with separate Owner/Admin/Accounts/Manager/limited staff accounts was not completed in this pass because role-specific credentials were not available in the workspace context.

Critical fixes applied:
- Employee workplace selection now uses accessible outlet names plus the HQ-only `Management` option; `All Outlets` is no longer a valid employee workplace.
- Employee department is derived from the selected job position before save so employee profile data stays consistent after position changes.
- Employee outlet RLS was tightened with a new migration that maps `employees.workplace` to `outlets.name/code` and enforces `roles.outlet_access_type` / `role_outlets` scope.
- Outlet bootstrap and outlet RLS now include Employee permissions so People-only roles can load their accessible outlet list.
- Employment structure migration `202605310009_employee_employment_structure.sql` separates Employment Type, Employment Status, and System Access, with a migration report table for legacy status/type mapping review.
- System Access UX now separates HR profile editing from login lifecycle actions. Active accounts show Disable Access / Change Login Email, pending accounts show setup-link actions, and no-access accounts show Enable Access.
- Setup password links now create only a temporary setup session. Pending/not-sent/invited employees cannot enter the app until password creation succeeds and `setup_completed_at` is written.
- Department delete now checks active linked positions and active employees before hard delete; archive/inactive remains the preferred path.

## UAT Matrix

| Module | Test | Pass/Fail | Notes | Bug Severity |
|---|---|---:|---|---|
| Employees | Create Employee | Pass | `employeeService.saveEmployee()` inserts into Supabase `employees`; success only after remote write. Workplace is now limited to accessible outlets or `Management` for HQ users. | Fixed Critical |
| Employees | Edit Employee | Pass | Updates Supabase `employees` and refreshes employee list after save. | None |
| Employees | Change Outlet / Workplace | Pass | Employee workplace options now come from accessible outlets, with `Management` available as a non-outlet workplace for HQ users. RLS enforces selected-outlet scope by matching outlet workplaces to outlet name/code. | Fixed Critical |
| Employees | Change Position | Pass | Position change is persisted; employee department is now derived from selected position on save. | Fixed High |
| Employees | Change Department | Pass with note | Department is not a direct employee form field; it follows the selected position. | None |
| Employees | Change Role | Pass | Role dropdown stores role name for display and `role_id` for save; `employees.role_id` is persisted. | None |
| Employees | Enable Access | Pass | Access setup is explicit from the System Access panel or table action; login email, role_id, and access_state persist through employee save. | None |
| Employees | Disable Access | Pass | Disable action saves `access_state = disabled` while preserving login email, role_id, auth_user_id, last login, Employment Status, and historical employee records. | Fixed High |
| Employees | Employment Type change | Pass | Employment Type is separate from lifecycle status and persists in `employees.employment_type`. | Fixed High |
| Employees | Employment Status change | Pass | Employment Status is limited to Active, Resigned, and Terminated and persists in `employees.employment_status`. | Fixed High |
| Employees | Resign/terminate employee | Pass | `employment_status = resigned/terminated` and end date persist when supplied; login access remains a separate field. | None |
| Employees | Active account table actions | Pass | Active access rows show View, Edit, and Disable Access; Send Login Setup / Generate Setup Link are hidden. | Fixed Medium |
| Employees | Pending account table actions | Pass | Pending/not-sent rows show View, Edit, Send Login Setup, Generate Setup Link, and Disable Access. | Fixed Medium |
| Employees | Login email change | Pass | Change Login Email is explicit and moves the account back to setup-required state instead of being hidden inside HR profile edits. | Fixed Medium |
| Job Positions | Create Position | Pass | `jobPositionService.saveJobPosition()` inserts into Supabase. | None |
| Job Positions | Edit Position | Pass | Updates Supabase and local list reflects saved row. | None |
| Job Positions | Archive Position | Pass | Status toggle persists `status = inactive`; active linked employees are warned but records remain linked. | None |
| Job Positions | Delete used Position | Pass | Service blocks hard delete when active employees use the position. | None |
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
| Employee Login | Setup password route guard | Pass | Invite/recovery setup sessions are blocked from dashboard access while employee access is `not_sent`/`invited`; the app stays on `/setup-password` until password update and setup completion succeed. | Fixed Critical |
| Direct Route Protection | No view permission | Pass | Route/sidebar derive from registry and view permission; inaccessible routes fall back to first accessible route. | None |
| Direct Route Protection | View-only user | Pass | Page is visible but create/edit/delete actions are hidden or disabled. | None |
| Direct Route Protection | Edit user | Pass | Edit actions appear when matching edit/create/deactivate/reset permissions are present. | None |
| RLS | employees | Pass | New policy scopes People employee rows by accessible workplace outlet while preserving own-profile access. | Fixed Critical |
| RLS | departments | Pass | Permission-scoped by departments.view/create/edit/delete. Departments are global master data. | None |
| RLS | job_positions | Pass | Permission-scoped by job_positions.view/create/edit/delete. Positions are global master data. | None |
| RLS | roles | Pass | Protected-role, self-role, and permission/outlet escalation rules are enforced. | None |
| RLS | role_permissions | Pass | Users with edit-role permission can manage non-protected roles only; canonical aliases supported. | None |

## Employment Structure Browser UAT - 31 May 2026

| Test | Result | Notes |
|---|---:|---|
| Employees page renders separated fields | Pass | Staging Employees page renders separate `Employment Type` and `Employment Status` columns and filters. |
| Employment Type transition | Pass | Test employee `CCC` was moved through `probation` to `full_time`; remote `employees.employment_type` persisted the value. |
| Employment Status transition | Pass | Test employee `CCC` was moved from `active` to `resigned`; remote `employees.employment_status` persisted the value after refresh-level verification. |
| Resigned employee excluded from Duty Roster staff source | Pass | Duty Roster and Outlet Duty Roster staff loaders require `employee.employment_status === "active"`; a resigned `CCC` row was absent from the active-employee query. |
| Resigned employee remains in Employee Directory | Pass | The employee row remains in `employees` and can be shown by Employee Directory status filtering; the record is not deleted. |
| Historical record display rule | Pass | Existing People/operations user-display helpers preserve employee name display as nickname, then full_name, then email, then `Unknown User`; login disable or resignation does not delete the employee record. |
| Test data restored | Pass | `CCC` was restored to `employment_type = full_time`, `employment_status = active`, and `resigned_date = null`. |
| Management workplace save | Pass | Browser UAT changed `CCC` to `workplace = Management`, saved, refreshed, confirmed the value persisted, then restored `CCC` to `Hola Hola Kopitiam Ipoh`. No outlet/RLS save error appeared. |

## System Access Browser/Data UAT - 31 May 2026

Test employee: `Phoenix Wong Kar Yan` (`Phoenix`) was used for reversible staging checks and restored after verification.

| Test | Result | Notes |
|---|---:|---|
| Active user row actions | Pass | Browser check on an Active employee row showed `View`, `Edit`, and `Disable Access`; `Send Login Setup` and `Generate Setup Link` were not present for the Active row action menu. |
| Disable Access persistence | Pass | Staging update set `access_state = disabled`, `is_active = false`, and `enable_system_login = true` while preserving login email, `role_id`, `auth_user_id`, `last_login_at`, and `email_verified`. Browser refresh showed the row as `Disabled`. |
| Disabled user cannot enter app | Pass | Login context blocks employees when `is_active === false` or `access_state === disabled`; this was verified against the persisted disabled state and the auth context guard. |
| Disable Access toast timing | Pass | Row-menu Disable Access now awaits the Supabase save before showing the success toast; failures show the existing employee update error toast. |
| Re-enable Access setup state | Pass | Re-enable path moved the employee to `access_state = not_sent`, preserved login email and role, and browser UI exposed setup fields with `Send Login Setup Email` and `Generate Setup Link`. |
| Generate setup link | Pass | Browser UAT generated a manual setup link for an already pending staging employee (`CCC` / `idamans.hq@gmail.com`) when email delivery was unavailable; setup-link generation completed successfully without exposing the link in the report. |
| Setup link redirect target | Pending browser retest | The onboarding Edge Function now sends Supabase invite/recovery links with `redirectTo = APP_URL/setup-password` instead of the app root. |
| Setup link refresh guard | Pending browser retest | Code path now treats Supabase invite/recovery sessions as temporary setup sessions. Refreshing `/setup-password` or navigating directly to dashboard with `access_state = not_sent/invited` is redirected back to `/setup-password` until the password is saved. |
| Change Login Email state | Pass | Login email change was verified with a temporary staging email; it moved the employee to `not_sent`, set `email_verified = false`, cleared `verification_sent_at`, and preserved role/auth metadata for setup-required flow. |
| Historical record name display | Pass | Inventory Movements browser check showed employee names such as `Isaac` and `Dason Yap`; no raw UUID-shaped values were visible in the rendered movement records. |
| Test data restored | Pass | Phoenix was restored to `email = jymt.kopitiam@gmail.com`, `access_state = active`, `is_active = true`, `enable_system_login = true`, `email_verified = true`, original `role_id`, original `auth_user_id`, and original `last_login_at`. |

## Account Menu Password UX - 31 May 2026

| Test | Result | Notes |
|---|---:|---|
| Password fields | Pass | Sidebar Change Password modal has Current Password, New Password, and Confirm New Password fields with Show/Hide toggles and inline error space. |
| Simplified policy | Pass | New password validation requires 8+ characters, at least one letter, and at least one number. Special characters and case-mix are not required. |
| Live checklist and strength | Pass | Checklist updates for length, letters, and numbers; strength shows Weak, Medium, or Strong according to the documented policy. |
| Save guard | Pass | Save remains disabled until current password is filled, the new password passes requirements, and confirmation matches. |
| Error wording | Pass | Wrong current password is normalized to `Current password is incorrect.` instead of a generic Supabase error. |

## Forgot Password UAT - 31 May 2026

| Step | Result | Notes |
|---|---:|---|
| Forgot password link opens reset flow | Pass | Login page exposes `Forgot password?`; requesting a reset calls Supabase `resetPasswordForEmail`. |
| Reset email sent | Pending mailbox UAT | Code path sends reset through Supabase Auth. Real mailbox delivery requires access to the recipient inbox/SMTP event logs. |
| Email contains valid reset link | Pending mailbox UAT | Frontend now passes `redirectTo = APP_ORIGIN/setup-password` for forgot-password reset links. |
| Link opens Reset Password page | Code verified | Auth context accepts Supabase `type=recovery` callback tokens, establishes a temporary setup/reset session, and renders the password page. |
| Refresh stays on Reset Password page | Code verified | Callback tokens are normalized to `/setup-password`; if the temporary session remains, password reset mode is preserved and app routes are not shown before completion. |
| Dashboard blocked before reset completion | Pass | Password recovery/setup sessions render only the password page and skip dashboard/master-data loading. |
| Password update succeeds | Pending live UAT | Requires using a real reset link and intentionally changing a test account password. |
| Old password rejected | Pending live UAT | Requires changing a real test account password and attempting old-password login. |
| New password accepted | Pending live UAT | Requires changing a real test account password and logging in with the new password. |
| Expired link handled | Code verified | Invalid/expired recovery tokens fail session establishment and do not produce the app Access Error page; the app falls back to login. |
| No Access Error during valid reset flow | Code verified | Recovery sessions set `passwordRecovery = true`, so `SetNewPasswordPage` renders before user-context permission loading. |

Fixes from this pass:
- Forgot-password reset links now redirect to `/setup-password`.
- Active-user password recovery no longer calls the employee setup-completion RPC; that RPC is only used when the employee record is still pending setup.

## Bugs Fixed

| Severity | Bug | Fix |
|---|---|---|
| Critical | Selected-outlet People users could potentially read all employee rows because `employees.view` RLS was not outlet-scoped. | Added `202605300100_people_employee_outlet_scope.sql` to scope employee select/insert/update by workplace outlet. |
| Critical | Setup password links could create a Supabase session and app context before the employee actually set a password. | Removed automatic employee activation from auth context loading; added `complete_employee_password_setup()` RPC and setup route guard so activation happens only after password update succeeds. |
| Critical | Employee workplace allowed `All Outlets`, which is an access filter concept, not an employee assignment. | Removed `All Outlets` from employee workplace options and limited options to accessible outlets, with `Management` as the explicit non-outlet HQ workplace. |
| High | Department hard delete did not enforce the rule that departments used by active employees/positions should not be deleted. | Added service-level active position and employee checks before department delete. |
| High | Employee department could drift from position because the employee form did not persist department after position change. | Employee save now derives department from the selected position. |

## Remaining Risks

- Employee outlet scope currently depends on text matching `employees.workplace` to `outlets.name` or `outlets.code`; `Management` remains a text-only non-outlet workplace. Outlet employees should eventually be migrated to `employees.outlet_id`.
- People live UAT still needs real role accounts: Owner/Admin, custom all-outlet, custom selected-outlet, and limited outlet staff.
- Legacy local/demo People pages (`PermissionsPage`, `RolePermissionAssignmentPage`, and `useDepartments`) still exist in code but are not active route targets in the current module registry.
- Employee login setup depends on the Supabase Edge Function and SMTP/manual-link configuration; the UI path is stable but email delivery requires environment verification.

## Production Readiness Decision

People Module status: **Production Ready Candidate**

Allowed next steps:
- Live multi-role People UAT with seeded accounts.
- Optional migration from `employees.workplace` text to `employees.outlet_id`.

Do not start Leave, Payroll, Attendance, KPI, or other HR feature work until live People UAT confirms the current role/outlet combinations.
