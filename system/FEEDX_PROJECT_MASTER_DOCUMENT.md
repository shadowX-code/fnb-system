# FeedX Project Master Document

Last updated: 2026-05-23  
Document owner: FeedX product / engineering workspace  
Document purpose: Permanent project source-of-truth for requirements, architecture, modules, fields, business rules, permissions, integrations, and development plan.

## Documentation Maintenance Rule

This document must be updated automatically whenever future development changes any of the following:

- Product requirements
- Sidebar or module architecture
- Database tables or fields
- Business logic
- RBAC permissions
- RLS policies
- Supabase Edge Functions
- Import/export workflows
- Employee/auth/onboarding flow
- Audit logging scope
- UI/UX behavior that affects business process

Future workflow:

1. User provides change request.
2. Assistant updates this document first or in the same implementation pass.
3. Assistant implements code changes.
4. Assistant verifies build/tests where applicable.
5. Assistant summarizes both documentation and code changes.

This file is the permanent archive for FeedX system direction. Do not create competing requirement documents unless this document links to them explicitly.

---

## 1. Project Goal

FeedX is an F&B intelligence and operations management platform for multi-outlet restaurant businesses.

The product has evolved from a sales and purchase dashboard into a company-wide operations platform covering:

- Sales input and comparison
- Purchase input and comparison
- Outlet-level P&L
- Operating expense tracking
- Supplier and category management
- Tax configuration history
- Data import and data health
- Risk alerts and insights
- Employee profiles
- Roles and permissions
- Audit logs
- Supabase Auth onboarding

Primary product positioning:

- Brand: FeedX
- Subtitle: F&B Intelligence
- Main workspace: Smart Operations Workspace
- UX direction: clean enterprise SaaS, management-friendly, AI-enabled operations platform

Core principles:

- Data must persist in Supabase for production modules.
- RBAC must control sidebar, route access, UI actions, and backend RLS.
- Employee, Job Position, and Role are separate concepts.
- Historical financial logic must be preserved.
- User-facing UI must not expose developer terminology.
- Audit logs must track business-critical actions only.

---

## 2. Information Architecture

Final sidebar structure:

```text
OVERVIEW
- Outlet P&L
- S&P Dashboard
- Sales Comparison
- Purchase Comparison
- Alerts & Insights

SALES
- Sales Input
- Sales Channels
- Tax Settings

PURCHASES
- Purchase Input
- Suppliers
- Purchase Categories

OPERATIONS
- Operating Expenses
- Duty Roster
- Outlets
- Data Import
- Data Health

PEOPLE
- Employees
- Job Positions
- Departments

SYSTEM
- Roles
- Audit Logs
```

Architecture rule:

Sidebar navigation, route metadata, permission matrix rows, role coverage chips, and audit scope labels must come from the centralized module registry.

Source:

```text
config/modules.ts
```

---

## 3. Central Module Registry

Each module is defined as:

```ts
{
  id: string,
  section: string,
  label: string,
  route: string,
  icon?: string,
  sidebar: boolean,
  permissions: {
    view?: boolean,
    create?: boolean,
    edit?: boolean,
    delete?: boolean,
    approve?: boolean,
    export?: boolean,
    import?: boolean,
    manage?: boolean
  }
}
```

Registry responsibilities:

- Sidebar item generation
- Permission matrix generation
- Route access control
- Audit module labels
- Future dashboard permission scopes

Strict rule:

When a new module or page is added, developers should add or update the module registry entry first. The rest of the system should derive from that registry.

---

## 4. Core Domain Concepts

### 4.1 Outlet

Outlet is the main operating unit for sales, purchases, tax settings, P&L, operating expenses, and data health.

### 4.2 Employee

Employee is the person/HR profile.

Employee contains:

- Personal information
- Employment information
- Bank information
- Optional system login access

One person equals one employee profile.

### 4.3 Job Position

Job Position is an HR title only.

Examples:

- Owner
- Outlet Manager
- Supervisor
- Cashier
- Kitchen Crew
- Finance Officer

Important:

Job Position is not a system role and must not have system-role protection. All job positions can be deleted if they are not assigned to active employees.

### 4.4 Role

Role is a system access template.

Role defines:

- Permissions
- Outlet access

Only `owner` and `admin` are protected system roles.

Protected role access rule:

- `owner` and `admin` always have full system access automatically.
- They bypass permission matrix checks for current and future modules.
- They do not depend on `role_permissions` rows for access.
- Role Management must display all registry permissions as enabled for protected roles.
- Protected roles cannot be deleted or edited directly.

