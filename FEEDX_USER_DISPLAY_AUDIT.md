# FeedX User Display Audit

Date: 2026-05-31  
Scope: Static audit of operational screens for raw UUID exposure in user/employee identity fields.

## Display Standard

Preferred display priority:

1. `employees.nickname`
2. `employees.full_name`
3. `employees.email`
4. `Unknown User`

Raw UUID values must not be displayed in user-facing operational screens.

## Summary

Overall result: P0 remediated, P1 Asset Tracking actor-map remediation completed, conditional pass.

Inventory core screens now mostly resolve actor IDs through employee display helpers. P0 direct UUID exposure findings were remediated on 2026-05-31. Asset Tracking now loads historical actor employee records and resolves cross-user actions through an employee actor map. Remaining risks are lower-priority audit metadata areas that are not primary operational screens.

## Findings

| Screen name | Component/file | Field displayed | Current output | UUID can appear | Fix required |
|---|---|---:|---|---:|---|
| Dashboard / App Access Diagnostics | `src/app/App.jsx` | `auth.user.id`, `auth.profile.id` | DEV-only diagnostics panel; hidden outside `import.meta.env.DEV` | No in production | Remediated / no production fix required. |
| Alerts & Insights / Notification Center | `src/layouts/AppShell.jsx` | employee notification display | Uses `nickname || full_name || email` | No | No fix required. |
| Inventory Movements | `src/features/sales-purchase/pages/InventoryControlPage.jsx` | `created_by` via `movement.user || movement.createdBy` | Uses `actorNameByAnyId()` | Low | No immediate fix required; keep employee preload healthy. |
| Waste & Variance | `src/features/sales-purchase/pages/InventoryControlPage.jsx` | `recordedBy || user` | Uses `actorNameByAnyId()` | Low | No immediate fix required; keep employee preload healthy. |
| Waste Record Detail | `src/features/sales-purchase/pages/InventoryControlPage.jsx` | `recordedBy || user` | Uses `actorNameByAnyId()` | Low | No immediate fix required. |
| Purchase Orders / Receiving History | `src/features/sales-purchase/pages/InventoryControlPage.jsx` | `receivedBy` | Uses `actorNameByAnyId(receipt.receivedBy)` and label `Received By` | Low | No immediate fix required. |
| Stock Check active view | `src/features/sales-purchase/pages/InventoryControlPage.jsx` | `createdBy`, `submittedBy` | `createdBy` resolves via auth-user map; `submittedBy` resolves via employee map | Low | No immediate fix required. |
| Stock Check Result | `src/features/sales-purchase/pages/InventoryControlPage.jsx` | `submittedBy` | Uses `actorNameByEmployeeId()` | Low | No immediate fix required. |
| Audit Stock Check Result | `src/features/sales-purchase/pages/InventoryControlPage.jsx` | `submittedBy` | Uses `actorNameByEmployeeId()` | Low | No immediate fix required. |
| Master Inventory Cost Audit Metadata | `src/features/sales-purchase/pages/InventoryControlPage.jsx` | `cost_updated_by` | Stored/mapped but not visibly rendered in audited screen snippets | No current display | No fix unless future UI exposes it; use actor helper then. |
| Data Import Detail | `src/features/sales-purchase/pages/DataImportPage.jsx` | `imported_by || created_by` | Uses shared `getEmployeeDisplayName()` with employee/auth fallback | Low | Remediated for production display; future improvement is loading all employee actor records for historical imports. |
| Audit Logs | `src/features/company-users/pages/AuditLogsPage.jsx` and `src/services/auditLogService.js` | `user_name`, `user_id` | UI displays `user_name`; `user_id` is selected but not rendered | Low | No immediate UI fix; ensure `user_name` is populated with employee display name, not auth metadata only. |
| Roles & Permissions / Role Detail Audit | `src/features/company-users/pages/RolesPage.jsx`, `src/services/roleService.js` | `updatedBy`, created-by text | Mostly static/demo values such as `Development Owner`, `System`, or `Current User`; service maps `updated_by` directly if present | Yes if remote `updated_by` is used | Replace static/demo audit actor logic with employee display resolver before making role audit metadata production-facing. |
| Job Positions Detail Audit | `src/features/company-users/pages/JobPositionsPage.jsx` | `createdBy`, `updatedBy` | Uses `created_by_name` / `updated_by_name` when supplied, otherwise dash | Low | Ensure service/query always returns display name aliases; do not fallback to raw IDs. |
| Departments | `src/features/company-users/pages/DepartmentsPage.jsx` | created/updated fields | No raw user ID display found in sampled render path | No | No fix required from this audit. |
| Employees | `src/features/company-users/pages/UsersPage.jsx` | `auth_user_id`, employee ID | Auth IDs are used for save/refresh logic, not rendered in normal employee directory/action cells | Low | No fix required unless debug/detail view later exposes auth ID. |
| Duty Roster | `src/features/sales-purchase/pages/DutyRosterPage.jsx` | `employee_id` | Uses employee map to display nickname/full name | No | No fix required. |
| Outlet Duty Roster | `src/features/sales-purchase/pages/OutletDutyRosterPage.jsx` | `employee_id` | Uses employee map to display nickname/full name | No | No fix required. |
| Sales / Purchases / Operating Expenses | multiple sales-purchase pages and services | `created_by`, `updated_by` | Mostly stored in services, not visibly displayed in audited UI snippets | No current display found | If history/audit cards are added, use shared employee display resolver. |
| Asset Tracking Recent Activity | `src/features/sales-purchase/pages/AssetTrackingPage.jsx` | `asset.created_by`, `movement.created_by`, `maintenance.created_by` | Uses an employee actor map and shared `getEmployeeDisplayName()` to resolve nickname/full name/email | No | Remediated. |
| Asset Detail Activity Timeline | `src/features/sales-purchase/pages/AssetTrackingPage.jsx` | `created_by`, `updated_by`, movement and maintenance actors | Uses the same employee actor map as the Recent Activity feed | No | Remediated. |
| Asset Inspection Setup | `src/features/sales-purchase/pages/AssetTrackingPage.jsx` | `checkedBy`, `checkedByEmployeeId` | Displays authenticated user name in setup | Low | No fix required. |
| Asset Inspection History | `src/features/sales-purchase/pages/AssetTrackingPage.jsx` | `checked_by`, `checked_by_employee_id`, `created_by`, `last_edited_by` | Prefers non-UUID `checked_by`, then resolves employee/auth IDs through the employee actor map; UUID-like values fall back to `Unknown User` only when no employee exists | No | Remediated. |
| Asset Detail Latest Inspection | `src/features/sales-purchase/pages/AssetTrackingPage.jsx` | `latestInspection.checked_by`, actor IDs | Uses the same checked-by resolver and employee actor map as inspection history | No | Remediated. |

