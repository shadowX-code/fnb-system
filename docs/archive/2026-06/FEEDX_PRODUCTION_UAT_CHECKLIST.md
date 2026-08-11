# FeedX Production UAT Checklist

Date: 1 June 2026  
Purpose: Final production cutover checklist for validating FeedX modules, permissions, data persistence, and critical workflows.

Legend:

- Pass: works as expected.
- Fail: production blocker or logged bug.
- N/A: not in current production scope.

## Release Gate

| Area | Test | Expected | Result | Notes |
|---|---|---|---|---|
| Build | Run `npm run build` | Build passes | Pending | Large chunk warning acceptable as P1. |
| Supabase | Confirm production migrations applied | No missing schema/column errors | Pending | Compare local vs production migration list. |
| RLS | Owner/admin smoke test | Full access | Pending | Use production account. |
| RLS | Selected-outlet role smoke test | Assigned outlet data only | Pending | No unassigned outlet leakage. |
| Storage | Upload/read/delete image | Works for allowed role | Pending | Inventory, asset, waste evidence. |
| Auth | Login/logout | Works | Pending | Production domain. |
| Auth | Forgot password | Reset link opens setup-password and completes | Pending | No Access Error. |
| Auth | Employee invite/setup link | Pending session blocked from app until password set | Pending | Production SMTP/Edge Function. |

## Overview

| Module | Test | Expected | Result | Notes |
|---|---|---|---|---|
| Dashboard | Load as owner/admin | KPIs, alerts, and scoped data load | Pending | |
| Dashboard | Load as selected-outlet role | Data is outlet scoped | Pending | |
| Outlet P&L | Year selector and KPIs | Data-driven years and compact KPI scale | Pending | |
| S&P Dashboard | Load sales/purchase summary | No oversized KPI regression | Pending | |
| Product Analytics | Upload report | Report persists and analytics update | Pending | |
| Product Analytics | Year selector | Uses data-driven year list | Pending | |
| Sales Comparison | Load and export | Jan-Dec comparison works | Pending | |
| Purchase Comparison | Load and export | Supplier/category comparison works | Pending | |
| Alerts & Insights | Role-aware notifications/insights | No finance alerts for unauthorized users | Pending | |
| Outlet Duty Roster | Load roster overview | Outlet-scoped data | Pending | |

## Sales

| Module | Test | Expected | Result | Notes |
|---|---|---|---|---|
| Sales Input | Create/edit monthly sales | Refresh-safe | Pending | |
| Sales Input | Import Sales CSV/XLSX | Batch and rows persist | Pending | |
| Sales Input | Permission view-only | Cannot create/edit/import | Pending | |
| Sales Channels | Create/edit/archive | Refresh-safe | Pending | |
| Tax Settings | Edit effective config | Refresh-safe | Pending | |

## Purchases

| Module | Test | Expected | Result | Notes |
|---|---|---|---|---|
| Purchase Input | Create/edit monthly purchase | Refresh-safe | Pending | |
| Purchase Input | Import Purchase CSV/XLSX | Batch and rows persist | Pending | |
| Suppliers | Create/edit/archive supplier | Refresh-safe | Pending | |
| Supplier Categories | Create/edit/archive | Refresh-safe | Pending | UI label must say Supplier Categories. |
| Purchase Comparison | Abnormal highlight | Rules display correctly | Pending | |

## Operations

| Module | Test | Expected | Result | Notes |
|---|---|---|---|---|
| Operating Expenses | Create/edit/delete expense | Refresh-safe | Pending | |
| Duty Roster | Create/edit/delete shift | Refresh-safe | Pending | |
| Duty Roster | Shift template time input | Accepts common formats | Pending | |
| Duty Roster | Resigned employee hidden | Not selectable for active roster | Pending | |
| Asset Tracking | Create/edit/archive asset | Refresh-safe | Pending | |
| Asset Tracking | Import assets | Valid rows persist, invalid rows blocked | Pending | |
| Asset Tracking | Inspection flow | Draft/submit/history refresh-safe | Pending | |
| Asset Tracking | Evidence/photo display | Image visible after refresh | Pending | |
| Outlets | Create/edit outlet | Refresh-safe | Pending | |
| Data Health | Load checks | No direct Data Import dependency | Pending | |

## Inventory Control