### 4.5 SST Tax Configuration

SST is outlet-level and effective-date based.

It is not:

- A global setting
- A monthly manual setting
- A hardcoded 6% assumption
- A simple current boolean

---

## 5. Modules and Functional Requirements

## 5.1 Outlet P&L

Purpose:

Show yearly management P&L performance by outlet.

Route:

```text
Overview > Outlet P&L
```

Filters:

- Outlet: All Outlets or individual outlet
- Year
- Reset
- Export dropdown placeholder

Data sources:

- Revenue: `sales_records`
- COGS: `purchase_records`
- OpEx: `operating_expenses`

Calculations:

```text
Revenue = saved sales records / net sales
COGS = saved purchase records / total purchase
OpEx = manual operating expense input
Gross Profit = Revenue - COGS
Net Profit = Revenue - COGS - OpEx
Net Profit Margin = Net Profit / Revenue
```

Sections:

- KPI cards
- Revenue Trend Chart
- Net Profit Trend Chart
- Monthly P&L Breakdown
- Outlet Ranking YTD
- Profitability Insights
- P&L Summary YTD

KPI cards:

- Total Revenue
- Gross Profit
- Net Profit
- Net Profit Margin

Primary KPIs:

- Net Profit
- Net Profit Margin

Net Profit Margin health badge:

```text
>= 25%: Excellent
>= 15%: Healthy
>= 5%: Warning
< 5%: Critical
```

Monthly P&L cards:

- Render only months up to the selected/current month.
- Future month cards are hidden.
- COGS and OpEx show ratio percentage beside values.
- Revenue is the base for COGS/OpEx ratio.
- If revenue is 0, ratio displays `--`.

Outlet Ranking YTD:

- Outlet
- Revenue
- COGS
- OpEx
- Net Profit
- Margin %
- Contribution %

Contribution formula:

```text
outletNetProfit / totalGroupNetProfit
```

Insights:

- Revenue growth
- Margin drop
- High COGS
- Missing OpEx
- Group contribution

Export menu:

- Export PDF
- Export Excel
- Management Summary

Current status:

- Implemented first version with Supabase-backed sales, purchase, and OpEx data.
- Export actions are future-ready placeholders.

---

## 5.2 S&P Dashboard

Purpose:

Sales and purchase performance overview.

Sidebar label:

```text
S&P Dashboard
```

Data:

- Sales records
- Purchase records
- Sales channels
- Purchase categories
- Suppliers

Charts:

- Sales vs Purchase Trend
- COGS Margin Trend

Chart rules:

- Always display Jan-Dec timeline.
- Line chart dots must be circular SVG dots.
- Avoid decorative segmented KPI footer bars.
- Use clean enterprise analytics style.

KPI layout:

- Icon
- Title
- Primary value
- Comparison text
- Optional insight sentence

---

## 5.3 Sales Input

Purpose:

Record monthly sales by outlet and sales channel.

Data table:

```text
sales_records
```

Fields:

- id
- outlet_id
- year
- month
- channel_id
- channel_name
- amount
- remark
- created_at
- updated_at

Unique key:

```text
outlet_id + year + month + channel_id
```

Behavior:

- Load existing records when outlet/month/year changes.
- Empty amount counts as 0.
- Save uses upsert.
- No duplicate channel rows for the same outlet/month/year.
- Locked month is read-only.
- User must have create/edit permission to save.
- View-only users see read-only table.

SST behavior:

- Resolve SST using outlet tax config helper.
- If SST enabled for selected month, show SST row.
- If SST disabled, hide SST row and do not warn.

---

## 5.4 Sales Comparison

Purpose:

Compare sales across months and channels.

Data source:

```text
sales_records
```

Behavior:

- Uses live Supabase data.
- Aggregates by outlet, year, month, channel.
- Supports export permission.
- Does not depend on mock transaction history.

---

## 5.5 Sales Channels

Purpose:

Manage sales channel master data.

Data table:

```text
sales_channels
```

Fields:

- id
- name
- type
- sort_order
- status
- is_active
- created_at
- updated_at

Common channels:

- Dine In
- FoodPanda
- GrabFood
- ShopeeFood
- Takeaway

Permissions:

- sales_channels.view
- sales_channels.create
- sales_channels.edit
- sales_channels.delete

---

## 5.6 Tax Settings

Purpose:

Manage outlet-level SST configuration history.

Data table:

```text
outlet_tax_configs
```

Fields:

- id
- outlet_id
- tax_type
- enabled
- rate
- effective_from
- effective_until
- created_at
- updated_at

Tax type:

```text
SST
```

Business rules:

- SST configuration is outlet-level.
- SST is effective-date based.
- New future config automatically closes the previous current config one month before.
- Historical months preserve old tax logic.
- No global default SST.
- No per-month manual setting.

Example:

```text
Hola Ipoh Bangsar
2026-01 -> 2027-06: SST OFF, 0%
2027-07 -> Current: SST ON, 6%
```

Helper:

```js
getOutletTaxConfig(outletId, month, year, taxType)
```

UI wording:

- SST Enabled
- SST Disabled
- No SST Config
- Effective from Jan 2026

---

## 5.7 Purchase Input

Purpose:

Record monthly purchase data by outlet, supplier, and category.

Data table:

```text
purchase_records
```

Fields:

- id
- outlet_id
- year
- month
- supplier_id
- category_id
- amount
- remark
- created_at
- updated_at

Unique key:

```text
outlet_id + year + month + supplier_id + category_id
```

Behavior:

- Supplier dropdown shows supplier name only.
- Supplier default category auto-fills after selection.
- Save uses Supabase.
- View-only role sees read-only state.
- Locked month is read-only.

---

## 5.8 Purchase Comparison

Purpose:

Compare purchases by category and supplier.

Data source:

```text
purchase_records
```

Display:

- Category subtotal rows
- Expandable supplier rows
- Supplier breakdown must render when category count says suppliers exist.
- Supplier rows render if supplier has any record in displayed period range, even if current selected month is zero.

Grouping:

- category_id / category_name
- supplier_id / supplier_name

Fallback:

- Missing supplier name shows `Unknown Supplier`.

---

## 5.9 Suppliers

Purpose:

Manage supplier master data.

Data table:

```text
suppliers
```

Fields:

- id
- name
- category
- default_category_id
- phone
- remark
- status
- is_active
- created_at
- updated_at

Supplier Directory requirements:

- Outlet Usage count
- Last Purchase
- Total Purchase This Month
- Remark column
- Supplier Health
- Detail modal

Outlet Usage:

- 0 outlets
- 1 outlet
- 2 outlets
- X outlets
- Clickable count opens popover/modal with outlet names.

Last Purchase:

- Month Year
- `—` if none

Supplier Health:

- Stable
- Dormant
- Unused

Delete protection:

- If supplier has purchase records, delete is hidden or disabled.
- Use deactivate instead.

---

## 5.10 Purchase Categories

Purpose:

Manage purchase category master data.

Data table:

```text
purchase_categories
```

Fields:

- id
- name
- sort_order
- status
- is_active
- created_at
- updated_at

Behavior:

- Supplier Count column.
- Supplier Count is clickable when count > 0.
- Linked supplier popover shows:
  - Supplier name
  - Status
  - Last purchase period
  - Outlet usage
- Drag-and-drop sorting updates sort_order.
- Raw sort_order is not displayed.
- Delete is blocked if category has suppliers or purchase records.
- Deactivate is allowed.

---

## 5.11 Operating Expenses

Purpose:

Manage monthly operating expenses for Outlet P&L.

Data table:

```text
operating_expenses
```

Fields:

- id
- outlet_id
- year
- month
- amount
- remark
- created_by
- updated_by
- created_at
- updated_at

Unique key:

```text
outlet_id + year + month
```

Current UI:

Vertical yearly finance worksheet table.

Columns:

- Month
- Operating Expenses
- Remark
- Status

Filters:

- Outlet
- Year

No month filter.

Actions:

- Duplicate Previous Month

Removed action:

- Apply Current Value to Remaining

Status:

- Saved
- Unsaved
- Locked
- Warning

Rules:

- One total OpEx value per month.
- One optional remark per month.
- No category breakdown yet.
- Locked months are read-only.
- Abnormal highlight if month value > average * 1.5.

Future:

- Category-based OpEx
- OpEx analytics
- OpEx breakdown charts
- Margin impact analysis

---

## 5.12 Outlets

## 5.12 Duty Roster

Purpose:

Manage lightweight weekly outlet employee scheduling.

This is not a full HR, payroll, attendance, shift swap, or staff request system yet.

Data tables:

```text
shift_templates
duty_rosters
roster_periods
```

Shift template fields:

- id
- name
- code
- start_time
- end_time
- break_minutes
- shift_type
- color
- is_active
- created_at
- updated_at