## Priority Fix List

P0:

- Remediated on 2026-05-31.
- `AssetTrackingPage.jsx`: Latest Inspection summary now uses the checked-by resolver and suppresses UUID-like values.
- `DataImportPage.jsx`: Import detail now uses shared `getEmployeeDisplayName()`.
- `App.jsx`: Access Diagnostics is confirmed DEV-only through `import.meta.env.DEV`.

P1:

- `AssetTrackingPage.jsx`: Remediated on 2026-05-31. Asset Tracking now collects actor IDs from assets, movements, maintenance, inspections, and inspection items; loads matching employee records; builds an employee actor map; and resolves actor display names without exposing UUIDs.
- `RolesPage.jsx` / `roleService.js`: Replace static/demo `updatedBy` and raw `updated_by` mapping with real employee display resolution when role audit metadata is production-facing.
- `JobPositionsPage.jsx`: Confirm remote query/service always supplies `created_by_name` / `updated_by_name`; do not fallback to raw `created_by` or `updated_by`.

P2:

- Continue migrating modules to the shared `getEmployeeDisplayName()` helper in `src/utils/userDisplay.js`.
- Add a UI safety helper that detects UUID-looking text in actor display slots and replaces it with `Unknown User` unless an explicit developer diagnostics flag is active.

## Recommended Shared Helper

```js
getEmployeeDisplayName(actorOrEmployee, {
  employees,
  currentProfile,
  currentUser,
  fallback: "Unknown User",
});
```

## Notes

- Runtime remediation was applied for P0 findings on 2026-05-31.
- Static analysis cannot prove every dynamic metadata field is safe; any future UI that displays metadata values from `before`, `after`, or `description` should avoid rendering IDs as primary user-facing labels.