| Module | Test | Expected | Result | Notes |
|---|---|---|---|---|
| Inventory Dashboard | Load | Uses Supabase-backed inventory data | Pending | |
| Master Inventory | Create/edit/archive item | Refresh-safe | Pending | |
| Master Inventory | Photo upload | Photo visible after refresh | Pending | |
| Master Inventory | Linked outlet add/remove | Adds and deletes links correctly | Pending | |
| Master Inventory | Inline cost edit | Cost persists | Pending | |
| Master Inventory | Import CSV/XLSX | Valid rows write Supabase, invalid rows blocked | Pending | |
| Inventory Categories | Create/edit/archive/delete | Refresh-safe, delete blocked when used | Pending | |
| Inventory UOMs | Create/edit/archive/delete | Refresh-safe, delete blocked when used | Pending | |
| Par Levels | Update par/storage/suppliers | Refresh-safe | Pending | |
| Stock Check Groups | Create/edit/duplicate/archive | Refresh-safe | Pending | |
| Stock Check | Scheduled start/save/submit | Draft/result persists | Pending | |
| Stock Check | Missed scheduled check | Backdated scheduled check cannot start | Pending | |
| Stock Check | Mobile layout | Mobile card layout, desktop unchanged | Pending | |
| Audit Stock Check | Save/submit/delete draft | Draft delete only for drafts | Pending | |
| Purchase Suggestions | Create Draft PO | Supabase PO persists, duplicate prevented | Pending | |
| Purchase Orders | Edit/submit/cancel draft | Refresh-safe | Pending | |
| Purchase Orders | Partial/full receive | Receipts and movements persist | Pending | |
| Purchase Orders | Complete partial/full | Correct completion type/reason | Pending | |
| Inventory Movements | PO receive movement visible | Created by PO receive and refresh-safe | Pending | |
| Inventory Movements | Manual editable movement | Waste/Transfer/Adjustment editable; Purchase read-only | Pending | |
| Wastage | Record waste with photo | Record and movement persist | Pending | |
| Wastage | View detail | Recorded by and evidence photo display | Pending | |
| Recipes & Usage | Add/edit/archive recipe | Refresh-safe | Pending | |
| Recipes & Usage | Menu category settings | Create/edit/archive/sort | Pending | |
| Product Mapping | Pending/map/ignore/restore | Mapping state persists | Pending | |
| Recipe Intelligence | Monthly reports | Uses mapped Product Analytics only | Pending | |
| Recipe Intelligence | Ingredient analytics | No fake data; mapped-only calculations | Pending | |

## People

| Module | Test | Expected | Result | Notes |
|---|---|---|---|---|
| Employees | Create/edit employee | Refresh-safe | Pending | |
| Employees | Employment type/status | Separate fields persist | Pending | |
| Employees | Management workplace | Saves without outlet id/RLS error | Pending | |
| Employees | Disable access | Preserves login metadata/history | Pending | |
| Employees | Enable access/setup link | Saved email/role required; link works | Pending | |
| Employees | Change login email | Requires setup again | Pending | |
| Employees | Historical actor display | Names shown, no UUID | Pending | |
| Job Positions | Create/edit/archive | Refresh-safe; used positions protected | Pending | |
| Departments | Create/edit/archive | Refresh-safe; used departments protected | Pending | |
| Roles & Permissions | Create/edit/archive role | Refresh-safe | Pending | |
| Roles & Permissions | Own role protection | Cannot edit own role permissions | Pending | |
| Roles & Permissions | Scope enforcement | Cannot grant unavailable permission/outlet | Pending | |

## System

| Module | Test | Expected | Result | Notes |
|---|---|---|---|---|
| Audit Logs | Load logs | No UUID exposure where name is available | Pending | |
| Audit Logs | Filter/export | Works for permitted users | Pending | |
| Sidebar | Navigation labels | Dashboard, Supplier Categories, Wastage, Recipe Intelligence correct | Pending | |
| Account Menu | Profile/change password/sign out | No dead actions; toast above modals | Pending | |
| Dark Mode | Key modules | Semantic contrast readable | Pending | |
| Mobile | Login and stock check | First-screen usability and safe-area footer | Pending | |

## Sign-Off

| Role | Name | Date | Decision | Notes |
|---|---|---|---|---|
| Product Owner |  |  | Pending | |
| Operations Lead |  |  | Pending | |
| Finance/Accounts |  |  | Pending | |
| Admin/RBAC Owner |  |  | Pending | |
| Engineering |  |  | Pending | |