Duty roster fields:

- id
- outlet_id
- employee_id
- roster_date
- shift_template_id
- start_time
- end_time
- break_minutes
- status
- remark
- created_by
- updated_by
- created_at
- updated_at

Roster period fields:

- id
- outlet_id
- week_start_date
- week_end_date
- status
- published_by
- published_at
- locked_at
- created_at
- updated_at

Status values:

- draft
- published
- locked

Default shift templates:

- Morning
- Mid
- Closing
- Full
- OFF
- AL
- MC

Main UI:

- Outlet selector
- Week selector with previous/next controls
- Department filter
- Week/Month view toggle
- Copy Week
- Export
- Publish Roster
- Lock/Unlock status action
- Weekly roster grid
- Mobile timeline view

Roster grid:

- Rows are employees.
- Columns are Monday to Sunday.
- Employees are grouped by department.
- Department group labels are visible in roster view.
- Day headers show department coverage:
  - Kitchen
  - Floor

Employee grouping:

- Use employee department first.
- Kitchen department goes under Kitchen Team.
- Service, Frontline, or Floor goes under Floor Team.
- Missing department goes under Other Team.

Shift colors:

- Morning: soft green
- Mid: soft amber
- Closing: soft red
- Full: soft blue
- OFF: grey
- AL / MC: soft purple

Right panel:

- Roster Status
- Quick Shift Templates
- Department Coverage

Weekly summary:

- Total Staff Scheduled
- Total Working Hours
- Off Days
- Annual Leave
- MC

Do not include in current version:

- Conflict warning module
- Labor cost forecast
- Staff request
- Shift swap
- Attendance link
- Payroll link
- Part-time preferred days
- Full-time weekly hour checking

Behavior:

- Draft is editable when user has create/edit permission.
- Published is visible as published roster.
- Locked is read-only.
- Publish/lock/unlock requires manage permission.
- Copy Week copies shifts from a selected source week to the current selected week.
- Copy Week can overwrite existing current-week shifts.
- Saved roster data must persist after refresh.

Audit actions:

- Create shift
- Edit shift
- Delete shift
- Copy week roster
- Publish roster
- Lock roster
- Unlock roster

Do not audit:

- Filter changes
- Search
- Modal open
- View toggle

Permissions:

- duty_roster.view
- duty_roster.create
- duty_roster.edit
- duty_roster.delete
- duty_roster.export
- duty_roster.manage

---

## 5.13 Outlets

Purpose:

Manage outlet master data.

Data table:

```text
outlets
```

Fields:

- id
- name
- code
- location
- address
- status
- is_active
- created_at
- updated_at

Rules:

- Used by sales, purchases, tax configs, operating expenses, imports, and P&L.
- Outlet codes are used for import matching.

---

## 5.14 Data Import

Purpose:

Import sales and purchase CSV/XLSX data safely.

Flow:

```text
Upload
→ Parse
→ Column Mapping
→ Validate Data
→ Preview Changes
→ Confirm Import
→ Complete
```

Sales format:

- Outlet
- Month
- Year
- Dine In
- FoodPanda
- GrabFood
- ShopeeFood
- Takeaway

Sales matching:

- Outlet by code first, then name.
- Sales channel by normalized name.

Sales conflict key:

```text
outlet_id + year + month + channel_id
```

Purchase format:

- Outlet
- Month
- Year
- Supplier
- Category
- Amount
- Remark

Purchase matching:

- Outlet by code first, then name.
- Supplier by normalized name.
- Category by normalized name.

Purchase conflict key:

```text
outlet_id + year + month + supplier_id + category_id
```

Validation:

- Invalid outlet
- Invalid month/year
- Unknown supplier
- Unknown category
- Invalid amount
- Negative amount
- Duplicate rows
- Locked month preparation

Unknown category review:

- Map to existing category
- Create new category
- Skip affected rows

Unknown supplier review:

- Map to existing supplier
- Create new supplier
- Skip affected rows

Order:

Unknown category review must happen before unknown supplier review.

Import tables:

- import_batches
- import_batch_rows

Batch status:

- pending
- validating
- completed
- partial_failed
- failed

Removed:

- Dry Run Mode

Reason:

Preview already works as safe dry-run behavior.

---

## 5.14 Data Health and Month Closing

Purpose:

Validate month completeness before closing.

Rules:

- Alerts are informational only.
- Alert lifecycle does not affect completeness.
- No reviewed/resolved/dismissed terms.
- Sales completeness passes if at least one sales record exists for outlet/month/year.
- RM0 channel values are allowed.
- Warn only if no saved sales data exists.
- Warn if net sales is zero while purchases exist.
- Sales Records count uses distinct channels.

Wording:

- `No saved sales data found for this month.`
- `Net sales is zero while purchases exist. Please review.`
- `Review critical warnings before locking this month.`
- `Operational Alerts Detected`

---

## 5.15 Alerts & Insights

Purpose:

Risk notification inbox.

Not a task workflow.

Removed lifecycle actions:

- Mark Reviewed
- Dismiss
- Resolve

Card includes:

- Severity badge
- Confidence badge
- Title
- Key metric comparison
- Short explanation
- Suggested check
- Detected period/source

Details include:

- Why alert triggered
- Rule used
- Sales value
- Purchase value
- Baseline
- Suggested investigation checklist

Empty state:

```text
No risk alerts for this period.
Operations look healthy.
```

Insufficient data:

```text
Not enough data to generate insights yet.
```

---

## 5.16 Employees

Purpose:

Manage employee profile and optional system login access.

Data table:

```text
employees
```

Fields:

- id
- auth_user_id
- full_name
- nickname
- gender
- nationality
- ic_no
- birthday
- contact
- email
- employment_status
- department
- position
- workplace
- employee_code
- joined_date
- resigned_date
- bank_name
- bank_account_number
- bank_account_name
- enable_system_login
- role_id
- access_state
- is_active
- email_verified
- verification_sent_at
- access_disabled_at
- last_login_at
- audit_summary
- created_by
- created_at
- updated_at

Employment Status:

- full_time
- part_time
- resigned

Access State:

- no_access
- not_sent
- invited
- active
- disabled

Labels:

- no_access: No Access
- not_sent: Not Sent
- invited: Invitation Pending
- active: Active
- disabled: Disabled

Rules:

- System access state is generated, not manually selected.
- Enable System Login OFF means no_access.
- Enable System Login ON with no setup email means not_sent.
- Send Login Setup changes state to invited.
- Successful password setup changes state to active.
- Disabled access changes state to disabled.

Employee form sections:

- Personal Info
- Employment Info
- Bank Info
- System Access

Identity rules:

- Full Name is legal/HR name.
- Nickname is friendly/internal display name.
- Future display name rule:

```text
display_name = nickname || full_name
```

Malaysia IC format:

```text
123456-08-1234
```

Malaysia contact format:

```text
60-123456789
```

---

## 5.17 Job Positions

Purpose:

Manage HR job titles used in employee profiles.

Data table:

```text
job_positions
```

Fields:

- id
- name
- department
- description
- status
- created_at
- updated_at

Rules:

- Job Position is not Role.
- Job Position is not system-protected.
- Owner position is not protected here.
- All positions can be deleted if active_employee_count = 0.
- If active_employee_count > 0, prevent delete.

Delete message:

```text
This position is assigned to employees. Reassign employees before deleting.
```

Modal behavior:

- One shared modal.
- View mode: Close + Edit Position.
- Edit mode: Cancel + Save Position.
- Cancel returns to view mode.
- X closes entire modal.
- No stacked modal layers.

Audit info:

- Create mode does not show fake audit values.
- Display: `Audit info available after first save.`
- Existing records show real values when available or `—`.

---

## 5.18 Departments

Purpose:

Organize job positions and employees.

Data table:

```text
departments
```

Fields:

- id
- name
- description
- status
- created_at
- updated_at

Table columns:

- Department
- Active Positions
- Active Users
- Status
- Actions

Removed for MVP:

- Used In Modules
- HR/KPI/Payroll/Attendance tags

Future TODO:

Reintroduce module dependency mapping when HR/KPI/Payroll modules are implemented.

---

## 5.19 Roles

Purpose:

Manage system access roles.

Data table:

```text
roles
```

Fields:

- id
- name
- description
- is_system_role
- is_active
- created_at

Related tables:

- permissions
- role_permissions
- role_outlets

Protected roles:

- owner
- admin

Rules:

- owner/admin cannot be deleted.
- owner/admin permissions are protected.
- owner/admin automatically pass all permission checks, including future module permissions.
- All other roles are editable, deletable, and configurable.

Role Catalog columns:

- Role
- Description
- Outlet Access
- Assigned Employees
- Accessible Modules
- Last Updated
- Actions

Removed role concepts:

- System Default role logic
- Type: System / Custom
- Privilege Level
- Role hierarchy UI

Outlet Access:

- All Outlets
- Selected Outlets

Display:

- Actual outlet chips for selected outlets.
- Do not show `Company-wide`, `Assigned outlets`, or `User-level`.

Permission UI:

- Wide permission matrix.
- Rows follow actual sidebar features.
- Columns follow available actions.

---

## 5.20 Audit Logs

Purpose:

Professional management/security audit center.

Data table:

```text
audit_logs
```

Fields:

- id
- action
- module
- user_id
- user_name
- description
- metadata
- created_at

Audit record structure:

```json
{
  "actor": "...",
  "action": "...",
  "module": "...",
  "target": "...",
  "outlet": "...",
  "before": {},
  "after": {},
  "timestamp": "...",
  "ip": "...",
  "device": "..."
}
```

Track only:

- Security-sensitive actions
- Permission-sensitive actions
- Data-changing actions
- Business-critical actions

Do not track:

- Page views
- Dropdown clicks
- Tab switching
- Searches
- Modal opens
- Passive navigation

UI:

- KPI cards:
  - Security Events
  - Access Changes
  - Data Changes
  - Control Events
- Activity timeline
- Severity badge
- User avatar initials
- Outlet name resolution
- Friendly timestamps
- Detail drawer

Outlet display rules:

- If audit record contains outlet_id, resolve outlet name.
- If outlet missing/deleted, show `Unknown Outlet`.
- Only true global/system actions show `System-wide`.

---

## 6. RBAC Permission Matrix

Permission format:

```text
module.action
```

### Overview

Outlet P&L:

- outlet_pnl.view
- outlet_pnl.export

Dashboard:

- dashboard.view

Sales Comparison:

- sales_comparison.view
- sales_comparison.export

Purchase Comparison:

- purchase_comparison.view
- purchase_comparison.export

Alerts & Insights:

- alerts.view
- alerts.manage

### Sales

Sales Input:

- sales_input.view
- sales_input.create
- sales_input.edit
- sales_input.delete

Sales Channels:

- sales_channels.view
- sales_channels.create
- sales_channels.edit
- sales_channels.delete

Tax Settings:

- tax_settings.view
- tax_settings.edit

### Purchases

Purchase Input:

- purchase_input.view
- purchase_input.create
- purchase_input.edit
- purchase_input.delete
- purchase_input.approve

Suppliers:

- suppliers.view
- suppliers.create
- suppliers.edit
- suppliers.delete

Purchase Categories:

- purchase_categories.view
- purchase_categories.create
- purchase_categories.edit
- purchase_categories.delete

### Operations

Operating Expenses:

- operating_expenses.view
- operating_expenses.create
- operating_expenses.edit
- operating_expenses.delete

Duty Roster:

- duty_roster.view
- duty_roster.create
- duty_roster.edit
- duty_roster.delete
- duty_roster.export
- duty_roster.manage

Outlets:

- outlets.view
- outlets.create
- outlets.edit
- outlets.delete

Data Import:

- data_import.view
- data_import.import

Data Health:

- data_health.view

### People

Employees:

- employees.view
- employees.create
- employees.edit
- employees.deactivate
- employees.enable_login
- employees.reset_password

Job Positions:

- job_positions.view
- job_positions.create
- job_positions.edit
- job_positions.delete

Departments:

- departments.view
- departments.create
- departments.edit
- departments.delete

### System

Roles:

- roles.view
- roles.create
- roles.edit
- roles.delete

Audit Logs:

- audit_logs.view
- audit_logs.export

---

## 7. RBAC Rules

Core flow:

```text
Supabase Auth session
→ Employee profile
→ role_id
→ role_permissions
→ role_outlets
→ sidebar/routes/actions/RLS
```

Rules:

- No profile means no access.
- RBAC load failure fails closed.
- No automatic full permissions fallback for normal roles.
- Protected roles (`owner`, `admin`) bypass permission checks and always return true.
- Sidebar visibility follows view permission.
- Add button follows create permission.
- Edit/save follows edit permission.
- Delete follows delete permission.
- Import follows import permission.
- Export follows export permission.
- Before every write, client checks permission.
- RLS remains final backend protection.

Dependency rules:

- create requires view
- edit requires view
- delete requires view
- approve requires view
- export requires view
- import requires view
- manage requires view
- enable_login requires view
- reset_password requires view

---

## 8. Supabase Auth and Employee Onboarding

Authentication:

- Real Supabase Auth sessions only.
- No development auth bypass.
- No temporary password flow.

Edge Function:

```text
supabase/functions/employee-auth-onboarding
```

Environment variables:

- PROJECT_URL
- PROJECT_SERVICE_ROLE_KEY
- SUPABASE_ANON_KEY
- FEEDX_SITE_URL or SITE_URL or PUBLIC_SITE_URL

Responsibilities:

- Verify caller permission.
- Load employee.
- Validate email and role.
- Invite/create Supabase Auth user.
- Send login setup email.
- Generate manual setup link if email sending unavailable.
- Link `employees.auth_user_id`.
- Set `access_state = invited`.
- Write audit log.

Success response:

```json
{
  "ok": true,
  "mode": "email",
  "message": "Login setup email sent.",
  "employeeId": "...",
  "accessState": "invited"
}
```

SMTP not configured:

```json
{
  "ok": false,
  "code": "SMTP_NOT_CONFIGURED",
  "message": "Email sending is not configured.",
  "canGenerateManualLink": true
}
```

Password recovery:

- Detect recovery callback tokens.
- Establish session from URL.
- Show Set New Password screen.
- Call `supabase.auth.updateUser({ password })`.
- Clear tokens.
- Refresh profile.
- Redirect to app/login.

---

## 9. Database Tables

Core production tables:

- outlets
- sales_channels
- sales_records
- outlet_tax_configs
- suppliers
- purchase_categories
- purchase_records
- operating_expenses
- employees
- departments
- job_positions
- roles
- permissions
- role_permissions
- role_outlets
- audit_logs
- import_batches
- import_batch_rows

Legacy/compatibility:

- user_profiles may exist from earlier migrations, but employee-first architecture is current source of truth.

---

## 10. Migration Architecture

Migrations must be runnable from an empty Supabase staging database.

Important baseline:

```text
supabase/migrations/202605110001_core_dependency_baseline.sql
```

Purpose:

Create minimal dependency tables before early RBAC migrations reference them.

Baseline tables:

- outlets
- sales_channels
- purchase_categories
- suppliers

Rule:

Baseline migrations must be non-destructive. Later migrations add full fields, indexes, grants, RLS policies, and seed data.

---

## 11. RLS Policy Direction

Owner/admin:

- Full access through role permissions.

Master data reads:

Should allow users with related view permissions.

Examples:

- outlets readable by outlets.view or dashboard.view where needed.
- suppliers readable by suppliers.view, purchase_input.view, purchase_comparison.view, data_import.view where needed.
- sales_channels readable by sales_channels.view, sales_input.view, sales_comparison.view, data_import.view where needed.
- outlet_tax_configs readable by tax_settings.view, sales_input.view, dashboard.view where needed.

Transaction records:

Sales records:

- SELECT: sales_input.view OR sales_comparison.view OR dashboard.view
- INSERT: sales_input.create OR data_import.import
- UPDATE: sales_input.edit OR data_import.import
- DELETE: sales_input.delete OR data_import.import

Purchase records:

- SELECT: purchase_input.view OR purchase_comparison.view OR dashboard.view
- INSERT: purchase_input.create OR data_import.import
- UPDATE: purchase_input.edit OR data_import.import
- DELETE: purchase_input.delete OR data_import.import

---

## 12. Business Workflows

### 12.1 Monthly Sales Save

```text
Select outlet/month/year
→ Load sales records
→ Edit channel amounts
→ Save
→ Upsert by outlet/year/month/channel
→ Audit log
→ Dashboard, comparison, P&L update
```

### 12.2 Monthly Purchase Save

```text
Select outlet/month/year
→ Load purchase records
→ Select supplier/category
→ Edit amount
→ Save
→ Upsert by outlet/year/month/supplier/category
→ Audit log
```

### 12.3 SST Configuration

```text
Select outlet
→ Add SST config
→ Choose enabled/disabled
→ Set rate
→ Set effective month
→ System creates effective-date config
→ Previous current config auto-closes if needed
→ Historical months remain unchanged
```

### 12.4 Employee Login Setup

```text
Create employee
→ Enable System Login
→ Add email
→ Assign role
→ Send Login Setup Email
→ Edge Function sends setup email
→ Employee sets password
→ access_state becomes active
```

### 12.5 Data Import

```text
Upload file
→ Parse rows
→ Map columns
→ Validate values
→ Resolve unknown categories
→ Resolve unknown suppliers
→ Preview create/update/failed rows
→ Confirm import
→ Batch upsert
→ Audit log
```

### 12.6 Duty Roster Weekly Scheduling

```text
Select outlet and week
→ Load active employees
→ Group employees by department
→ Empty cells show + Add Shift on hover
→ Click empty cell to open Add Shift modal
→ Or select a Quick Shift Template to enter assignment mode
→ Click roster cell to instantly assign selected template
→ Save shift to duty_rosters
→ Review Kitchen/Floor coverage by day
→ Publish roster when ready
→ Lock roster when finalized
→ Audit critical roster actions
```

---

## 13. UI and Terminology Rules

Do not show technical terms in user-facing UI:

- Supabase
- RLS
- upsert
- schema
- UUID
- API
- payload
- migration
- database
- query
- sync
- policy

Use business-friendly wording:

- Validate Data
- Import records
- Duplicate records
- Saved
- Unable to load data
- Unable to save
- Contact admin

Design direction:

- Modern SaaS
- Enterprise management dashboard
- Green operations-tech theme
- Light and dark mode support
- Professional, not cyberpunk

---

## 14. Technical Stack

Frontend:

- React
- Vite
- Tailwind CSS
- Recharts
- lucide-react

Backend/data:

- Supabase
- PostgreSQL
- Supabase Auth
- Supabase Edge Functions
- RLS

Architecture:

- Domain service layer
- Central module registry
- RBAC helpers
- Supabase source-of-truth for production data
- Edge Function for privileged auth onboarding

---

## 15. Service Layer

Current/planned services:

- outletService
- salesChannelService
- salesRecordService
- outletTaxConfigService
- supplierService
- purchaseCategoryService
- purchaseRecordService
- operatingExpenseService
- employeeService
- departmentService
- jobPositionService
- roleService
- auditLogService
- importService
- employeeAuthOnboardingService

Service rules:

- Throw detailed internal errors for console debugging.
- Show clean business messages in UI.
- Never silently fail writes.
- Refresh persistence must survive page reload.

---

## 16. Development Plan

### Phase A: Production Data Stability

- Verify fresh staging migration from empty database.
- Verify all production tables exist.
- Verify owner/admin permissions.
- Verify non-owner role permissions.
- Verify RLS for all modules.
- Ensure no data-loading module is blocked by unrelated module failure.

### Phase B: Auth and RBAC Hardening

- Complete Supabase Auth onboarding QA.
- Confirm SMTP or manual setup link flow.
- Confirm employee profile resolves by auth_user_id first, then email fallback.
- Confirm all UI actions are permission-gated.
- Confirm all write services have client-side permission guards.

### Phase C: Import Engine Completion

- Complete Sales Import QA.
- Complete Purchase Import QA.
- Verify unknown supplier/category combined flow.
- Add downloadable import report UI.
- Add rollback UI where safe.
- Verify import batch status and row details.

### Phase D: Financial Intelligence Expansion

- Finalize Outlet P&L export.
- Add monthly P&L detail modal.
- Add OpEx category breakdown.
- Add management summary export.
- Add profit trend commentary.

### Phase E: Operations Controls

- Persist month lock state.
- Add month lock permissions if needed.
- Improve Data Health drilldown.
- Improve Alerts rule library.

### Phase F: People and Governance

- Add employee audit detail.
- Add employee self-profile view.
- Add password change polish.
- Add role assigned employee drawer enhancements.
- Add audit filtering/export improvements.

### Phase G: Future Modules

- HR
- Attendance
- Payroll
- Staff KPI
- Purchase approvals
- Inventory control
- Budget control
- Multi-company support

---

## 17. Current Known Risks

- Some legacy migrations still include old user profile concepts.
- Fresh staging migration order must be continuously verified.
- Large frontend bundle warning exists in Vite build.
- Some export actions are placeholders.
- Some audit metadata may lack created_by/updated_by names.
- SMTP configuration is required for production email onboarding.
- Manual setup link is an admin-safe fallback, not long-term default.

---

## 18. Acceptance Checklist for Future Changes

Every new module or feature must answer:

- Is it registered in `config/modules.ts`?
- Does it have RBAC permissions?
- Is sidebar visibility permission-based?
- Are action buttons permission-gated?
- Are Supabase tables/migrations idempotent?
- Are RLS policies aligned with permission codes?
- Are user-facing messages free of backend terms?
- Are audit logs added only for business-critical actions?
- Does refresh preserve created/edited records?
- Does `npm run build` pass?
- Is this document updated?
