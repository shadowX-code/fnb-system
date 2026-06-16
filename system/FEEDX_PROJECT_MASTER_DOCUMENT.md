# FeedX Project Master Document

Last updated: 2026-06-04
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
- Dashboard
- Outlet P&L
- S&P Dashboard
- Product Analytics
- Sales Comparison
- Purchase Comparison
- Alerts & Insights
- Outlet Duty Roster

SALES
- Sales Input
- Sales Channels
- Tax Settings

PURCHASES
- Purchase Input
- Suppliers
- Supplier Categories

OPERATIONS
- Operating Expenses
- Duty Roster
- Asset Tracking
- Outlets
- Data Health

INVENTORY CONTROL
- Dashboard
- Master Inventory
- Par Levels
- Stock Check Groups
- Stock Check
- Purchase Orders
- Inventory Movements
- Wastage
- Recipes & Usage

PEOPLE
- Employees
- Job Positions
- Departments
- Roles & Permissions

SYSTEM
- Audit Logs
```

FeedX supports workspace-level navigation. The Restaurant workspace remains the default active workspace. The Factory workspace is a separate operational workspace for factory production, raw material warehouse operations, finished goods movement, factory recipes and SOPs. The workspace switcher changes sidebar modules only; it does not change authenticated user, company, Supabase project, or permission model.

Factory workspace sidebar structure:

```text
FACTORY
- Factory Dashboard
- Job Orders
- Production Records
- Production Reports

WAREHOUSE
- Finished Goods
- Product Movements
- Product Stock Check

RAW MATERIAL
- Raw Material Receiving
- Raw Material Inventory
- Raw Material Stock Check

MASTER DATA
- Product Recipes
- Production SOP

SYSTEM
- Factory Audit Logs
- Factory Settings
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
  workspace?: "restaurant" | "factory",
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

Current registry architecture:

- Overview modules use section `OVERVIEW`.
- Sales modules use section `SALES`.
- Purchases modules use section `PURCHASES`.
- Operations modules use section `OPERATIONS`.
- Inventory Control modules use section `INVENTORY_CONTROL`.
- People modules use section `PEOPLE`.
- System modules use section `SYSTEM`.

Inventory Control registry entries:

```text
inventory_dashboard     INVENTORY_CONTROL   Dashboard              #inventory_dashboard
inventory_master        INVENTORY_CONTROL   Master Inventory       #inventory_master
inventory_categories    INVENTORY_CONTROL   Inventory Categories   internal only, sidebar false
inventory_uoms          INVENTORY_CONTROL   Inventory UOMs         internal only, sidebar false
inventory_par_levels    INVENTORY_CONTROL   Par Levels             #inventory_par_levels
inventory_groups        INVENTORY_CONTROL   Stock Check Groups     #inventory_groups
inventory_stock_check   INVENTORY_CONTROL   Stock Check            #inventory_stock_check
inventory_orders        INVENTORY_CONTROL   Purchase Orders        #inventory_orders
inventory_movements     INVENTORY_CONTROL   Inventory Movements    #inventory_movements
inventory_waste         INVENTORY_CONTROL   Wastage                #inventory_waste
inventory_recipes       INVENTORY_CONTROL   Recipes & Usage        #inventory_recipes
recipe_intelligence     INVENTORY_CONTROL   Recipe Intelligence    #recipe_intelligence
```

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
- Protected roles cannot be edited by custom roles. Owner/admin can manage role records as protected administrators.

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

## 5.2 Dashboard

Purpose:

Monthly HQ management overview workspace for owners/admins to review business health, outlet issues, alerts, pending actions, product signals, and operational risks.

Sidebar label:

```text
Dashboard
```

Data:

- Sales records
- Purchase records
- Sales channels
- Supplier categories
- Suppliers
- Product sales reports
- Asset items
- Asset inspections
- Asset maintenance records
- Duty roster records

Core rules:

- Dashboard is month-based only.
- Dashboard is separate from S&P Dashboard and must not replace the detailed sales/purchase analytics workspace.
- Do not show daily, hourly, real-time POS, or last-7-days metrics.
- Outlet scope supports All Outlets and individual accessible outlets.
- Every outlet-specific alert, product signal, and action must show outlet identity.
- Missing data shows helpful empty states instead of misleading zeros.
- The dashboard greeting uses browser local time: 05:00-11:59 "Good morning", 12:00-17:59 "Good afternoon", 18:00-22:59 "Good evening", and 23:00-04:59 "Welcome back".
- Dashboard greeting personalization uses `employees.nickname` first, then `employees.full_name`; if the employee profile is unavailable, it shows the greeting without a name.

Dashboard sections:

- Header greeting with outlet scope, month selector, last updated timestamp, notification icon, and user avatar.
- Executive KPI cards: MTD Sales, MTD Purchase, Avg. COGS %, Estimated Gross Profit, Active Alerts.
- Outlet Health table: outlet, MTD sales, COGS %, vs last month, alerts, staffing, assets, status.
- Smart Alerts panel with top outlet-tagged monthly alerts.
- Monthly Trend chart using last 6 monthly totals.
- Operational Snapshot for draft audits, maintenance due, low quantity assets, missing stock items, unresolved alerts, duty roster issues.
- Pending Actions linking to the relevant module.
- Top Product Signals using monthly Product Analytics uploads.
- Business Pulse summary across the selected outlet scope.

Chart rules:

- Use last six uploaded/entered monthly periods.
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

## 5.2A S&P Dashboard

Purpose:

Detailed sales and purchase operational analytics dashboard.

Sidebar label:

```text
S&P Dashboard
```

Route:

```text
/sp-dashboard
```

Permission:

```text
dashboard.view
```

Rules:

- S&P Dashboard must remain separate from Dashboard.
- It preserves the original detailed sales and purchase analytics logic.
- It shows sales vs purchase trend, COGS margin trend, top suppliers by purchase, and recent rule-based alerts.
- Dashboard is the HQ command center; S&P Dashboard is the operational sales and purchase analytics workspace.

---

## 5.3 Product Analytics

Purpose:

Upload monthly POS product sales reports and generate product performance analytics for management.

Year selector rule:

- Reporting year selectors must be data-driven, not fixed lists. Product Analytics uses distinct `report_year` values from uploaded Product Analytics reports, Sales Comparison uses distinct Sales record years, Purchase Comparison uses distinct Purchase record years, and Recipe Intelligence uses Product Analytics report years.
- Year options merge historical data years with Current Year and Current Year + 1, then sort ascending. If no historical data exists, show Current Year - 1, Current Year, and Current Year + 1.
- The same year-option strategy applies to Product Analytics upload/report filters, Sales Comparison, Purchase Comparison, and Recipe Intelligence trend/report selectors.

Route:

```text
Overview > Product Analytics
```

Module registry:

```text
id: product_analytics
section: Overview
route: /product-analytics
```

Permissions:

- product_analytics.view
- product_analytics.upload
- product_analytics.export
- product_analytics.manage

Data tables:

```text
product_sales_reports
product_sales_items
```

Product sales report fields:

- id
- outlet_id
- report_month
- report_year
- file_name
- uploaded_by
- uploaded_at
- status
- total_net_sales
- total_quantity
- total_discount
- raw_metadata

Product sales item fields:

- id
- report_id
- outlet_id
- category_name
- product_name
- variant_name
- quantity
- gross_sales
- discount
- sst
- service_charge
- nett_sales
- created_at

Upload rules:

- Upload requires outlet, month, year, and report file.
- CSV and standard XLSX reports use flexible column detection.
- Product Name, Quantity, and Nett Sales are hard-required.
- Category is optional and defaults to `Uncategorized`.
- Variant, Gross Sales, Discount, SST, and Service Charge are optional.
- Gross Sales defaults to Nett Sales + Discount when possible, otherwise 0.
- Parser scans the first 20 rows to detect the actual table header for POS exports with title rows.
- FeedMe Product Sales format is supported. The parser detects headers such as Category, Name, Variant, Code, Qty, Gross, Bill discount, Item discount, SST, SC, and Nett.
- FeedMe metadata rows are preserved in report metadata when present: merchant, report date range, time range, and generated time.
- FeedMe reports may have metadata rows before the product table; the parser scans the first 20 rows to find the actual header row.
- Product Code is detected from Code when provided and retained in parser mapping metadata for future reporting use.
- FeedMe discount import combines Bill discount and Item discount into total Discount.
- Total summary rows and category subtotal rows without a product name are skipped.
- Upload modal shows a detected column mapping preview before import.
- Parser errors are shown inside the upload modal and must not crash the page.
- Duplicate report detection uses outlet, month, and year.
- Replacing a report removes the previous report items and imports the new report.
- Upload history is retained through product sales report records.
- Upload History is outlet-scoped. All Outlets shows reports from accessible outlets only; a selected outlet shows that outlet's reports.
- Upload success shows a business summary with products imported, net sales analyzed, data quality, and skipped-row count when applicable.

Dashboard sections:

- KPI cards: Total Net Sales, Total Quantity Sold, Average Spend / Item, Best Selling Product, Lowest Performer, Discount Given, Top Category, Menu Items Sold.
- Empty state shows text guidance only; the Upload Report action remains in the page header.
- Dashboard analytics aggregate by Product Name and Category by default. Variant rows remain stored in raw uploaded data but do not split the main analytics view.
- Product normalization trims spaces, collapses repeated spaces, and compares product names case-insensitively while preserving the first display name.
- Top 10 Best Selling Products with Net Sales / Quantity toggle and View All Products table. Product rows show variant count when variants exist.
- Full Product Performance Table includes search, category filter, sorting, pagination, contribution, average selling price, status tags, and a View Mode toggle for Product Summary or Variant Detail.
- Product detail modal shows total product summary and a variant breakdown table.
- Category Contribution uses a modern ranked contribution card with category bars and a compact mix visual.
- Product Performance Matrix uses Revenue Contribution and Sales Velocity, average guide lines, quadrant colors, category chips, and suggested action tooltips.
- Dead Menu / Low Performers uses aggregated product quantity by default and includes quantity/uploaded-month filters plus suggested action guidance.
- Monthly Trend tracks aggregated product names across uploaded months. If only one month exists, the page asks users to upload more monthly reports.
- Rule-based insights use the labels Insight, Opportunity, Warning, and Recommendation.

RBAC and outlet scope:

- View page requires product_analytics.view.
- Upload Report requires product_analytics.upload.
- Export requires product_analytics.export.
- Upload History delete/manage actions require product_analytics.manage.
- Owner/admin can view all outlets.
- Custom roles only see reports for outlets assigned through role outlet scope.

Current status:

- CSV upload is implemented.
- Standard XLSX worksheet upload is implemented through the browser parser path.

---

## 5.4 Sales Input

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

## 5.10 Supplier Categories

Purpose:

Manage supplier category master data.

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

Manage lightweight outlet employee scheduling in the Operations workspace.

This is not a full HR, payroll, attendance, shift swap, or staff request system yet.

Operations Duty Roster is the scheduling and editing workspace:

- Weekly and monthly employee-by-date roster grid.
- Click empty cells to add shifts.
- Click existing shift blocks to edit or delete.
- Quick shift assignment mode.
- Bulk assign for one employee across multiple dates.
- Publish, lock and unlock workflows.

Outlet Duty Roster is a separate Overview module for read-focused monthly management review.

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
- sort_order
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
- employee_name_snapshot
- position_snapshot
- department_snapshot
- outlet_snapshot
- shift_snapshot
- publish_timestamp
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
- Export
- Publish Roster
- Lock/Unlock status action
- Weekly roster grid
- Mobile timeline view

Roster grid:

- Rows are employees.
- Columns are Monday to Sunday.
- Employees are grouped by roster position group.
- Group labels are visible in roster view:
  - Floor
  - Kitchen
  - Other

Employee grouping:

- Admin maps job positions to Floor or Kitchen in Duty Roster Settings.
- A position can only belong to one roster group.
- Positions not mapped to Floor or Kitchen appear under Other.
- If an employee has no matched position, department fallback may be used only as a last resort.

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
- Publishing a roster updates both the weekly roster period and all affected duty_rosters rows.
- Publishing a roster snapshots the scheduled employee and shift display details into each published `duty_rosters` row: employee name, position, department, outlet, shift template/time, and publish timestamp.
- Published and locked roster history must render from snapshots or saved roster rows, not only from the current active employee list.
- Published roster history remains viewable after an employee later becomes resigned or terminated.
- Draft roster scheduling continues to use current active outlet employees only; resigned and terminated employees must not appear for new scheduling.
- Future employee master data changes must not alter historical published roster snapshots.
- Editing or deleting shifts in a published week returns that week and its affected duty_rosters rows to Draft until republished.
- Copying into a published week returns that week to Draft because copied shifts must be reviewed and republished before they become historical snapshots.
- Monthly overview status badges derive from actual duty_rosters row status first, not stale local UI state.
- Saved roster data must persist after refresh.

Audit actions:

- Create shift
- Edit shift
- Delete shift
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

## 5.13 Asset Tracking

### FeedX Image Upload Standard

- Image upload controls across Employees, Recipes, Master Inventory, Asset Tracking, Asset Inspection, Stock Check, Waste Records, and Purchase Receiving must accept only JPG/JPEG, PNG, and WebP images.
- Maximum source file size is 5MB. Files above 5MB are rejected before upload with `Image exceeds 5MB limit.`
- Accepted images are optimized client-side before Supabase Storage upload: longest side max 1920px, original aspect ratio preserved, WebP output quality approximately 80%, and only the optimized file is stored. Target stored image size is roughly 0.5MB-2MB depending on source content.
- Replacing an existing stored image should remove the old Supabase Storage object when the old public URL belongs to the same bucket and is no longer referenced by the updated record.
- Current storage buckets: Inventory item, Recipe, and Waste evidence photos use `inventory-item-photos`; Asset, Maintenance, and Asset Inspection evidence photos use `asset-photos`.

Purpose:

Track outlet assets, quantities, categories, inspections, and movement logs.

Core rules:

- Each outlet has its own asset list.
- Every asset belongs to a category.
- Every quantity change must create a movement log.
- Quantity reduction cannot make quantity below 0.
- Reduce requires a reason.
- If reduce reason is Other, remark is required.
- Asset categories cannot be hard deleted when linked to assets; archive/deactivate instead.
- Inspection compares expected system quantity with actual counted quantity.
- Inspection can run for all categories, selected categories, or a manually adjusted checklist.
- Asset condition and asset status are separate systems.
- Maintenance is optional and is enabled by category, with an asset-level override.

Permissions:

- asset_tracking.view
- asset_tracking.create
- asset_tracking.edit
- asset_tracking.delete
- asset_tracking.manage
- asset_tracking.export

RBAC:

- Sidebar follows asset_tracking.view.
- Add asset/category follows asset_tracking.create.
- Edit follows asset_tracking.edit.
- Archive/delete follows asset_tracking.delete.
- Adjust quantity and inspection follows asset_tracking.manage.
- Export follows asset_tracking.export.

Data tables:

```text
asset_categories
asset_items
asset_movement_logs
asset_inspections
asset_inspection_items
asset_maintenance_records
```

Asset category fields:

- id
- name
- description
- sort_order
- is_active
- maintenance_enabled
- created_at
- updated_at

Category purpose:

- Categories classify assets only.
- Categories do not manage condition templates, inspection rules, or automation rules in Phase 1.
- Category configuration uses a split layout with a left category list and right detail panel.
- Category detail includes name, description, active or archived state, linked asset count, and maintenance setting.
- Manual Sort Order input is not shown. Sort order is managed by drag-and-drop in the category list and persisted to `sort_order`.
- Categories cannot be hard deleted when linked to assets; use Archive Category.
- `maintenance_enabled` controls whether assets under the category expose maintenance workflows by default.
- Consumable or replacement categories such as bowls, spoons, trays, and utensils normally keep only quantity, inspection, condition, and movement logs.
- Maintainable categories such as coffee machines, refrigerators, POS hardware, aircond, and kitchen electrical equipment can expose maintenance history, repair logs, vendor tracking, and service dates.

Asset item fields:

- id
- outlet_id
- category_id
- asset_code
- name
- description
- location
- purchase_date
- warranty_expiry
- notes
- image_url
- thumbnail_url
- unit
- current_quantity
- minimum_quantity
- health_status
- last_inspection_at
- condition
- maintenance_override
- status
- remark
- created_by
- updated_by
- created_at
- updated_at

Asset Condition:

Purpose:

Represents the current operational state of the asset. This is what operations teams monitor day to day.

User-facing values:

- Good
- Needs Attention
- Under Maintenance
- Low Quantity
- Damaged
- Missing
- Disposed

Internal values:

- healthy
- needs_attention
- under_maintenance
- low_quantity
- damaged
- missing
- disposed

Condition definitions:

- Good: asset is usable with no active operational issue.
- Needs Attention: minor issue detected and requires review or follow-up.
- Under Maintenance: asset is currently under repair or service.
- Low Quantity: quantity is below preferred operational level.
- Damaged: physical damage detected.
- Missing: asset or stock item cannot be located.
- Disposed: asset was written off or discarded; historical records remain.

Color system:

- Good: green
- Needs Attention: amber
- Under Maintenance: blue
- Low Quantity: orange
- Damaged: red
- Missing: dark red
- Disposed: gray

Asset Status:

Purpose:

Represents the lifecycle state of the asset record in the system.

User-facing values:

- Active
- Archived

Internal values:

- active
- archived

Status definitions:

- Active: visible in operational workflows, inspections, dashboards, and movement tracking.
- Archived: hidden from daily operations while historical records remain available.

Important rule:

Condition is not Status.

Example:

```text
Condition = Disposed
Status = Active
```

This means the asset was operationally disposed, but its record remains accessible for historical review.

Dashboard counting rules:

- Operational dashboards track Needs Attention, Under Maintenance, Low Quantity, Damaged, and Missing.
- Disposed assets are excluded from active operational issue counts unless explicitly filtered.
- Archived assets are excluded from operational dashboards and active workflows.

Asset UI rules:

- Asset photos are shown as thumbnails inside the Asset Name column and larger previews inside the Asset Profile drawer.
- Asset photos are uploaded to Supabase Storage bucket `asset-photos`; the public URL is saved in `asset_items.image_url` and reused as `thumbnail_url`.
- Asset thumbnails in the list and Asset Profile can be clicked to open an image preview.
- If no photo exists, show a category-based visual placeholder instead of an empty or broken image.
- User-facing asset state is shown as Condition, not Status.
- Quantity display shows the numeric quantity and unit without duplicating condition wording.
- Asset List groups rows by category by default, with collapsible category headers showing asset count and attention count.
- Asset List does not show a separate Unit column; unit is displayed inside Current Quantity.
- Condition badges in Asset List are directly editable with a small popover and immediate save.
- Row action menus and condition popovers must render through a portal/floating layer above the table so they are not clipped by card overflow.
- Table hover states must not change row height, scale rows, or shift layout. Allowed hover effects are subtle background, shadow, glow, and action fade-in.
- Condition dropdown remains the primary condition filter.
- Quick filter chips only contain operational shortcuts not covered by Condition:
  - Scheduled Maintenance
  - Maintenance Due
  - Recently Inspected
  - High Variance
  - No Photo
- Last Movement shows the latest movement summary, such as `Asset Imported`, `Asset Added`, `Quantity Adjusted · -2`, `Inspection Completed`, or `Maintenance Completed`.
- Asset Recent Activity is sourced from Supabase-backed asset rows, movement logs, inspections, and maintenance records; mock/demo activity must not be shown in the authenticated app.
- Asset activity labels must map from the actual event source: import movement rows with `reason = import` show `Asset Imported`, inspection rows show `Inspection Completed`, add/reduce movement rows show `Quantity Adjusted`, and maintenance rows show `Maintenance Scheduled` or `Maintenance Completed`.
- Asset activity timestamps use persisted operation timestamps such as `created_at`, `updated_at`, or `completed_date`; date-only business fields such as `movement_date` must not be used as the timeline timestamp when an operation timestamp is available.
- Asset activity cards show the actor label such as `Created by`, `Imported by`, `Inspected by`, `Adjusted by`, `Scheduled by`, or `Completed by` when the user can be resolved.
- Operational records display actual dates such as `28 May 2026`; relative wording may appear only as tooltip/helper text.
- Operational status strip summarizes attention count, low quantity alerts, and latest inspection state.
- Asset list actions use a primary View action plus an overflow menu.
- Detailed actions such as Adjust Quantity, Start Inspection, Edit Asset, Archive, and Add Maintenance Record live in the overflow menu or Asset Profile workflow.

Asset import rules:

- Asset Tracking supports CSV and XLSX import from the Asset Tracking page header.
- Import required columns are `Asset Name`, `Outlet Code`, `Category`, and `Quantity`.
- Optional import columns are `Asset Code`, `Description`, `Condition`, `Minimum Quantity`, `Location`, `Purchase Date`, `Warranty Expiry`, `Status`, `Photo URL`, and `Notes`.
- Import validates outlet codes against outlets accessible to the current user and validates categories against existing asset categories.
- Import never auto-creates outlets or asset categories.
- Primary upsert matching is `Asset Code + Outlet`; fallback matching is normalized `Asset Name + Outlet`.
- Valid import rows persist through the same Supabase-backed asset save path as Add/Edit Asset.
- Import writes `asset_items` and, when the movement log table is available, records created/updated rows as an import correction entry in `asset_movement_logs`.
- Invalid rows remain in preview as errors and are not imported; valid rows may be imported while invalid rows are skipped.
- Add Maintenance Record appears only when maintenance is allowed for that asset.
- Asset Profile hides the Maintenance tab entirely when maintenance is not allowed.
- Asset Profile shows maintenance scope as Enabled or Not required based on category setting and asset override.
- Maintainable assets show Add Maintenance Record in row actions and inside the Maintenance History tab.
- Non-maintainable assets never show maintenance actions, tabs, or empty states.
- Asset Profile is a read-first operational drawer, not an edit modal.
- Asset Profile View drawer does not show Adjust Quantity, Start Inspection, or Edit Asset as primary header buttons.
- Asset Profile header shows asset photo, asset name, category, asset ID, outlet, condition badge, and close button.
- Asset Profile tabs are visually isolated from compact operational metadata pills.
- Asset Profile metadata pills include last inspected, active maintenance, critical alerts, and next service state when applicable.
- Asset Profile Overview includes operational summary, latest inspection snapshot, recent activity, quantity, condition, outlet, last checked, and last movement.

Asset Operations Summary:

- Summary counts are calculated from the base scoped asset list only.
- Base scope includes selected outlet, selected category, search text, and active asset visibility.
- Base scope must not include the active summary filter or condition shortcut filter.
- Clicking an Asset Operations Summary card filters only the Asset List.
- Summary counts must remain unchanged while a summary filter is active.
- The active summary filter is highlighted and a Clear Filter action is shown.

Final Asset Operations Summary cards:

- Scheduled Maintenance
- Under Maintenance
- Needs Attention
- Low Quantity
- Missing Asset
- Disposed
- Recently Inspected

Recommended calculation structure:

```ts
const baseScopedAssets = assets.filter(outletCategorySearchAndStatusFilters)
const summaryCounts = buildAssetSummaryCounts(baseScopedAssets)
const displayedAssets = activeSummaryFilter
  ? applySummaryFilter(baseScopedAssets, activeSummaryFilter)
  : baseScopedAssets
```

Maintenance record fields:

- id
- asset_id
- outlet_id
- date
- maintenance_type
- priority
- issue
- action_taken
- vendor
- cost
- status
- scheduled_date
- completed_date
- next_service_date
- remark
- photo_url
- created_by
- created_at
- updated_at

Maintenance status values:

- scheduled
- in_progress
- completed

Maintenance priority values:

- low
- medium
- high
- critical

Maintenance type values:

- preventive
- repair
- inspection
- cleaning
- calibration
- replacement
- emergency

Maintenance rules:

- Maintenance records are only exposed for assets whose category has `maintenance_enabled = true`.
- Asset-level override can enable or disable maintenance independent of the category default.
- Asset-level `maintenance_override` can be `inherit`, `enabled`, or `disabled`.
- Final maintenance access is enabled when override is `enabled`, or when override is `inherit` and the category has maintenance enabled.
- Disposed assets do not expose new maintenance workflows.
- Workflow A: Scheduled → In Progress → Completed.
- Workflow B: direct Completed record creation is allowed because many F&B repairs are recorded after completion.
- Saving an In Progress maintenance record may set asset condition to Under Maintenance with clear UI feedback.
- Saving a Completed maintenance record can optionally set asset condition back to Good.
- Maintenance records support optional photo evidence using the asset photo storage bucket.
- Maintenance records keep one single `cost` field. Cost breakdown fields are intentionally not part of the current scope.
- Completed maintenance records are still editable later.
- Maintenance View mode is read-only and shows structured information cards, not inputs.
- Maintenance Edit mode is the only mode that shows form fields, dropdowns, date pickers, upload controls, and condition checkbox logic.

Maintenance form behavior by status:

- Scheduled shows maintenance type, priority, issue/problem, vendor/technician, scheduled date, estimated cost, photo evidence, and remark.
- In Progress shows maintenance type, priority, issue/problem, vendor/technician, action taken, scheduled date, current cost, photo evidence, and remark.
- Completed hides priority and scheduled date, and shows maintenance type, issue/problem, vendor/technician, action taken, final cost, completed date, optional next service date, photo evidence, remark, and optional Set asset condition back to Good checkbox.

Next service reminder rule:

- Asset Summary shows the latest completed service date.
- Asset Summary shows only the latest active future next-service reminder.
- When a new maintenance record is completed with a Next Service Date, it overwrites the asset-level next service reminder.
- When a new maintenance record is completed without a Next Service Date, any previous asset-level next service reminder is cleared.
- Old next service dates remain only inside historical maintenance records.
- Asset Summary must never show a Last Service Date that is newer than the current Next Service Due.

Movement log fields:

- id
- asset_id
- outlet_id
- movement_type
- quantity_change
- quantity_before
- quantity_after
- reason
- remark
- movement_date
- created_by
- created_at

Movement types:

- add
- reduce
- correction
- transfer_in
- transfer_out

Inspection fields:

- id
- outlet_id
- created_by
- inspection_date
- checked_by
- checked_by_employee_id
- category_scope
- status
- summary
- notes
- remark
- current_step
- completion_percentage
- last_edited_at
- last_edited_by
- draft_data
- auto_saved
- created_at
- updated_at

Inspection item fields:

- id
- inspection_id
- asset_id
- expected_quantity
- counted_quantity
- expected_qty
- counted_qty
- difference
- condition
- condition_status
- evidence_required
- evidence_status
- remark
- created_at

Inspection evidence fields:

- id
- inspection_item_id
- image_url
- caption
- created_at

Inspection flow:

1. Select outlet, inspection type, inspection date, and category scope. Checked By is auto-populated from the authenticated employee and is not editable.
2. Complete an asset inspection checklist using operational audit cards.
3. Step 2 checklist supports dynamic manual asset selection through Add Asset.
4. Add Asset uses a searchable, multi-select asset picker.
5. Users can remove items from the inspection or mark items as skipped.
6. Checklist progress shows completed, remaining, skipped, and progress percentage.
7. Each audit card shows asset thumbnail, asset name, description, category, expected quantity, counted quantity, difference status, condition, evidence upload, and remark.
8. Difference states are Matched, Extra, and Missing.
9. Inspection condition dropdown uses Good, Needs Attention, Damaged, and Missing.
10. Evidence or remark is recommended when quantity differs or condition is not Good, but submission is not blocked.
11. Review & Submit shows Inspection Summary and Issues Found, with exception rows first, asset photos, and evidence photos.
12. Submit inspection from Review & Submit or save draft.
13. Submitting updates asset quantity, asset condition, and last inspected date.
14. Quantity differences create correction movement logs.
15. Inspection submit normalizes condition values to lowercase snake_case before saving.
16. Critical alerts count only Damaged and Missing conditions; Needs Attention counts as a warning.

Inspection type presets:

- Routine Check
- Opening Check
- Closing Check
- Spot Check
- Maintenance Verification
- Incident Follow-up

Preset behavior:

- Routine Check defaults to the selected outlet/category active asset scope.
- Opening Check prioritizes operational readiness assets and commonly checked opening items.
- Closing Check prioritizes closing count and end-of-day operational verification.
- Spot Check supports partial inspection and may start from a smaller or manually selected checklist.
- Maintenance Verification prioritizes maintainable assets, Under Maintenance assets, Damaged assets, and recently completed maintenance.
- Incident Follow-up prioritizes assets with recent issues or missing/damaged conditions.
- Presets influence default checklist behavior, default inspection scope, smart asset suggestions, and operational reporting.
- Inspection Type is not just a static label.

Inspection History:

- Inspection history records sort newest first.
- Sort order:
  1. inspection date DESC
  2. created_at DESC
  3. updated_at DESC as fallback
- Same-day records show time, for example `28 May 2026 · 4:07 PM`.
- Each inspection card shows date, status badge, Checked By, total assets checked, critical count, variance count, and saved/submitted time.
- Checked By displays user name, role or position if available, and timestamp.
- If checked-by information is missing, display `Checked by: Unknown user`.
- Each inspection card provides View Details.
- View Details opens a read-only detail view with inspection date, checked by, outlet, checked assets, expected quantity, counted quantity, difference, condition, notes, and evidence.
- Newly saved or submitted inspections must appear immediately in newest-first order without stale cached ordering.

Inspection draft and resume rules:

- Draft inspections appear on the Asset Tracking dashboard as actionable alert cards.
- Draft inspections appear in Asset Profile inspection history with Draft, In Progress, and Pending Review badges.
- Draft cards show outlet, category scope, saved time, completion percentage, critical alerts, and pending evidence.
- Draft quick actions:
  - Resume Inspection
  - Delete Draft
  - Duplicate
  - Archive
- Resume restores:
  - current step
  - selected outlet/date/type/scope
  - counted quantities
  - selected asset conditions
  - remarks
  - uploaded evidence previews
- Draft records store full workflow state in `draft_data`.
- Draft data preserves dynamically added assets, removed assets, skipped items, counted quantities, selected conditions, remarks, and evidence previews.
- Draft status values:
  - draft
  - in_progress
  - pending_review
  - submitted
  - completed
  - archived

MVP exclusions:

- Depreciation
- Purchase value
- Warranty tracking
- QR code
- Barcode scan
- Maintenance scheduling automation for categories where maintenance is enabled
- Supplier link
- Transfer approval workflow

---

## 5.13A Inventory Control

Purpose:

Inventory Control is the daily stock operation system for F&B outlets.

It covers:

- Master Inventory
- Outlet-linked inventory items
- Inventory categories
- Stock Check Groups
- Frequency-based stock check schedules
- Daily Stock Check workflow
- Purchase Orders
- Inventory Movements
- Wastage
- Recipes & Usage

Sidebar placement:

Inventory Control is its own main sidebar section, not a subpage under Operations.

Routes:

- `#inventory_dashboard`
- `#inventory_master`
- `#inventory_par_levels`
- `#inventory_groups`
- `#inventory_stock_check`
- `#inventory_orders`
- `#inventory_movements`
- `#inventory_waste`
- `#inventory_recipes`

Core rules:

- Master Inventory is the source of truth for inventory items.
- Master Inventory must load from shared Supabase tables (`inventory_items`, `inventory_item_outlets`, `inventory_categories`, and `inventory_uoms`) so desktop and mobile sessions use the same source of truth.
- `inventory_items` is the authoritative Master Inventory source. Category, UOM, outlet link, supplier, and photo data are optional metadata and must never remove an item from the Master Inventory list when missing or unreadable.
- Master Inventory fetches must start from `inventory_items` and avoid inner joins that require category, UOM, outlet link, or photo metadata to exist.
- Missing metadata is handled as display fallback only: category = `Uncategorized`, UOM = `-`, photo = fallback icon, linked outlets = `No outlets linked`.
- Browser local storage/session storage must not be used as the authoritative Master Inventory item list. Master Inventory should refetch from Supabase on page load and may only use in-memory fallback data if remote loading fails.
- Staging/demo Inventory Control master data is seeded in Supabase migrations, not browser-local state.
- The authenticated app must not rely on fallback/demo inventory items for Master Inventory. Fallback demo inventory may exist only as development scaffolding and must not mask remote Supabase data problems.
- Master Inventory defines global item identity only.
- Inventory Categories is managed through Master Inventory > Category Settings.
- Inventory Categories does not appear as a standalone sidebar page.
- One inventory item can be linked to multiple outlets.
- Not every outlet uses every inventory item.
- Master Inventory > Linked Outlets controls whether an item participates in an outlet.
- Par Levels manages outlet-specific stock configuration only: Par Level, Storage Location, and Suppliers.
- Par Levels must not expose or control outlet active state.
- Par Level is the only outlet-specific minimum stock setting in the current scope.
- Low Stock Threshold and Reorder Qty are deferred and must not appear in current UI workflows.
- Stock Check Groups belong to one outlet.
- A group can only include inventory items linked to that outlet.
- Not every inventory item needs daily checking.
- Daily Stock Check shows due groups first, not all inventory items.
- Stock check due logic depends on group frequency.
- Draft stock checks can be continued later.
- Submitted stock checks can be reviewed.
- Reviewed or locked stock checks cannot be edited except by users with the required permission.
- Stock Requests are removed from current active sidebar and permission matrix scope.
- Purchase Orders are created from reviewed scheduled Stock Check suggestions or manual purchase planning.
- Every inventory movement creates an audit trail.

Inventory Control permissions:

- Inventory Control is a sidebar section / workspace grouping only.
- Inventory Control must not own operational permission rows such as create, edit, manage, import, export, record, generate, or approve.
- Inventory permissions live on child modules only.
- The `permissions` table must contain the canonical child permission keys below; role save/load must use these exact keys.
- Role save should sync missing canonical permission catalog rows before writing `role_permissions` so newly introduced module keys do not revert to Off.
- Role save must filter out legacy parent `inventory_control.*` keys from active payloads so old duplicate parent permissions are not reintroduced.
- Stock Requests permissions are deferred legacy/internal only and must not appear in the active Role Management matrix, module registry, sidebar, or route list.
- Non-view actions require view through the permission matrix dependency rule.

- inventory_dashboard.view
- inventory_master.view
- inventory_master.create
- inventory_master.edit
- inventory_master.delete
- inventory_master.import
- inventory_master.export
- inventory_categories.view
- inventory_categories.create
- inventory_categories.edit
- inventory_categories.delete
- inventory_uoms.view
- inventory_uoms.create
- inventory_uoms.edit
- inventory_uoms.delete
- inventory_par_levels.view
- inventory_par_levels.edit
- inventory_par_levels.export
- inventory_groups.view
- inventory_groups.create
- inventory_groups.edit
- inventory_groups.delete
- inventory_stock_check.view
- inventory_stock_check.create
- inventory_stock_check.edit
- inventory_stock_check.review
- inventory_stock_check.audit
- inventory_stock_check.export
- inventory_orders.view
- inventory_orders.create
- inventory_orders.edit
- inventory_orders.submit
- inventory_orders.receive
- inventory_orders.complete
- inventory_orders.cancel
- inventory_orders.export
- inventory_movements.view
- inventory_movements.create
- inventory_movements.export
- inventory_waste.view
- inventory_waste.create
- inventory_waste.manage
- inventory_waste.export
- inventory_recipes.view
- inventory_recipes.create
- inventory_recipes.edit
- inventory_recipes.delete
- inventory_recipes.manage
- inventory_recipes.export
- recipe_intelligence.view
- recipe_intelligence.manage

RBAC verification status:

- RBAC Full Verification completed on 30 May 2026. Report: `FEEDX_RBAC_VERIFICATION_REPORT.md`.
- Result: Pass with live-role UAT caveat.
- Stock Requests was removed from the active module registry during verification so it cannot appear in generated permission groups or the permission catalog for new role saves.
- Inventory Control bootstrap context now checks active child Inventory permissions instead of legacy `inventory_control.view`, so Inventory-only roles can load outlet and supplier context required for filters and scoped workflows.
- Sidebar visibility and direct route access derive from the module registry and route permissions.
- Role edit entry points use canonical `roles_permissions.*` checks with legacy alias support for older `roles.*` rows.
- Custom role editing rules remain: no own-role edit, no protected owner/admin edit, no permission grants beyond the current user's own permissions, and no outlet assignments outside the current user's accessible outlets.
- Remaining RBAC technical debt: older Supabase RLS migrations still contain legacy `inventory_control.*` fallback clauses. Active Role Management no longer grants these keys, but a cleanup migration should remove the fallback paths after confirming no production role rows depend on them.

Master Inventory fields:

- id
- item_name
- sku_code
- category_id
- unit
- cost
- cost_updated_at
- cost_updated_by
- photo_url
- description
- inventory_type (backend compatibility only; not user-facing in current Add/Edit Item UI)
- default_supplier_id
- status
- created_by
- updated_by
- created_at
- updated_at

Master Inventory UI:

- Title: Master Inventory
- Subtitle: Create and manage all inventory items used across outlets.
- Search by item name or SKU.
- Filter by category, status, and outlet.
- Page header actions include Import, Export, Category Settings, and Add Item.
- Category Settings opens `Inventory Category Settings`.
- UOM Settings opens `Inventory UOM Settings`.
- Inventory Category Settings uses a compact sortable list view, not large cards.
- Inventory Category Settings shows active categories by default.
- Category rows show drag handle, category name, description, linked item count, status badge, and actions.
- Dragging category rows updates `inventory_categories.sort_order`.
- Category order controls display order in inventory filters and item forms.
- Inventory Category Settings supports Add Category, Edit Category, Archive/Deactivate, and Delete when existing protection rules allow.
- Archive is a soft delete and persists `inventory_categories.status = inactive`.
- Delete is a hard delete and is allowed only when the category has zero linked `inventory_items`; if linked items exist, the UI must block deletion with a clear reassignment/archive message.
- Category management access is controlled by inventory_categories.view/create/edit/delete.
- Category is the main user-facing classification for inventory items.
- Inventory Type is no longer exposed in Add/Edit Item.
- Default Supplier is no longer exposed in Add/Edit Item because supplier assignment is outlet-specific and managed in Par Levels / outlet-item supplier configuration.
- The master item unit field is displayed as UOM in Master Inventory UI.
- `inventory_items.unit` is the source of truth for Master Inventory UOM; UI aliases such as `uom_code` must normalize back to the selected `unit` value and must not override a newly saved UOM.
- Master Inventory stores `inventory_items.cost` as the default estimated cost per UOM. This is a planning/default cost only; actual purchase cost from supplier invoices or PO receiving is a future enhancement and must not auto-update this field yet.
- Add/Edit Item shows Default Cost with helper text such as `RM per kg` or `RM per pcs` based on the selected UOM.
- Default Cost is optional, must be non-negative, and supports up to 4 decimals.
- Master Inventory table columns are Item, SKU Code, UOM, Linked Outlets, Cost, Status, and Actions when grouped by Category.
- Inline Cost editing requires `inventory_master.edit`, writes only `cost`, `cost_updated_at`, and `cost_updated_by`, and shows `Inventory cost updated` only after Supabase confirms the write.
- Master Inventory UOM values are managed by users in Master Inventory > UOM Settings.
- UOM dropdowns load from `inventory_uoms`, and the Add/Edit Item UOM dropdown includes `+ Add New UOM` for quick creation.
- Saving a new UOM refreshes the UOM list and auto-selects the newly created UOM in the item form.
- Inventory UOM Settings is remote-first: create, edit, archive, delete, and sort actions must persist to `inventory_uoms` before showing success.
- UOM archive is a soft deactivation using `inventory_uoms.is_active = false`; inactive UOMs are hidden from active item form suggestions after refresh.
- UOM hard delete is allowed only when no `inventory_items` rows use that UOM code; used UOMs must be blocked with a clear archive/reassign message.
- Inventory settings must not show local-only success messages. If Supabase write fails, the UI must show an error and keep/refetch the remote truth.
- Item Photo is uploaded from the device, not entered as a raw URL.
- Item photos are saved to `inventory_items.photo_url` through the Supabase Storage bucket `inventory-item-photos`.
- Photo previews are local only until Save. When a new item photo is selected, Save must upload to `inventory-item-photos`, persist the returned public URL to `inventory_items.photo_url`, refetch the item, and only then show `Inventory photo updated` or the relevant item update toast.
- If photo upload fails, the UI must not show `Inventory item updated`; it should show `Photo upload failed. Item was not updated.` If upload succeeds but the item update/refetch does not return the saved `photo_url`, show `Photo uploaded, but item update failed.`
- The Master Inventory list defaults to Group by Category.
- Master Inventory shows a compact KPI summary strip above the list: Total Items, Categories, Active Items, and Outlets Linked.
- Category group headers show category name, item count, and collapse/expand control.
- Category group headers use a section-style light green background, larger title type, grouped metadata, and one generic folder icon for every category.
- Category group headers must not use circular letter/avatar icons; circular fallback avatars are reserved for inventory item rows only.
- The Category Folder Style rule applies consistently across Master Inventory, Par Level Outlet View, and Par Level Matrix View.
- Collapsed category state may be remembered for the current browser session.
- A Group by control supports Category and None.
- When grouped by Category, the Category column is hidden because category is represented by the group header.
- When grouping is None, the table columns are Item, Category, SKU Code, UOM, Linked Outlets, Cost, Status, and Actions.
- Search, outlet filter, category filter, and status filter apply before grouping; empty groups are hidden.
- For roles with `outlet_access_type = all`, the `All Outlets` filter shows all active master inventory items and must not filter items out because they have no linked outlet rows.
- For a specific selected outlet, Master Inventory shows only items linked to that outlet.
- For selected-outlet roles using `All Accessible Outlets`, Master Inventory shows only items linked to outlets within the user's accessible outlet scope.
- Desktop and mobile Master Inventory views must render from the same filtered `visibleItems` collection. Mobile must not apply separate hidden filters, recency limits, created-by filters, photo filters, or outlet-only query limits.
- Mobile Master Inventory uses compact cards instead of a wide table to avoid horizontal clipping while preserving item photo/icon, item name, category, SKU, UOM, linked outlets, status, and actions.
- The Master Inventory table does not show Low Stock or Par Level columns because those values are outlet-specific.
- Linked Outlets displays a compact count such as `3 outlets`.
- Linked Outlets displays compact outlet codes for the first few outlets plus a `+X` more indicator.
- Clicking the Linked Outlets display opens a FloatingLayer popover with outlet names, outlet codes, linked status, and key outlet stock settings.
- Linked outlet labels must be normalized before rendering so all browsers use the same outlet shape: `code`, `outlet_code`, `shortCode`, `short_code`, or `abbreviation` for the display code, and `name`, `outlet_name`, or `outletName` for the display name.
- Master Inventory browser cache must be cleared or versioned out during loading; stale browser-specific cache must not cause Chrome/Safari item count or linked outlet label mismatches.
- Item rows use photo thumbnails when available and standardized category fallback icons when no photo exists.
- Master Inventory item rows show direct `Edit` and `Archive` actions; row overflow menus and `View Par Levels` shortcuts are not used.
- Par Levels remains a standalone Inventory Control module and is not opened from item-level Master Inventory actions.
- Baseline staging seed data includes Raw Material, Packaging, Frozen, Beverage, Cleaning, Dry Goods, Kitchen Supply, and Retail Item categories plus Sambal Sauce, Takeaway Cup 12oz, and Frozen Chicken Cut master items with outlet links and par levels.
- Add/Edit Item keeps master item fields separate from outlet-level par management.
- Add/Edit Item shows linked outlets and a note that par levels are managed in Par Level Setup.
- Add/Edit Item does not show outlet-by-outlet Par Level, Low Stock Threshold, or Reorder Qty inputs.
- Add/Edit Item save is remote-first: show success only after `inventory_items` and `inventory_item_outlets` are persisted and refetched from Supabase.
- Add/Edit Item toast messages are action-specific: `Inventory item created`, `Inventory item updated`, `Inventory photo updated`, `Inventory UOM updated`, `Inventory cost updated`, `Inventory category updated`, `Inventory status updated`, `Inventory item details updated`, `Linked outlets updated`, or `Item saved, but photo upload failed`.
- Inventory Control toast messages must identify both module and action, and success toasts may only appear after Supabase confirms the write. Scheduled Stock Check uses `Stock Check draft saved` and `Stock Check submitted`; Audit Stock Check uses `Audit Stock Check draft saved` and `Audit Stock Check submitted`; purchase workflows use `Draft PO created`, `PO submitted`, `Inventory received`, `PO completed`, and `PO cancelled`; Waste uses `Waste record created` / `Waste record updated`; Recipes use `Recipe created`, `Recipe updated`, and `Recipe archived`. Error toasts must name the failed action, for example `Failed to submit Audit Stock Check` or `Failed to update Inventory Item`.
- Item archive/delete actions are remote-first and must not mutate the visible item list before Supabase confirms the write.
- Item Archive persists `inventory_items.status = inactive`, refetches the list, hides the item from the Active filter, and keeps the item visible under Inactive or All status filters.
- Linked outlet rows are stored in `inventory_item_outlets` using `inventory_item_id` and `outlet_id`; outlet codes are display/import inputs only and are not stored as the link key.
- New linked outlet rows may have `par_level = null` until configured in Par Levels.
- Editing Linked Outlets may add or remove `inventory_item_outlets` rows and requires `inventory_master.edit` or equivalent outlet-scoped permission.
- Linked Outlet saves treat the selected outlet list as the source of truth within the current user's accessible outlet scope: the save flow fetches existing `inventory_item_outlets`, inserts newly selected scoped links, deletes removed scoped links, preserves out-of-scope existing links, then refetches Supabase truth before showing success.
- Non-protected roles can only link items to outlets they can access.

Master Inventory import/export:

- Import supports CSV and XLSX.
- Required import columns are Item Name, Category, and UOM.
- Import template columns are Item Name, SKU Code, Category, UOM, Cost, Description, Status, and Linked Outlet Codes.
- Linked Outlet Codes accepts outlet codes separated by commas, for example `FC,HLIPH,JYMT`.
- Import validates rows before commit and shows a preview of create, update, and failed rows.
- Category matching uses normalized category name.
- UOM must exist in the allowed UOM list.
- Cost is optional, must be numeric, non-negative, and supports up to 4 decimals.
- Outlet matching uses normalized outlet code only and must be within the importing user's accessible outlet scope.
- Unknown Category, UOM, or Outlet Code values show validation errors in the preview and must not be silently imported.
- Import upserts inventory items by SKU Code when present; otherwise by normalized Item Name.
- Import upserts `inventory_item_outlets` links for valid linked outlets.
- Import writes to Supabase through the same remote-first `inventory_items` and `inventory_item_outlets` persistence path as Add/Edit Item.
- Import success is shown only after Supabase confirms the item and linked outlet writes; local-only import mutations are not allowed in the authenticated app.
- Import does not create categories, UOM values, outlets, or suppliers automatically.
- Import does not import supplier assignment data.
- Import does not set Par Levels, Low Stock Thresholds, or Reorder Quantities.
- Failed rows may be skipped while valid rows are imported.
- Import template download is available from the import workflow.
- Export supports the current filtered Master Inventory view as CSV.
- Export columns are Item Name, SKU Code, Category, UOM, Cost, Description, Status, Linked Outlet Codes, Created At, and Updated At.
- Export filename format is `feedx-master-inventory-YYYY-MM-DD.csv`.
- Import requires inventory_master.create or inventory_master.edit permission.
- Export requires inventory_master.export permission.

Inventory Control persistence audit:

Status as of 30 May 2026:

- Source file audited: `src/features/sales-purchase/pages/InventoryControlPage.jsx`.
- Linked Supabase schema contains: `inventory_items`, `inventory_categories`, `inventory_uoms`, `inventory_item_outlets`, `inventory_item_outlet_suppliers`, `inventory_stock_check_groups`, `inventory_stock_check_group_categories`, `inventory_stock_checks`, `inventory_stock_check_items`, `inventory_purchase_orders`, `inventory_purchase_order_items`, `inventory_purchase_receipts`, `inventory_purchase_receipt_items`, `inventory_movements`, `inventory_waste_records`, `inventory_menu_categories`, `inventory_recipes`, and `inventory_recipe_items`.
- All current Inventory Control persistence tables exist in linked staging Supabase.
- P0-2 browser verification passed on 29 May 2026: scheduled Stock Check draft/save/refresh/resume/submit/View Result and Audit Stock Check draft/save/refresh/resume/submit/View Audit Result persisted through Supabase. Audit results did not expose Purchase Suggestions.
- P0-3 browser verification passed on 29 May 2026: submitted scheduled Stock Check shortage rows opened in Purchase Suggestions, supplier-backed Draft PO creation persisted through Supabase, the Draft PO and item rows remained after refresh in Purchase Orders, the source Stock Check changed to View Draft PO / duplicate-prevention state, and Audit Stock Check records did not expose Purchase Suggestions.
- P0-4 browser verification passed on 29 May 2026 for the core PO workflow: Draft PO edit persisted, Submit Order persisted after refresh, Partial Receive created receipt rows and an `inventory_movements` Purchase row, the Partial Received PO could not be cancelled, Complete PO closed a partial PO with completion reason, Completed/Cancelled states remained read-only after refresh, and PO detail showed receiving history from Supabase.
- Full Receive browser verification passed on 29 May 2026: fresh PO `PO-180719-A7E` was submitted, Fill Remaining set all received quantities, Confirm Receive changed the order to Fully Received, refresh preserved Fully Received, Complete PO closed it as a fully fulfilled completed PO, refresh preserved Completed, receiving history showed the full quantity, and `inventory_movements` contained only the actual received quantities.
- P1-A completed on 29 May 2026: Master Inventory Import is Supabase-backed, validates Category/UOM/Outlet Codes before commit, imports valid rows only, and writes through the same Add/Edit Item persistence path.
- P1-A code path reverified on 30 May 2026: Import confirmation does not use local-only persistence; each valid preview row calls `persistRemoteInventoryItem()`, which writes `inventory_items` and `inventory_item_outlets`. Invalid Category/UOM/Outlet Code rows remain preview errors and are skipped/blocked before Supabase writes.
- P1-B completed on 29 May 2026: Wastage records are Supabase-backed through `inventory_waste_records`; Record Waste writes a matching `inventory_movements` row with `reference_type = waste`, refresh preserves the waste record, and the Waste Records table reads from Supabase.
- P1-C completed on 29 May 2026: Recipes & Usage is Supabase-backed through `inventory_recipes` and `inventory_recipe_items`; Add/Edit replaces ingredient rows transaction-style at the app layer, Archive sets recipe status to inactive, refresh preserves recipe data, and the active recipe list reads from Supabase.
- Master Inventory item create/edit/archive, import, and linked outlet saves are Supabase-backed.
- Inventory Categories create/edit/archive/delete and drag sort are Supabase-backed.
- Inventory UOM create/edit/archive/delete is Supabase-backed; UOM drag sorting is not implemented in the current UI.
- Par Levels update Par Level, Storage Location, and Suppliers through Supabase-backed `inventory_item_outlets` and `inventory_item_outlet_suppliers`.
- Stock Check Groups create/edit/duplicate/archive are Supabase-backed through `inventory_stock_check_groups` and `inventory_stock_check_group_categories`.
- Scheduled Stock Check start/draft/submit/result and Audit Stock Check start/draft/submit/result are Supabase-backed through `inventory_stock_checks` and `inventory_stock_check_items`.
- Stock Check submit validation is shown inline above the item list instead of as a blocking toast. The validation panel lists item names that require attention, highlights invalid rows, and auto-scrolls to the first invalid item. Save Draft remains available when a scheduled or audit check has incomplete counts.
- Stock Check layout is responsive without a feature flag: desktop screens `>= 1024px` use the desktop table workflow, tablet screens `769px-1023px` use the compact card workflow, and mobile screens `<= 768px` use the Stock Check card workflow. The card workflow receives the same rows, validation, save, submit, skip, and photo preview handlers and does not change persistence or business logic.
- Generated variance movements are not created by Stock Check submit in the current P0-2 implementation; Stock Check persistence stores the audit/count snapshot and variance result only.
- Purchase Suggestions to Draft PO creation is Supabase-backed through `inventory_purchase_orders` and `inventory_purchase_order_items`.
- Purchase Orders submit, edit Draft PO, receive, partial receive, complete, and cancel are Supabase-backed through `inventory_purchase_orders`, `inventory_purchase_order_items`, `inventory_purchase_receipts`, `inventory_purchase_receipt_items`, and `inventory_movements`.
- Inventory Movements created from Purchase Receive are Supabase-backed. Manual Inventory Movements entry is also Supabase-backed through `inventory_movements`.
- Inventory Control P0 UAT completed on 29 May 2026. Report: `FEEDX_INVENTORY_UAT_REPORT.md`.
- Wastage create waste record is Supabase-backed through `inventory_waste_records` and creates a Waste movement row in `inventory_movements`.
- Recipes & Usage create/edit/archive and ingredient mapping are Supabase-backed through `inventory_recipes` and `inventory_recipe_items`.
- Production Readiness Cleanup Phase 1 completed on 30 May 2026:
  - Result: Full Green MVP for the current active Inventory Control workflow.
  - Risk level: Low for current MVP scope.
  - Active pages verified as Supabase-backed: Inventory Dashboard, Master Inventory, Category Settings, UOM Settings, Par Levels, Stock Check Groups, Stock Check, Purchase Orders, Inventory Movements, Wastage, and Recipes & Usage.
  - No active Inventory Control page should create operational records from browser-local arrays.
  - Category and UOM fallback/demo lists are not used as authenticated staging source of truth; authenticated inventory data is loaded from Supabase.
  - `defaultData()` is development-only scaffolding and is hard-gated behind `import.meta.env.DEV`; authenticated staging/production inventory state must not merge fallback operational rows.
  - Legacy Stock Requests is out of current MVP scope. The `#inventory_requests` route is removed from the active route registry/sidebar navigation, the local request modal/action path is not rendered, and manual access falls back to a clean unavailable/deferred state or dashboard routing.
  - Visible inventory diagnostics and persistence debug logs are development-gated with `import.meta.env.DEV`.

Persistence priorities:

- P0: Completed for the core workflow covering Stock Check Groups, Stock Check, Purchase Suggestions, Purchase Orders, receiving, and Inventory Movements.
- P1-A: Completed for Master Inventory Import remote persistence.
- P1-B: Completed for Wastage remote persistence.
- P1-C: Completed for Recipes & Usage remote persistence.
- Stock Requests remains deferred/out of current MVP scope and must stay hidden until it is either Supabase-backed or intentionally reintroduced.
- P1: Add UOM drag sort persistence if sortable UOM ordering becomes part of the UI.
- P2: Complete RBAC smoke testing with All-outlet and Selected-outlet custom roles before broader rollout.

Inventory Control business date rules:

- Business dates must be explicit and must not be inferred from the browser/system clock when the user has selected an operational date.
- FeedX gets the default Inventory Control business date with `getBusinessDateInput('Asia/Kuala_Lumpur')` and normalizes persisted business dates to `YYYY-MM-DD` with `normalizeBusinessDate()`.
- Stock Check defaults to Malaysia business today on normal page load, respects an explicit `date` URL parameter, and does not default from `last_checked_at` or the latest submitted check.
- Scheduled Stock Check date lock: scheduled checks can only be started on their assigned Malaysia business date. If a due scheduled check date is before today and no submitted check exists for that group/outlet/date, the card shows `Missed`, hides Start Check, and explains that the check was not completed on schedule.
- Stock Check and Audit Stock Check persist `inventory_stock_checks.check_date` from the selected check/audit date.
- Scheduled Stock Check completion cards match submitted checks by `group_id`, `outlet_id`, and normalized `check_date`; group names and system date are not valid matching keys.
- Waste records persist `inventory_waste_records.waste_date` from the selected Waste Date.
- Manual Inventory Movements persist the selected Movement Date by converting the normalized business date to a stable midday timestamp for `inventory_movements.created_at`, preventing UTC midnight date rollback in Malaysia.
- Waste-generated inventory movements use the same selected waste business date as the source waste record.
- Purchase receiving uses the receive transaction timestamp as the receipt business timestamp because the current receive workflow has no separate receive-date picker. If a Receive Date field is added later, it must be normalized with `normalizeBusinessDate()` before writing receipts and purchase movements.
- `new Date()` and `Date.now()` are allowed only for technical timestamps, generated IDs/file paths, display formatting, sorting, and audit fields such as `created_at`, `updated_at`, `submitted_at`, `received_at`, `completed_at`, and `cancelled_at`.
- Export filenames may use the local current date from `todayInput()`, but operational records must use the selected business date when one exists.

Inventory UOM data model:

- Table: `inventory_uoms`
- Fields: id, code, display_name, uom_type, is_active, sort_order, created_at, updated_at.
- Active UOMs appear in item forms and import validation.
- Inactive UOMs remain available historically but should not be suggested for new items.
- UOM Settings may show development diagnostics for Remote UOM Rows, Visible UOM Rows, and Last Write Status while persistence issues are being verified.

Inventory UOM permissions:

- inventory_uoms.view
- inventory_uoms.create
- inventory_uoms.edit
- inventory_uoms.delete

Par Level Setup:

- Route: `#inventory_par_levels`
- Sidebar: Inventory Control > Par Levels
- Purpose: bulk manage outlet-specific minimum stock levels.
- Par Level means the minimum quantity an outlet should keep for an item.
- Par Levels does not create items, archive items, activate/deactivate outlet participation, or decide whether an item belongs to an outlet.
- If an item is linked to the outlet from Master Inventory, it appears in Par Levels, Stock Check, and Purchase Suggestions.
- If an item is not linked to the outlet from Master Inventory, it is hidden from Par Levels, Stock Check, and Purchase Suggestions.
- Outlet View groups items by Category by default.
- Outlet View supports Group by Category and None.
- Category group headers show category fallback icon, category name, item count, and collapse/expand control.
- Category group headers use the Inventory Control Folder Style: generic folder icon, section-style light green background, and no circular category avatar.
- Search, category filter, and outlet filter apply before grouping; empty groups are hidden.
- When grouped by Category, Outlet View columns are Item, UOM, Par Level, Storage Location, and Suppliers.
- When grouping is None, Outlet View columns are Item, UOM, Par Level, Storage Location, and Suppliers.
- Matrix View is the HQ comparison view for outlet par levels.
- Matrix View always shows all accessible outlets as comparison columns and must not be narrowed to a single selected outlet.
- Outlet View is the single-outlet management mode and keeps the Outlet filter.
- Matrix View hides the single-outlet selector and shows an All Accessible Outlets scope indicator instead.
- Matrix View rows are grouped by Category and columns are outlets.
- Matrix View freezes item identity columns so item details remain visible during horizontal scroll.
- Matrix View outlet headers show outlet codes with full outlet names available as tooltip/title text.
- Matrix View visually distinguishes Not Linked, Configured, Missing, Zero, Invalid, and Outlier cells.
- Matrix View supports spreadsheet-style keyboard navigation across linked editable cells: Tab moves to the next outlet column, Shift+Tab moves to the previous outlet column, Enter moves down, and Shift+Enter moves up. Not Linked cells are skipped.
- Matrix View includes a summary strip for Items, Categories, Outlets, Configured cells, and Missing cells.
- Users can update par levels without opening each item.
- Each outlet-item configuration can assign one or more suppliers.
- Supplier assignment is outlet-specific and must only show active suppliers linked to the selected outlet through `supplier_outlets`.
- Supplier multi-select uses FloatingLayer and must not be clipped by cards or tables.
- Par Levels uses a remote-first autosave interaction with clear Saved/Saving/Save failed feedback.
- Par Level, Storage Location, and outlet-item supplier assignment persist to `inventory_item_outlets` and `inventory_item_outlet_suppliers`; local UI state is updated only after Supabase confirms the write.
- New Par Level values are blank until configured; unset Par Level is treated as null/empty in the UI, not displayed as `0`.
- Par Levels supports spreadsheet-style data entry in Outlet View: Enter moves to the next visible row, Shift+Enter moves to the previous visible row, Arrow Up/Down moves between visible rows, and Arrow Left/Right moves between editable fields in the same row sequence.
- Spreadsheet navigation only targets visible editable rows; collapsed category groups are skipped.
- Par Levels export includes Item Name, SKU Code, Category, UOM, Outlet, Par Level, Storage Location, and Suppliers.
- Exported suppliers are comma-separated supplier names.
- Low stock logic is `current_stock < inventory_item_outlets.par_level`.
- Numeric inventory inputs use select-on-focus behavior so existing values can be overwritten in one action.
- Numeric inventory fields must allow empty values while editing, prevent negative values, and avoid defaulting unset values to `0`.

Inventory item status:

- Active
- Inactive
- Archived

Inventory categories:

Examples:

- Raw Material
- Beverage
- Packaging
- Cleaning
- Frozen
- Dry Goods
- Kitchen Supply
- Retail Item

Category fields:

- id
- name
- description
- sort_order
- status
- created_at
- updated_at

Outlet linking:

Inventory items are linked to outlets through an item-outlet relation table.

`inventory_item_outlets` fields:

- id
- inventory_item_id
- outlet_id
- par_level
- storage_location
- is_active (legacy/internal only; current Par Levels UI and stock check logic must not use this to control outlet participation)
- created_at
- updated_at

Rules:

- One item can belong to many outlets.
- One outlet can use many items.
- Same item can have different par levels per outlet.
- Stock Check reads `par_level` from `inventory_item_outlets` for the selected outlet.
- Stock Check variance is `par_level - actual_count_quantity`.
- Low stock alerts compare outlet current stock against `inventory_item_outlets.par_level`.
- Outlet selectors and item pickers must respect role outlet access.
- Stock Check Groups link inventory categories, not individual inventory items.
- Stock Check generation dynamically loads active items from the selected categories that are linked to the group outlet through Master Inventory linked outlets.
- New active items added to a linked category automatically appear in the relevant stock check group for linked outlets.

Stock Check Groups:

Purpose:

Each outlet groups inventory categories into operational check lists. Items are generated automatically from active outlet-linked inventory items in those categories.

Page behavior:

- Stock Check Groups page uses an Outlet filter as the active creation and viewing context.
- Owner/admin protected roles may use All Outlets for viewing; non-protected roles only see accessible outlets.
- Add Group uses the currently selected outlet context.
- If the active outlet context is All Outlets, user must select one outlet before creating a stock check group.
- Add/Edit Group modal does not ask outlet again; it displays the selected outlet as read-only context.
- Group list uses compact schedule/category display rather than large cards.
- Custom schedules are summarized as `Custom · N days`; full weekdays are shown only through tooltip/popover detail.
- Monthly schedules are summarized as `Monthly · 1st day`, `Monthly · 15th day`, or `Monthly · Last day`.
- Category display shows 2-3 chips plus `+X categories` for longer groups.
- Stock Check Groups page includes quick stats for total groups, due today, completed today, and inactive groups.

Group fields:

- id
- outlet_id
- name
- description
- shift
- frequency_type
- frequency_days
- schedule_config
- status
- last_checked_at
- created_at
- updated_at

Group category links:

- Table: `inventory_stock_check_group_categories`
- Fields: id, group_id, category_id, created_at.
- Add/Edit/Duplicate writes the group row first, then replaces linked category rows.
- Archive updates `inventory_stock_check_groups.status = inactive` and preserves the historical group record.
- Stock Check Groups must never show success until Supabase confirms both the group row and category links.

Frequency options:

- Monthly
- Custom

Custom days:

- Monday
- Tuesday
- Wednesday
- Thursday
- Friday
- Saturday
- Sunday

Due status:

- Due Today
- Completed
- Draft
- Missed
- Not Due

Daily Stock Check workflow:

1. Select outlet and stock check group.
2. Start Check is available only when the selected scheduled check date is today and the group is due on that date.
3. Backdated due scheduled checks show Missed and cannot be started from the scheduled flow.
4. Start Check creates or resumes a Supabase draft for the same outlet, group, date, and shift.
5. Count items and preserve actual count, notes, variance, and row status in `inventory_stock_check_items`.
6. Save Draft writes `inventory_stock_checks.status = draft` and replaces the item snapshot rows.
7. Submit Stock Check writes the final item snapshot to the exact active draft/check row, preserves the selected check date, sets `inventory_stock_checks.status = submitted`, sets `submitted_at`, records `submitted_by`, and updates the group `last_checked_at`.
8. Return to Stock Check list.
9. Completed check card shows Review Purchase Suggestions when shortages exist and the user has permission.
10. Create Draft POs only after user review and confirmation.
11. Stock Check entry headers show the group, outlet, shift/date, started-by identity, and the latest draft/submission timestamp.
12. Scheduled check card completion is matched from submitted scheduled checks by `group_id`, `outlet_id`, and `check_date`. The Shift filter defaults to All Shifts, so completed matching does not require `shift` unless a specific shift filter is selected. Group names are never used for completion matching.
13. Mobile Stock Check shows live completion progress: counted or skipped rows count as completed, remaining rows have no count and are not skipped, the progress bar updates while typing, and the sticky footer shows completed/skipped/remaining plus Ready to submit at 100%.

Audit Stock Check workflow:

- Stock Check page provides an Audit Stock Check action for special non-scheduled checks.
- Audit types: Month-End Closing, Full Stock Audit, Spot Check, Category Audit, and Custom Audit.
- Audit setup captures Outlet, Audit Date, Audit Name, Audit Type, category selection, and notes.
- Audit setup selects categories only, not individual items.
- Selected categories generate the full list of active outlet-linked items under those categories.
- Audit counting page groups generated items by category by default and supports item search.
- Individual audit items can be skipped during counting only when a skip reason is provided.
- Skipped items are preserved with skip reason, do not calculate variance, and show status Skipped.
- Audit checks can be saved as Draft and continued later with audit metadata, selected categories, generated items, counts, notes, skipped items, and skip reasons preserved.
- Audit checks calculate variance against outlet par level and create stock check history/result records.
- Audit checks use `stock_check_type = audit` and may omit `stock_check_group_id`.
- Audit drafts and submitted audit results are persisted in `inventory_stock_checks` and `inventory_stock_check_items`.
- Audit submissions also record `submitted_by` and `submitted_at` so audit results show who completed the count.
- Audit Stock Check does not generate Purchase Suggestions, Draft PO, or ordering workflows.
- Submitted audit result cards show View Audit Result only. Draft audit cards show Continue Audit and Delete Draft.
- Audit draft deletion is allowed only when `inventory_stock_checks.status = draft`; it deletes the draft check and its `inventory_stock_check_items` after confirmation. Completed audits cannot be deleted.

Stock check statuses:

- Draft
- Submitted
- Reviewed
- Locked

Stock check item fields:

- stock_check_id
- item_id
- category_id
- item photo thumbnail from `inventory_items.photo_url` / item photo field
- par_level_quantity
- actual_count_quantity
- variance
- unit
- status
- notes
- skipped
- skip_reason

Stock check item display:

- Scheduled Stock Check and Audit Stock Check counting rows show an item photo thumbnail when available.
- If no item photo exists, rows show a safe initials/category fallback; broken image icons must never appear.
- Item thumbnails can be clicked to open a larger lightbox preview with item name.
- Stock Check result/detail views also show item thumbnails and support the same larger photo preview.
- Thumbnail UI must remain visible and readable on mobile and dark mode.

Variance rule:

```text
variance = par_level_quantity - actual_count_quantity
```

Shortage rule:

- If variance > 0, the item is considered a shortage.
- Stock Check submission must not directly create submitted Purchase Orders.
- Stock Check submission only completes the check and returns the user to the Stock Check list.
- Purchase Suggestions are accessed from completed scheduled Stock Check cards only.
- Purchase Suggestions are generated from submitted scheduled check rows when the user clicks Review Purchase Suggestions; audit stock checks never generate suggestions.
- Purchase Suggestions are reviewed before creating Draft POs.
- Purchase Suggestions modal does not include a Finish Only action; users either create Draft PO or close the modal.
- One completed scheduled Stock Check can generate Draft PO records only once.
- Existing non-cancelled Purchase Orders with `source_type = stock_check` and `source_stock_check_id = current stock_check_id` block duplicate Draft PO creation.
- Existing non-cancelled Purchase Order Items with `source_stock_check_item_id` matching the submitted check item also block duplicate Draft PO creation.
- Once Draft PO is created, the completed Stock Check card shows View Draft PO / linked PO access instead of allowing another Draft PO creation.
- Suggested order quantity defaults to shortage quantity and remains editable.
- Users may exclude suggested items, add remarks, or change supplier.
- Supplier choices must come from suppliers linked to the selected outlet and assigned to the outlet-item configuration.
- Items without an assigned supplier are grouped under Unassigned Supplier and require supplier selection before Draft PO creation.
- Created POs use `source_type = stock_check` and reference `source_stock_check_id`.
- Created PO item rows reference `source_stock_check_item_id` for duplicate prevention and audit traceability.
- PO submission is manual and separate from Stock Check completion.

Variance statuses:

- Normal
- Shortage
- Excess
- Critical

Daily Stock Check UI:

- Header: Daily Stock Check
- Subtitle: Fast inventory counting workflow.
- Filters: Outlet, Date, Shift, Group, Category, Search Item.
- Active counting form includes a compact info bar for checked-by, started-by, and draft/submission status.
- Actual count input uses quantity stepper controls.
- Quick count buttons: Full, Half, Empty, NA.
- Submit validation lists incomplete items by name, shows inline row messages such as `Count required` or `Skip reason required`, and scrolls to the first invalid row.
- Sticky bottom bar shows items checked, critical items, Save Draft, and Submit Stock Check.
- Result modals show checked-by/submitted-at, total items, Normal, Shortage, Excess, and Skipped counts above the item table.
- Result item rows show photo/fallback, category, SKU, UOM, notes, skip reason, and semantic status badges.
- Mobile uses card layout instead of a dense table.

Operational identity display:

- Operational history components must resolve user references from `recorded_by`, `created_by`, `received_by`, `submitted_by`, and inspection checker fields to employee display names.
- Display priority is `employees.nickname`, then `employees.full_name`, then `employees.email`, then `Unknown User`.
- Purchase Order Receiving History, Inventory Movements, Waste Records, Stock Check Results, Audit Stock Check Results, Asset Inspection History, and activity timelines must not expose raw employee/auth UUIDs.

Stock Requests:

- Removed from the current Inventory Control sidebar scope.
- Route `#inventory_requests` is disabled in the current MVP route registry.
- Legacy database tables and code/data may remain for compatibility.
- Current ordering flow uses reviewed scheduled Stock Check suggestions or manual purchase planning.

Purchase Orders:

Purpose:

Convert reviewed scheduled stock check purchase suggestions or manual purchase planning into supplier orders.

PO statuses:

- Draft
- Submitted
- Supplier Confirmed
- Partial Received
- Fully Received
- Completed
- Cancelled

Rules:

- Stock Check generated POs are created as Draft only.
- One Draft PO is created per supplier per outlet per stock check confirmation.
- A completed scheduled Stock Check must not create duplicate Draft POs when linked non-cancelled POs already exist.
- Draft POs include only included suggestion rows with order quantity greater than zero.
- Purchase Orders track source type and source stock check when generated from Stock Check.
- Stock is not updated when a PO is submitted.
- Receiving inventory requires explicit received quantity confirmation.
- Receive Inventory modal is optimized for high-speed entry: numeric spinners are hidden, values auto-select on focus, Enter moves to the next Receive Now field, and Shift+Enter moves to the previous field.
- Receive Inventory supports row-level Fill and header-level Fill Remaining actions.
- Receive Inventory shows row balance, row receive status, and footer totals for Total Ordered, Receiving Now, and Receiving Status.
- Receipt Remark remains available; delivery order/invoice attachments are planned for a future receiving step.
- Receiving creates inventory movement rows with movement type Purchase.
- Receiving updates `inventory_purchase_order_items.received_qty` cumulatively.
- Inventory movement rows are created only for actual received quantities, never for unreceived or unfulfilled quantities.
- Partial receiving sets status to Partial Received.
- Full receiving sets status to Fully Received.
- Complete PO closes a Fully Received order as `completion_type = full`.
- Partial Received POs cannot be cancelled. They are closed with Complete PO when the supplier cannot fulfill the remaining quantity.
- Completing a Partial Received PO records `completion_type = partial`, saves the completion reason when provided/required, and treats remaining quantity as unfulfilled.
- PO detail shows supplier, outlet, source stock check/request, item rows, ordered quantity, received quantity, remaining quantity, fulfillment percentage, completion type/reason, unit, remark, receiving history, and status timeline.
- PO detail uses a procurement workflow view with Generated From context, supplier contact placeholder, Created → Submitted → Receiving → Completed progress, fulfillment progress bar, item Balance column, and receiving history timeline.
- PO detail action group includes Copy PO Text, Export PDF, Print, and quick Receive when the PO is receivable.
- Purchase Orders display a business-facing PO number in `[OutletCode]-[YYMMDD]-[RunningNo]` format, for example `HLI-250608-001`.
- The existing stored `po_no` remains the internal system ID and must not be changed by the business PO display reference.
- Purchase Order lists, supplier copy text, and primary user-facing PO labels use the business PO number; PO detail also shows the Internal System ID for audit/reference.
- Hover/tooltips can expose the internal system ID where the shorter business PO number is shown.
- Receiving history timeline shows received date, received quantity, `Received By`, remark, and item-level received quantities. `Received By` must resolve employee nickname, then full name, then email, then `Unknown User`; raw UUIDs must never be displayed.
- Status workflow: Draft → Submitted → Supplier Confirmed → Partial Received → Fully Received → Completed.
- Cancelled preserves historical PO records and requires a cancellation reason.
- Draft can be cancelled anytime.
- Submitted and Supplier Confirmed can be cancelled if no quantity has been received.
- PO cannot be cancelled after any receiving has started.
- Edit is allowed for Draft status only.
- Purchase Orders support Copy PO Text for supplier communication through WhatsApp or email.
- Copied PO text includes supplier, PO no, created date, outlet, item names, ordered quantities, UOM, and remarks when available.
- Copy PO Text uses ordered quantity, not received quantity, and uses the business PO number instead of the internal system ID.
- Purchase Orders support outlet, supplier, status, source, date range, and search filters.
- Purchase Order export respects current filters and includes PO No., Supplier, Outlet, Items, Ordered Qty, Received Qty, Remaining Qty, Status, Source, Created Date, Submitted Date, Completed Date, Completion Type, Completion Reason, and Cancelled Reason.

Inventory Movements:

Purpose:

Track all stock changes and adjustments.

UI rules:

- Inventory Movements uses the page header as the only page title/action area; duplicate section titles and duplicate Record Movement buttons are not shown.
- The page is split into Filters, Movement Summary, and Movement Records sections.
- Movement Summary shows KPI cards for Purchase In, Transfer, Waste, and Adjustments based on currently filtered records.
- Record/Edit Movement field order is Outlet, Item, Movement Type, Quantity, Reference, and Notes. Transfer movements use From Outlet and To Outlet in place of a single outlet.
- The Item selector is searchable.
- Purchase movements must be positive. Waste movements must be negative. Transfer movements create one Transfer Out row and one Transfer In row. Adjustment movements support Increase or Decrease.
- Purchase movements created by PO Receiving are read-only from Inventory Movements. Waste, Transfer, and Adjustment movement rows can be edited by users with inventory movement write access.
- Movement edits update Supabase and create an audit log entry with before/after values so edit history is retained.
- Movement Records shows the filtered record count, keeps the table horizontally scrollable on mobile, merges Qty and UOM into one column such as `+12 kg` or `-1 kg`, and displays readable employee names or email fallbacks for Created By. Raw UUIDs must not be shown to users.
- Quantity colors: Purchase green, Waste amber, Transfer blue, and Adjustment purple.
- Movement type badges use semantic colors: Purchase green, Transfer In blue, Transfer Out purple, Waste orange, and Adjustment grey.
- Reference No. is clickable when a linked source exists: Purchase Order references open PO detail, Waste references open the waste record detail, and Transfer references open transfer detail when available.

Movement types:

- Purchase
- Transfer In
- Transfer Out
- Waste
- Adjustment
- Staff Meal
- Production Usage
- Return

Movement records include:

- date_time
- item_id
- movement_type
- quantity
- unit
- outlet_id
- user_id
- reference
- notes

Wastage:

Purpose:

Track wastage and operational leakage.

Page behavior:

- Wastage uses a required single Outlet filter as the active operational context; All Outlets is not shown because every waste record must belong to one outlet.
- The default Wastage outlet is the first accessible outlet.
- Record Waste uses the currently selected outlet context and does not ask for outlet inside the modal.
- Waste dashboard metrics, Waste Types, Waste Records, and operational insights respond to outlet, waste type, date range, and search filters.
- Waste Records are outlet-scoped and should show Date, Item, Category, Waste Type, Qty, Outlet, Recorded By, Notes, Evidence, and Actions.
- Recorded By must display employee nickname, falling back to full name/email, and must never expose raw UUIDs.
- Record Waste item picker only shows active inventory items linked to the selected outlet.
- Record Waste writes to `inventory_waste_records` and succeeds only after Supabase confirms the insert.
- After a waste record is saved, FeedX creates an `inventory_movements` row with `movement_type = Waste`, `reference_type = waste`, `reference_id = inventory_waste_records.id`, and a `WASTE-XXXXXXXX` reference number.
- Waste movement quantity follows the current inventory movement convention: waste is stored as a negative quantity because it reduces stock.
- Photo evidence is optional. Uploaded evidence is stored in Supabase Storage and the public URL is saved to `inventory_waste_records.photo_url`; the table shows `View Photo`, and the detail modal displays the evidence photo and movement reference.
- Waste metrics currently use record count and quantity only; cost/value analysis is deferred until item costing exists.

Waste types:

- Spoilage
- Expired
- Kitchen Error
- Burnt
- Returned Item
- Staff Consumption
- Unknown

Wastage sections:

- Waste Quantity
- Waste Records
- Highest Waste Category or Highest Waste Item depending on outlet scope
- Unexplained Loss %
- Waste Types with counts
- Waste Records table
- Waste by Category
- Top Wasted Items
- Outlet Variance Table
- AI-style rule-based insights

Inventory Dashboard:

KPI cards:

- Inventory Value
- Low Stock Items
- Pending Requests
- Variance Risk
- Check Completion

Dashboard sections:

- Inventory Health by Outlet
- Smart Alerts
- Stock Check Groups summary
- Recent Movements

Shared Inventory layout:

- Inventory Control pages must not show the repeated global banner `Daily F&B stock operations workspace`.
- Page-level filters, KPI cards, and operational summaries remain only when they are useful to the current subpage.

Recipes & Usage:

Purpose:

Set up recipe BOMs by linking menu/product items to inventory ingredients for future usage and variance estimation.

Recipe fields:

- id
- outlet_id
- recipe_code
- recipe_name_en
- recipe_name_cn
- menu_category
- recipe_photo_url
- selling_price
- serving_size
- status
- notes
- created_by
- created_at
- updated_at

Recipe item fields:

- id
- recipe_id
- inventory_item_id
- quantity_used
- unit
- wastage_percent
- remark
- created_at
- updated_at

Rules:

- Recipes are outlet-scoped.
- Recipe naming uses `recipe_code`, `recipe_name_en`, and `recipe_name_cn` as the canonical UI/integration fields. New recipe forms require all three fields. Current staging schema still has a legacy `inventory_recipes.recipe_name` NOT NULL dependency from the original table, so create/update writes mirror `recipe_name = recipe_name_en` as a temporary compatibility bridge until the final schema migration removes the legacy requirement.
- `recipe_code` is the unique operational identity for recipes and is the primary identity shown in Menu Engineering Matrix and future integrations.
- Add/Edit Recipe validates `recipe_code`, `recipe_name_en`, `recipe_name_cn`, positive Selling Price, and ingredient rows inline with touched/submit-attempt timing. Fresh blank ingredient rows do not show red errors until the quantity field is touched or Save Recipe is clicked. Duplicate `recipe_code` is checked on blur and again before submit with request-id guarding so stale async checks cannot show a duplicate error after a successful save; duplicate codes block saving and show `Recipe code already exists.`
- Recipe duplicate-code validation must suppress duplicate display while a successful create/update is saving and closing. The known race was post-save list refresh self-matching: the newly inserted recipe entered `existingRecipes` before the create modal unmounted, while the form still had no `id`. The modal now marks duplicate validation as saving/closing and clears/cancels pending duplicate setters during that window.
- Legacy recipes with only `recipe_name` are migrated by copying that value into `recipe_name_en` and assigning a `LEGACY-...` recipe code. Recipes with blank `recipe_name_cn` require manual cleanup before they are considered fully standardized.
- Future Product Analytics recipe matching priority is: `recipe_code`, then `recipe_name_en`, then `recipe_name_cn`.
- Recipes & Usage does not expose an All Outlets aggregate filter. The outlet filter is required, defaults to the first accessible outlet, and contains only individual accessible outlets.
- Add Recipe uses the currently selected Recipes & Usage outlet filter as its outlet context; the Add/Edit Recipe modal does not ask for outlet again.
- Add/Edit Recipe follows the operator workflow: Recipe Identity (`recipe_code`, `recipe_name_en`, `recipe_name_cn`, Menu Category, Status), Commercial Information (Selling Price, Serving Size/Yield, live Recipe Cost, Profit, and Margin %), Product Display (Recipe Photo and Notes), then Ingredients as the primary working area.
- Menu Category Settings supports create, edit, archive, and sort for `inventory_menu_categories`; active menu categories populate recipe forms and filters.
- Recipe ingredient selectors only show active inventory items linked to the selected outlet.
- Multiple ingredients are supported per recipe.
- Unit follows the selected inventory item unit.
- Recipe photo upload stores a public photo URL in `inventory_recipes.recipe_photo_url` and recipe list rows display a thumbnail when available.
- Recipe Detail uses a hero layout instead of a full-width banner: desktop shows a 240 × 240 square recipe photo with `object-fit: contain` beside recipe identity, cost, price, margin, and status metrics; mobile uses a full-width 1:1 photo area with metrics below. Missing images show `No recipe photo`.
- Ingredient rows show Inventory Item, Qty Used, Unit, Unit Cost, Wastage %, Total Cost, and Remark. The Ingredients section shows a running total while editing and a footer Total Recipe Cost with ingredient and wastage breakdowns.
- Unit Cost reads from `inventory_items.cost`; Total Cost is `Qty Used × Unit Cost`.
- Recipe Summary calculates Ingredient Cost, Estimated Wastage Cost, Total Recipe Cost, Selling Price, Profit, and Margin % in real time.
- Recipe Costing Dashboard shows Total Recipes, Average Recipe Cost, Average Margin, and Highest Cost Recipe above the recipe list; these KPIs are always calculated within the selected single-outlet scope.
- Recipes & Usage is organized into setup tabs only: Recipes and Product Mapping. The default tab is Recipes so the Recipe BOM table stays focused, and Product Mapping stays close to recipe setup work.
- Product Mapping uses three states: Pending, Mapped, and Ignored. Pending means a Product Analytics product has no mapping decision; Mapped links the product to a recipe; Ignored intentionally excludes non-recipe POS items such as Staff Meal, Voucher, Manual Adjustment, or POS Correction from Recipe Intelligence.
- Product Mapping decisions persist in `product_recipe_mappings`. `status = mapped` requires `recipe_id`; `status = ignored` stores `recipe_id = null` plus ignored metadata. Pending products have no mapping row. Old mapped products remain mapped automatically, ignored products stay ignored after refresh, and newly imported Product Analytics product names appear as Pending.
- Product Mapping rows use a compact management table: Product, Sales, Suggested Match, Status, Recipe Mapping, and Action. Sales combines latest period, quantity sold, and net sales. Product rows show Last Seen and an Activity Status where Active means the product was seen within the last three selected reporting months; Inactive means it has not appeared recently.
- Product Mapping lifecycle is durable. If a product disappears from the latest Product Analytics month, its Pending, Mapped, or Ignored decision remains visible through the existing mapping record and Last Seen date. If the product returns in a later import, the saved mapping decision is reused automatically.
- Product Mapping Health uses Total Products, Mapped, Pending, Ignored, and Coverage %. Coverage is calculated as `Mapped / (Mapped + Pending)`, so Ignored products do not reduce coverage.
- Recipe Intelligence is a standalone Inventory Control page at `#recipe_intelligence` because it is management analytics work, not recipe setup work. It uses `recipe_intelligence.view` for page access and `recipe_intelligence.manage` for Product Mapping decisions, while recipe BOM setup remains under Recipes & Usage permissions.
- Recipe Intelligence page filters are Outlet, Month, and Year. The monthly management tables use this exact selected month/year: Top Gross Profit Recipes and Top 10 Ingredient Consumption titles include the selected month label, and their quantities/revenue/ingredient usage are calculated only from Product Analytics rows for that month.
- Recipe Mapping Health uses a wide card with Coverage %, Mapped Recipes, Pending Products, Products / Recipes count, guidance copy, and a progress bar. It should guide operators to map more products before relying on menu insights.
- Menu Engineering Matrix uses Product Analytics as its only sales data source. X axis is Product Analytics Qty Sold, Y axis is recipe Margin %, and bubble size is Product Analytics Revenue / Net Sales. The chart uses dynamic average Qty Sold and average Margin % as quadrant split lines for Star, Puzzle, Workhorse, and Dog categories. Bubble tooltips show Recipe, Qty Sold, Revenue, Cost, Price, Profit, and Margin %. The matrix chart is hidden until at least 10 mapped recipes exist, then shows a locked/warming-up state with `Need at least 10 mapped recipes.` and the number of additional mappings needed.
- Recipe Intelligence includes a Recipe Insights panel beside the matrix when reliable mapped data exists. Insights use gross profit contribution, low-margin high-volume items, high ingredient cost drivers, ingredient demand changes, and mapping coverage warnings; low-coverage or unavailable data shows guidance rather than fake recommendations.
- Recipe Intelligence matching foundation uses `product_recipe_mappings` for future explicit mapping. Until explicit mapping UI is built, mapping health compares Product Analytics product names against recipes by `recipe_code`, then `recipe_name_en`, then `recipe_name_cn`.
- Recipes & Usage includes a Product Mapping tab that lists Product Analytics products, suggests recipe matches using `recipe_code`, then `recipe_name_en`, then `recipe_name_cn`, shows High/Medium/Low confidence, and lets operators Map, Change Mapping, Unmap, Ignore, or Restore to Pending. Ignored products are persisted and excluded from Recipe Intelligence.
- Recipe Intelligence uses these final sections: Recipe Mapping Health, Menu Engineering Matrix + AI Recipe Insights, Recipe Gross Profit Trend, Top Gross Profit Recipes, Ingredient Demand Forecast, Top 10 Ingredient Consumption - Monthly, and Ingredient Cost Trend. The old repeated Top Margin Products, Lowest Margin Products, Top Revenue Recipes, Highest Cost Ingredients, and Recipe Cost Composition cards are not used.
- Ingredient analytics are based only on mapped Product Analytics products. Estimated ingredient usage is `Product Analytics Qty Sold × Recipe BOM Qty Used`, aggregated by ingredient. Top 10 Ingredient Consumption displays Ingredient, Category, Estimated Usage, UOM, Unit Cost, and Total Cost sorted by Total Cost descending by default for the selected Month + Year, with View All search/category/sort controls in the card header.
- Ingredient Demand Forecast uses an internal Last 3 Months average monthly estimated usage for now. Forecast Cost is `forecast_usage × unit_cost`; change indicators are shown only when comparable period data is available.
- Recipe Gross Profit Trend and Ingredient Cost Trend each have an in-card year selector and always render Jan-Dec for that year with month-only axis labels (`Jan`, `Feb`, ... `Dec`). Missing months render as zero so operators can compare full-year seasonality. The visible Month + Year filters control the monthly Matrix, Top Gross Profit Recipes, and Top 10 Ingredient Consumption cards.
- Yearly Recipe Intelligence trend charts use the modern FeedX chart treatment: smooth thin line, subtle gradient area fill, soft grid, compact y-axis labels, circular fixed-size points, muted zero-month markers, peak-month emphasis, and glass-style hover tooltips.
- Ingredient Cost Trend shows monthly estimated ingredient cost, not quantity. It defaults to the top five ingredients by total estimated cost for the selected year, supports ingredient typeahead search, can sort selectable ingredients by Total Cost, Usage, or Growth %, and allows selecting/removing up to five compact ingredient chips with growth badges. Tooltips are simplified to Month, Ingredient, and Estimated Cost only. The chart does not show a duplicate legend below the plot because selected chips are the active legend, and its footer uses a Top Cost Driver KPI card.
- Recipe Gross Profit Trend calculates monthly gross profit as `qty_sold × (selling_price - recipe_cost)`, shows current-year total gross profit, best month, average monthly gross profit, and a peak-month insight footer. Top Gross Profit Recipes ranks recipes by total gross profit and shows Qty Sold, Revenue, Gross Profit, and Margin %. POS/sales-dependent charts show empty or locked guidance when Product Analytics ↔ Recipe Mapping is unavailable; no fake sales data is generated.
- Recipe list columns are Recipe, Category, Ingredients, Estimated Cost, Selling Price, Margin, Status, and Actions. Recipe rows display `recipe_code` first, `recipe_name_en` as the primary bold name, `recipe_name_cn` as secondary muted text, then outlet name and serving size.
- Recipe BOM table ingredient counts use a FloatingLayer/portal preview so the preview is not clipped by table or card overflow. Hover/focus shows the preview on desktop; tap opens it on mobile/touch and outside click closes it.
- Ingredient preview shows up to five ingredient lines in `Ingredient name · Qty UOM · Cost` format, then `+N more` when additional ingredients exist.
- Recipe exports include `recipe_code`, `recipe_name_en`, and `recipe_name_cn`.
- Margin % is `((Selling Price - Estimated Cost) / Selling Price) × 100`; badges are green at 70%+, amber at 40%-69%, and red below 40%.
- Add Recipe writes to `inventory_recipes` and `inventory_recipe_items`; success is shown only after Supabase confirms the recipe and ingredient rows.
- Edit Recipe updates the recipe row and replaces its ingredient snapshot rows in `inventory_recipe_items`.
- Archive Recipe sets `inventory_recipes.status = inactive`; inactive recipes are hidden from the default Active filter but remain available for audit/history when filtering by status.
- Quantity Used must be greater than zero and Wastage % must be zero or greater.
- Recipe management actions require `inventory_recipes.manage`; view and export use `inventory_recipes.view` and `inventory_recipes.export`.
- Recipes & Usage supports Add Recipe, View, Edit, Archive, Export, outlet/category/status/search filters, and empty state action.
- Usage estimation foundation: `product_sales_quantity × recipe_ingredient_quantity = estimated_inventory_usage`.
- Full POS/product sales integration is future scope; current page prepares the BOM structure.

Empty states:

- No inventory item: `Create your first inventory item to start stock tracking.`
- No stock group: `Set up stock check groups so outlets know what to count.`
- No due check: `No stock check required today.`
- No request: `No stock requests submitted yet.`
- No movement: `Inventory movement history will appear here.`
- No recipes: `Create recipes to connect menu items with inventory ingredients and estimate future usage variance.`

RBAC and outlet scope:

- All Inventory Control pages use configurable Role & Permission.
- No Inventory Control workflow may hardcode role names such as Outlet Staff, Outlet Manager, or HQ Admin.
- Owner/admin can access all outlets.
- Custom roles can only view and act on assigned outlets.
- Service-layer queries and RLS policies must enforce outlet scope, not just UI filters.

---

## 5.13B Factory Workspace

Purpose:

Factory Workspace is a separate FeedX operational workspace for factory production and warehouse processes. It is intentionally separate from Restaurant Inventory Control so outlet-facing stock operations do not mix with factory raw material, finished goods, SOP, and production planning workflows.

Workspace behavior:

- Restaurant is the default workspace.
- Factory is selected through the sidebar workspace switcher.
- Switching workspace changes sidebar modules and default route only.
- Permissions remain centralized in `config/modules.ts`.
- Routes remain hash-based module IDs, for example `#factory_dashboard`, `#factory_job_orders`, and `#factory_raw_receiving`.
- Factory modules use Supabase persistence only; no local/demo operational data is used.

Factory Phase 1A implemented scope:

- Workspace switcher: Restaurant / Factory.
- Factory Dashboard UI.
- Job Orders CRUD.
- Raw Material Receiving CRUD.
- Raw material receiving uses Raw Material Master records as the valid material source.
- Raw material receiving adjusts raw material balance.
- Raw material receiving creates raw material movement history.
- Audit logs are written for business-critical job order and raw receiving actions.

Factory Phase 1B implemented scope:

- Factory production follows the MES-style sequence: Product Recipe standard BOM -> Job Order draft -> Release Job Order -> Start Production -> Complete Production -> inventory movements and batch traceability.
- Production execution starts from a released Factory Job Order.
- A Factory Job Order is a production planning task, not an actual production result.
- New Factory Job Orders must select an active Packaging SKU from `factory_finished_goods`.
- `factory_job_orders.finished_good_id` remains the compatibility reference to the Packaging SKU inventory record.
- Job Orders store `finished_good_id`, `target_pack_qty`, `target_production_qty`, `target_quantity`, `uom`, `planned_date`, `due_date`, `priority`, `assigned_team`, `status`, `remarks`, release metadata, start metadata, and completion metadata.
- Target Pack Qty is the business planning input. Target Production Qty is auto-calculated from Packaging SKU pack size using supported g/kg and ml/L conversions.
- Job Order references are generated in the database through `factory_create_job_order(...)` using the business format `JOYYMMDD-001`; reference generation is protected by an advisory transaction lock.
- Job Order lifecycle statuses are `draft`, `released`, `in_progress`, `completed`, and `cancelled`. Legacy `planned` rows are mapped to `released`.
- Packaging SKU master data is the valid SKU source for production planning; new Job Orders must not rely on free-text product names when Packaging SKUs exist.
- Archived Packaging SKUs cannot be selected for new Job Orders.
- Completed and cancelled Job Orders are operationally closed; only remarks should be changed after closure.
- Production Records represent actual execution/completion.
- Draft Job Orders can be edited or deleted. Released Job Orders can be started. In Progress Job Orders can be completed. Completed and cancelled Job Orders are read-only.
- Production Records list ready Job Orders with `released` and `in_progress` statuses.
- Start Production captures only production start context: selected Job Order summary, operator, production date, start time and remarks. Start Production does not create inventory movement.
- Production completion starts from an In Progress Job Order and auto-fills Packaging SKU, parent Finished Good, target pack quantity, target production quantity, UOM, and available Recipe/SOP reference by product.
- Production completion captures batch number, production date, operator, start time, end time, actual pack quantity, actual output quantity, wastage quantity, QC status and notes.
- Production material usage captures raw material, standard usage, actual usage, variance quantity, variance percent and variance reason.
- Actual material usage is the source of truth for raw material deduction.
- Product Recipe remains the standard BOM only and is never overwritten by actual production usage.
- Production material usage defaults from the active Product Recipe BOM at the time the completion modal is opened; Phase 1 does not persist a frozen Job Order BOM snapshot.
- Frozen Job Order BOM snapshots are planned for Phase 2 when recipe-version locking is required between Job Order release and completion.
- Variance reason is required whenever actual material usage differs from standard usage, using a small numeric tolerance for rounding.
- Completing production creates:
  - `factory_productions` completed production record.
  - `factory_production_material_usage` actual usage and variance records.
  - `factory_raw_material_movements` deduction rows using actual usage.
  - raw material balance deductions through `factory_adjust_raw_material_balance(...)`.
  - finished goods balance increase for the selected active Packaging SKU in pack units.
  - `factory_product_stock_movements` finished goods stock-in row.
  - Factory Job Order status update to `completed`.
- Production completion must stock-in to the Packaging SKU linked to the selected Job Order and must not stock-in to a free-text product.
- Production completion must not auto-create Packaging SKUs. A Packaging SKU must be created and active before production stock-in.
- Production dashboard and activity cards include completed production, good output and high-variance usage signals.

Factory Phase 1C implemented scope:

- Raw Material Stock Check working page and workflow.
- Finished Goods Stock Check working page and workflow.
- Stock check rows capture system quantity, physical count, variance quantity and variance percent.
- Stock check variance status is calculated independently from production recipe variance:
  - `Normal`: absolute variance percent is less than or equal to 2%.
  - `Warning`: absolute variance percent is greater than 2% and less than or equal to 5%.
  - `Critical`: absolute variance percent is greater than 5%.
- Variance reason is required for Warning and Critical stock check rows.
- Stock check lifecycle is Draft, Submitted, Approved.
- Draft and Submitted stock checks must not adjust inventory balances.
- Only Approved stock checks create inventory adjustments.
- Approved Raw Material Stock Check creates raw material balance adjustments and `factory_raw_material_movements` rows.
- Approved Finished Goods Stock Check creates finished goods balance adjustments and `factory_product_stock_movements` rows.
- Stock Check variance is separate from Recipe Variance and must not modify Factory Product Recipes.
- Stock Check variance must not modify Production Actual Usage or production material usage records.
- Factory Dashboard includes stock check variance alerts and submitted stock checks awaiting approval.
- Recent Factory Activity includes stock check submitted and approved events.

Factory Phase 1D implemented scope:

- Production SOP management working page.
- SOPs are product-scoped standard process references with version, status, effective date, notes and default equipment.
- SOP steps capture Step No, Process Name, Description, Control Point, Materials, Equipment and Estimated Time.
- SOP steps can be flagged as QC checkpoints.
- SOP is a standard process reference and is not an actual production result.
- Actual production can reference the SOP version used through `factory_productions.production_sop_id` and `factory_productions.sop_version`.
- Production completion can capture raw material receiving lot references for actual material usage rows.
- Raw material lot usage is stored on `factory_production_material_usage` and remains part of actual production traceability.
- QC checkpoints are recorded separately from stock check through production QC checkpoint snapshots.
- When production references an SOP, flagged SOP QC checkpoint steps are copied to production-specific `factory_production_qc_checkpoints` rows.
- Batch traceability connects:
  - Batch No.
  - Product.
  - Job Order.
  - Production date.
  - Operator.
  - Raw material lots used.
  - Finished goods stock-in movement.
  - SOP version used.
  - QC status and production QC checkpoints.
- Factory Dashboard includes quick alerts for batches with Pending, Hold, or Failed QC status.
- Batch traceability must not modify Recipe, SOP, stock check or Production Actual Usage records; it is a connected read view over production data.

Factory Phase 1E implemented scope:

- Factory Reports working page through `factory_production_reports`.
- Batch Traceability working page through `factory_batch_traceability`.
- Production Summary Report.
- Raw Material Usage Report.
- Recipe Standard vs Actual Usage Report.
- Production Yield Report.
- Finished Goods Stock Movement Report.
- Basic production cost calculation foundation:
  - Raw material actual usage cost.
  - Cost per batch.
  - Cost per finished unit.
- Costing uses Actual Usage, not Standard Recipe.
- Recipe cost remains a standard reference and is not overwritten by production reports.
- Actual production cost is calculated as actual material usage multiplied by recorded receiving unit cost when available; otherwise latest available receiving unit cost for the raw material is used.
- If no recorded or latest receiving cost exists for a usage row, Factory reports show Missing Cost where possible until a valid cost source is available.
- Material variance dashboard/report totals are usage-row summaries; mixed UOMs should be reviewed by material/UOM before operational decisions.
- Factory Dashboard analytics cards include Production Yield %, Material Variance %, Estimated Production Cost, and Top Variance Raw Materials.
- Factory Reports are read-only.
- Factory Reports must not adjust stock.
- Factory Reports must not modify Recipe, Production, Stock Check, or SOP records.

Factory Finished Goods Master and Warehouse implemented scope:

- Finished Goods is a functional Packaging SKU management and warehouse page through `factory_finished_goods`.
- User-facing Finished Goods uses the model Finished Good -> Packaging SKUs.
- Internally, Finished Good parent records are stored in `factory_product_families` with Name EN/CN/BM, category, status and remarks.
- Finished Goods displays Finished Good -> Packaging SKUs instead of one flat SKU table, making product identity and inventory SKUs visually distinct.
- Finished Good rows show Finished Good, Category, SKUs, Total Base Balance, Status and actions for Add Packaging SKU, Edit Finished Good and Archive Finished Good.
- Packaging SKU rows show SKU, Variant, Pack Size, Balance, Active Production Standard, Status and actions for View SKU, Edit SKU and Archive SKU.
- Packaging SKU setup supports Create, Edit and Archive.
- Packaging SKU fields include Finished Good context, SKU Code, Packaging Variant, Pack Size Qty/UOM, Storage Location, Active/Archived status and Remarks.
- Finished Good / Packaging Variant examples include Black Pepper Sauce -> BPS-1KG / BPS-2KG / BPS-5KG.
- Finished Good SKU records remain the inventory unit. Each packaging variant still tracks stock separately through its own `factory_finished_goods.id`.
- Existing Packaging SKU records can have no internal parent initially; they remain compatible and display as their own Finished Good row using the SKU product name.
- Base Qty/Base UOM remain internal future conversion fields for Phase 2 bulk production and packaging conversion. In Phase 1 they are auto-set from Pack Size and are not exposed in the user-facing Packaging SKU form.
- Finished Goods must not maintain user-facing min stock thresholds; raw material inventory remains the stock-planning control point.
- Product Name EN is the canonical production stock-in name and is mirrored to `factory_finished_goods.product_name` for existing production matching.
- Finished Goods category selection must use a searchable FeedX-style selector, show "Select Category" before selection, and require a category before save.
- Finished Good Category setup supports Create, Edit and Archive through `factory_finished_good_categories`.
- Finished Good Categories must be managed inside the Category modal/drawer only, not as a main-page table.
- Category fields include Category Name, Description and Active/Archived status.
- Finished Goods grouped listing keeps current balance, batch, production and movement visibility at Packaging SKU level.
- Finished Goods filters support Product, Finished Good, Category, Status, Batch and Movement Type where relevant.
- Finished Goods dashboard cards show Finished Goods, Packaging SKUs, Active Recipes and Out of Stock SKUs.
- Finished Goods warehouse insight panels include Stock Distribution by Product, Top Produced Products for the last 30 days, Production In vs Stock Out movement summary, and Batch Count/latest batch where stock movement data is available.
- Finished Goods detail shows current balance, production history, movement history, batch history and actual-cost summary when cost data is available.
- Finished Goods archive is blocked while current balance is greater than zero and must show: "Cannot archive while stock balance is greater than zero."
- Production completion can stock-in only to active Finished Goods master products.
- Finished Goods empty state must say: "Create a finished good product before production stock-in."
- Product Movements is a functional read-only movement history page through `factory_product_movements`.
- Product Movements shows movement type, product, quantity, batch/source context, date and source.
- Warehouse filters support product, status, batch and movement type where relevant.
- Finished Goods and Product Movements must not create duplicate stock balance logic.
- Product Movements remains read-only and uses `factory_product_stock_movements` and production header history for context.

Factory form UX standard:

- Factory data-entry forms use normal-case FeedX operational labels such as "Category *", "SKU Code *", and "Product Name (EN)".
- Factory form labels use 10.5px, 600 weight, `rgb(107, 114, 128)`, Title Case, and normal letter spacing.
- Factory form labels must not use KPI-style uppercase or tracked letter spacing. KPI/card and table header treatments remain separate from form labels.
- Factory create/add action buttons should use semantic lucide icons instead of a generic leading plus icon.

Factory Raw Material Master and Inventory implemented scope:

- Raw Material Inventory is a functional master-plus-inventory page through `factory_raw_inventory`.
- Raw Material Master setup supports Create, Edit and Archive.
- Raw Material create/edit uses a simple single-column form.
- Raw Material form fields include Category, SKU Code, Raw Material Name EN, Default UOM, Storage Location, Active/Archived status and Remarks.
- Raw Material Name CN, Raw Material Name BM and Min Stock Level may remain in the schema for compatibility, but they are not shown in the Raw Material user-facing form.
- Preferred Supplier is not shown in the Raw Material user-facing form.
- Raw Material and Finished Good master forms show inline required-field errors, scroll/focus to the first invalid field, and show a compact footer helper when required fields are missing.
- Raw Material Name EN is the canonical material name and is mirrored to `factory_raw_materials.name` for existing production/report matching.
- Raw Material category selection must use a searchable FeedX-style selector, show "Select Category" before selection, and require a category before save.
- Raw Material Storage Location must use the Factory Storage Locations selector for new records instead of free-text location entry.
- Raw Material Category setup supports Create, Edit and Archive through `factory_raw_material_categories`.
- Raw Material Categories must be managed inside the Category modal/drawer only, not as a main-page table.
- Raw Material Inventory listing shows Product Name EN/CN/BM equivalent raw material names where available, raw material code, category, UOM, current balance, min stock, last receiving date, last consumption date, status, stock status and actions.
- Raw Material Inventory dashboard cards show Total Raw Materials, Total Stock Qty, Low Stock Items and Out of Stock Items.
- Raw Material Inventory insight panels include Low Stock List, Recent Receiving, Recent Consumption and Can Produce Estimate when active Product Recipe data is available.
- Raw Material detail shows current balance, receiving history, consumption/movement history, stock check history, latest unit cost and supplier cost trend when receiving cost data is available.
- Raw Material archive is blocked while current balance is greater than zero and must show: "Cannot archive while stock balance is greater than zero."
- Raw Material Receiving must select an active Raw Material Master record and must not allow free-text raw material stock-in when master records exist.
- Raw Material Receiving uses a page-based two-tab workflow: Receiving History and Receive Raw Material.
- Receiving History summarizes receiving documents by Received Date, Reference No., Supplier, Items Count, Total Qty, Created By and View Details action.
- Receive Raw Material records one supplier delivery document with a batch/header row and multiple receiving item rows.
- Receiving header required fields are Supplier and Received Date. Reference No. replaces the previous Invoice No. wording.
- Receiving item required fields are Raw Material, Qty and UOM.
- Receiving defaults UOM and storage location from the selected Raw Material where available, but receiving UOM and storage location remain editable for operational receipt differences.
- Receiving validation shows per-row inline field errors, scroll/focuses to the first invalid field and shows a compact footer/table helper when required fields are missing.
- Raw Material Receiving no longer asks for or displays Unit Cost or Total Cost in the receiving entry flow. Existing cost columns remain schema-compatible for historical/reporting data.
- New receiving documents must select an active Factory Supplier from the Factory Suppliers master; free-text supplier entry is not used for new receiving documents.
- Multi-row receiving save must use the `factory_save_raw_material_receiving_batch` RPC so the receiving batch header, all receiving item rows, raw material balance updates and raw material movement logs are committed atomically or rolled back together.
- Product Recipe BOM and Production material usage must select active Raw Material Master records where possible.
- Production actual usage remains the source of raw material stock deduction.
- Raw Material Master and Inventory must not create duplicate stock balance logic; balances remain updated by receiving, production actual usage and approved stock check adjustments through existing movement/balance helpers.

Factory Storage Locations implemented scope:

- Storage Locations is a functional Factory System page through `factory_storage_locations`.
- Storage Location setup supports Create, Edit and Archive.
- Storage Location fields include Location Name, Location Code, Location Type, Active/Archived status and Remarks.
- Location Type examples include Dry Store, Chiller, Freezer, Production Area, Finished Goods Area and Packaging Area.
- Raw Material and Finished Goods master forms can select active Storage Locations.
- Raw Material Receiving uses the managed Storage Location selector while preserving the receiving row's stored location text for receipt history.
- Archived Storage Locations remain readable but cannot be selected for new active master setup.

Factory Suppliers implemented scope:

- Suppliers is a functional Factory System page through `factory_suppliers`.
- Supplier setup supports Create, Edit and Archive.
- Supplier fields include Supplier Name, Supplier Code, Contact Person, Phone, Email, Active/Archived status and Remarks.
- Raw Material Receiving supplier selection uses active Factory Suppliers only.
- Archived Factory Suppliers remain readable on historical receiving documents but cannot be selected for new receiving documents.
- Factory Suppliers are separate from Restaurant/Inventory supplier modules.

Factory Product Recipes implemented scope:

- Product Recipes is a functional Factory Master Data page through `factory_product_recipes`, presented to users as Production Standards / BOM.
- Production Standards define the standard output Production Quantity, optional Estimated Production Time, and raw material BOM for parent Finished Good production.
- New Production Standards select the parent Finished Good concept, stored internally through `factory_product_recipes.product_family_id`.
- Legacy Production Standards tied to a Packaging SKU through `finished_good_id` remain readable and usable for compatibility.
- Phase 1 Job Orders and Production still stock into a selected Packaging SKU. Phase 2 will support bulk product production with packaging split into multiple Packaging SKUs.
- Recipe Code remains an internal generated identifier and is not edited in the create/edit UI.
- New standards start at version `v1`; users cannot manually type version values.
- New Version creates a draft copy of the selected standard and auto-increments the version to `v2`, `v3`, `v4`, and so on.
- Header fields include Finished Good, Production Standard Name, Version, Production Quantity, UOM, Estimated Production Time, status display and Remarks.
- BOM material rows are stored in `factory_product_recipe_items` and capture Raw Material, Required Qty, UOM, Wastage %, Remarks and Sort Order.
- One parent Finished Good can have only one active standard version at a time when `product_family_id` is available.
- Draft standards can be edited; active and archived standards remain readable for history.
- Activating a standard makes it the production material-usage default for that Finished Good.
- Archiving a standard removes it from production defaults but preserves history.
- The Product Recipes list shows Finished Good, Version, Production Quantity, Material Count, Status, Updated Date and Actions.
- Clicking a standard row opens a detail view with Production Quantity, Estimated Production Time and BOM materials.
- Production completion from a Job Order looks for the active recipe linked to the selected Packaging SKU's parent Finished Good first, then falls back to legacy SKU-linked standards.
- If an active recipe exists, Production material usage rows are prefilled from recipe materials.
- Standard usage defaults scale from the standard Production Quantity to the Job Order target or actual output quantity; Actual Usage defaults to Standard Usage but remains editable by staff.
- Actual Usage remains the source of raw material stock deduction.
- Product Recipe remains the standard reference only and must not be modified by production completion or actual usage variance.
- If no active recipe exists, Production shows: "No active recipe found. Add material usage manually or create a Product Recipe first."
- Existing production usage validation still requires at least one actual material usage row before completion.
- Factory costing/reporting uses active Product Recipe BOM rows as the standard recipe source while actual production cost remains based on actual material usage.

Factory Phase 1F implemented scope:

- Recipe costing and raw material cost history foundation inside Factory Reports and Factory Dashboard analytics.
- Product Recipe Cost Rollup.
- Standard Recipe Cost based on recipe item quantities, wastage allowance and latest raw material receiving cost.
- Actual Production Cost comparison against the Phase 1E actual usage cost.
- Raw Material Cost History from receiving records.
- Supplier Cost Trend by raw material.
- Cost variance reporting:
  - Standard Cost.
  - Actual Cost.
  - Variance RM.
  - Variance %.
- Factory Dashboard cost cards:
  - Highest Cost Increase Material.
  - Most Expensive Product Recipe.
  - Actual vs Standard Cost Variance.
- Factory Reports cost sections:
  - Recipe Costing Report.
  - Raw Material Cost Trend Report.
- Standard recipe cost is a reference cost only.
- Actual production cost remains based on actual material usage.
- Cost reports are read-only.
- Costing must not modify recipe, production, receiving or stock records.
- If latest receiving cost is missing, Factory cost reports show Missing Cost where possible instead of treating the row as RM0.

Factory sidebar modules:

- Factory Dashboard
- Job Orders
- Production Records
- Production Reports
- Batch Traceability
- Finished Goods
- Product Movements
- Product Stock Check
- Raw Material Receiving
- Raw Material Inventory
- Raw Material Stock Check
- Product Recipes
- Production SOP
- Storage Locations
- Suppliers
- Factory Audit Logs
- Factory Settings

Current functional Factory modules after Raw Material Master optimization:

- Factory Dashboard.
- Job Orders.
- Production Records.
- Production Reports / Factory Reports.
- Batch Traceability.
- Finished Goods.
- Product Movements.
- Product Stock Check.
- Raw Material Receiving.
- Raw Material Inventory.
- Raw Material Stock Check.
- Product Recipes.
- Production SOP.
- Storage Locations.
- Suppliers.

Current registered Factory placeholder modules:

- Factory Audit Logs.
- Factory Settings.

Placeholder modules remain registered for navigation, permissions, route protection and audit scope. Their pages must show a clear placeholder message until the working workflow is implemented.

Factory data loading rule:

- Factory pages should load only datasets needed for the active tab wherever possible.
- Optional or permission-blocked datasets should fail softly with an empty state or scoped warning.
- A role with `factory_dashboard.view` only must be able to load Factory Dashboard without unrelated stock check, SOP, or other module RLS failures crashing the page.
- Owner/Admin are protected roles and must resolve as full Factory access in both frontend permission checks and Supabase RLS.
- Supabase `current_user_has_permission()` must recognize protected Owner/Admin roles case-insensitively from both employees-linked identities and legacy `user_profiles` identities.
- Normal custom roles must continue to rely on explicit `role_permissions`; protected-role bypass must not weaken RLS for custom roles.
- Factory permission seeding for Owner/Admin must use case-insensitive role-name matching for `factory_%` permission codes.

Factory data model foundation:

- `factory_job_orders`
- `factory_productions`
- `factory_production_material_usage`
- `factory_production_qc_checkpoints`
- `factory_raw_materials`
- `factory_raw_material_receivings`
- `factory_raw_material_movements`
- `factory_finished_good_categories`
- `factory_finished_goods`
- `factory_product_stock_movements`
- `factory_product_stock_checks`
- `factory_product_stock_check_items`
- `factory_raw_material_stock_checks`
- `factory_raw_material_stock_check_items`
- `factory_product_recipes`
- `factory_product_recipe_items`
- `factory_production_sops`
- `factory_production_sop_steps`

Factory RLS and permissions:

- Factory permissions use module-action codes such as `factory_job_orders.view` and `factory_raw_receiving.create`.
- Owner and Admin receive Factory permissions by default through migration seed.
- Custom roles must be assigned Factory permissions through Roles & Permissions.
- Factory tables enforce RLS through `current_user_has_permission(...)`.

Current Factory exclusions after Phase 1E:

- Finished goods receipt and shipment workflow.
- Product recipe BOM editor.
- Full QC result editing/checklist completion workflow beyond checkpoint snapshots and batch QC status.
- Advanced Factory analytics beyond Phase 1E read-only report foundations.

## 5.14 Outlets

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

## 5.14 Module-Level Imports

Purpose:

Import workflows live inside their owning modules instead of a centralized Data Import page.

Active module imports:

- Sales Input -> Import Sales
- Purchase Input -> Import Purchase
- Master Inventory -> Import
- Asset Tracking -> Import

The centralized Data Import navigation item is removed from active sidebar and role catalog scope. The underlying import tables and utility code remain available for module-level workflows.

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

Import history:

- Sales Input shows sales-only import batches.
- Purchase Input shows purchase-only import batches.
- Import batch rows remain available for row-level validation history.

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

Notification Center rules:

- The AppShell notification dropdown uses structured frontend notifications with `id`, `type`, `category`, `severity`, `title`, `description`, `moduleKey`, `outletId`, `actionLabel`, `actionRoute`, `createdAt`, and local `isRead` state.
- Notification categories are `Alerts`, `Tasks`, `Insights`, and `Data Health`; severity values are `critical`, `high`, `medium`, and `info`.
- A notification is visible only when the user has permission to view or act on the related module, the notification outlet is within the user's outlet scope, and the notification matches the user's role responsibility.
- Owner/admin users can see all permission-allowed notifications across all accessible outlets.
- Accounts users should see purchase drafts, supplier purchase anomalies, sales/purchase import issues, operating expenses, finance-oriented data health issues, and draft rows before month lock when their permissions allow those modules.
- Managers should see assigned-outlet operational alerts such as stock checks due/overdue, purchase suggestions pending, waste/variance alerts, asset maintenance due, inspections due, and duty roster gaps when their permissions allow those modules.
- Outlet staff should see assigned-outlet tasks such as stock checks, asset inspections, and waste reminders only when their permissions allow those modules; company-wide finance alerts are hidden unless finance/report permissions grant access.
- Notification read state is local for the current MVP and stored in localStorage by user/profile id until a Supabase notification table is introduced.
- Notification actions route to the related page and mark that notification as read.
- Current Supabase-backed notification sources include stock check groups/checks/items, purchase orders, waste records, asset maintenance, asset inspections, and employee access data; existing sales/purchase analytics continue to provide alert and insight candidates.

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
- employment_type
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

Employment Type:

- probation
- full_time
- part_time
- intern
- contract

Employment Status:

- active
- resigned
- terminated

System Access:

- enabled through `enable_system_login = true` plus a valid role/login setup state
- disabled through `enable_system_login = false` or `access_state = disabled`

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

- Employees KPI strip shows System Access, Access Active, and Active Employees. Access Disabled and Probation are not KPI cards.
- Upcoming Celebrations lives on the Employees page between the KPI strip and Employee Directory.
- Upcoming Celebrations reuses employee birthday logic for Next 30 Days, This Week, and Upcoming Birthdays.
- The Employees page celebration card must not show a View Employees navigation action because the user is already inside the Employees module.
- The celebration model is future-ready for birthdays and work anniversaries, but current production logic uses birthdays only.
- Employment Type is the employee classification only: Probation, Full-Time, Part-Time, Intern, or Contract.
- Employment Status is the HR lifecycle state only: Active, Resigned, or Terminated.
- System Access controls login only and must remain separate from Employment Type and Employment Status.
- New employees default to Employment Type `probation`, Employment Status `active`, System Access disabled, and no role.
- Disabling login blocks future app access but does not remove the employee record, alter employment history, or change Employment Status.
- Resigned and terminated employees keep their original Employment Type unless HR changes it explicitly.
- Employee records referenced by Stock Checks, Purchase Orders, Waste Records, Inventory Movements, Asset Inspections, Audit Logs, or Duty Roster History must never be deleted just to remove access.
- Historical actor displays must use nickname, then full_name, then email, then `Unknown User`; raw UUIDs must never be displayed.
- System access lifecycle is managed from the System Access panel, not with a profile-edit checkbox.
- HR profile edits must not accidentally reset login email, role, auth user id, last login, or access history.
- Access State `active` shows Disable Access and Change Login Email actions only; setup-link actions are hidden.
- Access State `no_access` shows Enable Access.
- Access State `not_sent`, `invited`, or expired/pending states show Send Login Setup, Generate Setup Link, and Disable Access.
- Disable Access sets access disabled while preserving login email, role_id, auth_user_id, last_login_at, employee profile, and historical records.
- Change Login Email is an explicit action. It changes the pending login email and requires the employee to complete setup again.
- System access state is generated from login lifecycle, not manually selected as an HR status.
- System Access OFF / no login means no_access.
- Enable Access with no setup email means not_sent.
- Send Login Setup changes state to invited.
- Successful password setup changes state to active and writes `employees.setup_completed_at`.
- Setup password links must redirect to `/setup-password`. They may create a temporary Supabase invite/recovery session, but that session must not enter the FeedX app while `access_state` is `not_sent` or `invited`. The auth guard must allow only the setup-password route until `supabase.auth.updateUser({ password })` and the `complete_employee_password_setup()` RPC both succeed.
- Disabled access changes state to disabled.
- Login, Forgot Password, Setup Password, and Reset Password share the FeedX auth visual system: desktop uses a minimal dark futuristic layout with a left brand/intelligence panel, a central holographic operations portal image asset (`public/holographic-ring.webp`) with subtle green glow, dark edge masking, light particle motion, and a right dark glassmorphism auth card. Mobile uses a compact brand header and keeps the form visible without excessive scrolling; the holographic visual may be hidden on small screens.
- Auth pages must not show dashboard mockups, bottom customer logo bars, duplicated logos inside the auth card, unsupported SSO buttons, or floating feature-module cards around the central visual.
- Auth pages must not show unsupported social login actions. Forgot/reset/setup flows keep the existing Supabase auth logic and only change visual presentation unless explicitly scoped otherwise.
- Employee workplace must be either a real outlet assignment or `Management`; it must never be `All Outlets`.
- `Management` is an HQ/management workplace label, not an outlet. It is stored as `employees.workplace = 'Management'` until the future `employees.outlet_id` migration, has no outlet id, and remains separate from role outlet access.
- Management employees appear in People directory and active People counts when `employment_status = active`, but they are excluded from outlet-specific roster staff lists unless explicitly supported later.
- People users with selected-outlet roles may only view, create, or update employees whose workplace matches an accessible outlet.
- Current implementation stores workplace as text and RLS maps outlet workplaces to `outlets.name` or `outlets.code`; future schema cleanup should migrate outlet employees to `employees.outlet_id` while preserving the `Management` non-outlet option.
- Employee department is derived from the selected Job Position during save so position and department do not drift.
- Migration `202605310009_employee_employment_structure.sql` adds `employees.employment_type`, remaps legacy mixed `employment_status` values into the new type/status structure, and records mappings in `employee_employment_structure_migration_report` for manual review where needed.

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
- Archive/inactive status is preferred when a position has historical usage.

Delete message:

```text
This position is assigned to employees. Reassign employees before deleting.
```

Modal behavior:

- One shared modal.
- Modal state uses one object only: open, mode and position.
- View mode: Close + Edit Position.
- Edit mode: Cancel + Save Position.
- Cancel returns to view mode.
- X closes entire modal.
- No stacked modal layers.
- Linked Employees display directly inside Job Position Detail.
- Linked Employees shows count plus compact employee rows with name, employment status, workplace, department and contact.
- If more than 5 employees are linked, the section expands inline with Show all.
- Job Position Detail must not open a separate linked employee modal or drawer.

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

Rules:

- Departments are global People master data.
- Archive/inactive status is preferred when a department has linked positions or employees.
- Hard delete is allowed only when the department has no active linked positions and no employees with Employment Status `active` linked directly or through positions.

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

Outlet filter behavior:

- Outlet access controls which outlets a role can see.
- Outlet filters control the current view within that visible outlet scope.
- `All Outlets` means access to every current outlet and every future outlet.
- `All Outlets` is stored explicitly on the role as `roles.outlet_access_type = 'all'`; it must not depend on `role_outlets` rows.
- Roles with `All Outlets` must see `All Outlets` plus each individual accessible outlet in outlet filters.
- `Selected Outlets` means access only to specifically selected outlets; future outlets are not included automatically.
- `Selected Outlets` is stored as `roles.outlet_access_type = 'selected'` plus specific rows in `role_outlets`.
- Roles with `Selected Outlets` must see `All Accessible Outlets` plus only the outlets assigned to that role.
- If all current outlets are selected under `Selected Outlets`, the role still does not receive future outlets automatically.

Display:

- Actual outlet chips for selected outlets.
- Do not show `Company-wide`, `Assigned outlets`, or `User-level`.

Permission UI:

- Wide permission matrix.
- Rows follow actual sidebar features.
- Columns follow available actions.

People UAT status:

- People Module UAT & Stabilization completed on 30 May 2026. Report: `FEEDX_PEOPLE_UAT_REPORT.md`.
- Result: Production Ready Candidate with live-account UAT caveat.
- Verified/stabilized modules: Employees, Job Positions, Departments, Roles & Permissions, and Employee Login Access.
- Critical fixes from the pass:
  - Employee workplace options are restricted to accessible real outlets.
  - Employee RLS is outlet-scoped by mapping workplace text to outlet name/code until a future `employees.outlet_id` migration.
  - Department hard delete blocks active linked positions and active employees.
  - Employee department is derived from the selected job position before save.
- Remaining People technical debt: migrate employee outlet assignment from `workplace` text to `outlet_id` and run live UAT with Owner/Admin, custom all-outlet, custom selected-outlet, and limited outlet staff roles.

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

Product Analytics:

- product_analytics.view
- product_analytics.upload
- product_analytics.export
- product_analytics.manage

Sales Comparison:

- sales_comparison.view
- sales_comparison.export

Purchase Comparison:

- purchase_comparison.view
- purchase_comparison.export

Alerts & Insights:

- alerts.view
- alerts.manage

Outlet Duty Roster:

- outlet_duty_roster.view
- outlet_duty_roster.export

### Sales

Sales Input:

- sales_input.view
- sales_input.create
- sales_input.edit
- sales_input.import
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
- purchase_input.import
- purchase_input.delete
- purchase_input.approve

Suppliers:

- suppliers.view
- suppliers.create
- suppliers.edit
- suppliers.delete

Supplier Categories:

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

Asset Tracking:

- asset_tracking.view
- asset_tracking.create
- asset_tracking.edit
- asset_tracking.delete
- asset_tracking.manage
- asset_tracking.export

### Inventory Control

Inventory Dashboard:

- inventory_dashboard.view

Master Inventory:

- inventory_master.view
- inventory_master.create
- inventory_master.edit
- inventory_master.delete
- inventory_master.import
- inventory_master.export

Inventory Categories:

- inventory_categories.view
- inventory_categories.create
- inventory_categories.edit
- inventory_categories.delete

Inventory UOMs:

- inventory_uoms.view
- inventory_uoms.create
- inventory_uoms.edit
- inventory_uoms.delete

Par Levels:

- inventory_par_levels.view
- inventory_par_levels.edit
- inventory_par_levels.export

Stock Check Groups:

- inventory_groups.view
- inventory_groups.create
- inventory_groups.edit
- inventory_groups.delete

Stock Check:

- inventory_stock_check.view
- inventory_stock_check.create
- inventory_stock_check.edit
- inventory_stock_check.review
- inventory_stock_check.audit
- inventory_stock_check.export

Purchase Orders:

- inventory_orders.view
- inventory_orders.create
- inventory_orders.edit
- inventory_orders.submit
- inventory_orders.receive
- inventory_orders.complete
- inventory_orders.cancel
- inventory_orders.export

Inventory Movements:

- inventory_movements.view
- inventory_movements.create
- inventory_movements.export

Wastage:

- inventory_waste.view
- inventory_waste.create
- inventory_waste.manage
- inventory_waste.export

Recipes & Usage:

- inventory_recipes.view
- inventory_recipes.create
- inventory_recipes.edit
- inventory_recipes.delete
- inventory_recipes.manage
- inventory_recipes.export

Recipe Intelligence:

- recipe_intelligence.view
- recipe_intelligence.manage

Outlets:

- outlets.view
- outlets.create
- outlets.edit
- outlets.delete

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

- roles_permissions.view
- roles_permissions.create
- roles_permissions.edit
- roles_permissions.delete

Legacy compatibility:

- Older deployments may still contain `roles.view`, `roles.create`, `roles.edit`, and `roles.delete`.
- The UI may support these as temporary aliases only.
- New RBAC work should use `roles_permissions.*` as the canonical permission keys.

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
- Protected roles can access all outlets automatically.
- Non-protected roles with `All Outlets` access can see every current outlet and automatically inherit future outlets.
- Non-protected roles with `Selected Outlets` access can only see outlets assigned through `role_outlets`.
- Users with `roles_permissions.edit` can edit non-protected roles only.
- Non-protected users cannot edit their own role permissions.
- Non-protected users cannot grant permissions they do not already have.
- Non-protected users cannot assign outlets outside their own accessible outlet scope.
- Only owner/admin can grant All Outlets access, which includes future outlets.
- Outlet selectors must use the centralized accessible-outlet helper, not the full outlet list.
- The centralized helper must first check the explicit role outlet access type. If access type is `all`, it returns all active outlets from the outlet master list and prepends `All Outlets`.
- The helper must use `role_outlets` only when access type is `selected`.
- Outlet filters must always include an aggregate option plus individual visible outlets: `All Outlets` for all-outlet roles, or `All Accessible Outlets` for selected-outlet roles.
- All-outlet users must be able to filter down to a specific outlet; the aggregate option must not be the only visible option.
- Outlet data is cached once during app bootstrap and accessible outlets are derived locally from the cached outlet list plus the current role outlet scope.
- Outlet dropdowns must render immediately from cached/bootstrap outlet state and must not replace the selected value with blocking loading text while background filtering refreshes.
- Outlet-scoped pages and services must filter data by accessible outlet IDs.
- If the selected outlet is no longer accessible, the UI resets to `all`, the first accessible outlet, or shows a no-access state depending on the workflow.
- Sidebar visibility follows view permission.
- Add button follows create permission.
- Edit/save follows edit permission.
- Delete follows delete permission.
- Import follows import permission.
- Export follows export permission.
- Before every write, client checks permission.
- RLS remains final backend protection and must enforce both module permission and outlet scope.

RBAC action mapping:

- Every visible UI action must check the exact permission key for that module and action.
- Create buttons check `*.create`.
- Edit buttons check `*.edit`.
- Delete/archive buttons check `*.delete` or `*.deactivate` when the registry defines deactivate.
- Import buttons check `*.import`.
- Export buttons check `*.export`.
- Workflow buttons check their exact keys, for example `inventory_orders.submit`, `inventory_orders.receive`, `inventory_orders.complete`, `inventory_orders.cancel`, `inventory_stock_check.audit`, and `inventory_stock_check.review`.
- Do not use hardcoded owner/admin checks for ordinary module actions.
- Protected-role and own-role restrictions apply only to Role Management unless a module explicitly defines a safety rule.

Outlet scope applies to:

- Asset Tracking
- Inventory Control
- Duty Roster
- Outlet Duty Roster
- Sales Input
- Sales Comparison
- Purchase Input
- Purchase Comparison
- Outlet P&L
- Operating Expenses
- Tax Settings
- Data Health
- Alerts & Insights

Supplier outlet assignment:

- Suppliers are no longer globally usable by every outlet.
- Each supplier must be assigned to one or more accessible outlets through `supplier_outlets`.
- Supplier forms use the wording `Used By Outlets` / `Assigned Outlets`.
- Non-protected roles can only assign suppliers to outlets in their role outlet scope.
- Supplier Directory outlet filters include `All Outlets` or `All Accessible Outlets` at the top, followed by individual visible outlets.
- When Supplier Directory is filtered to `All Outlets`, it shows suppliers linked to any accessible outlet and outlet usage counts only include accessible outlets.
- Supplier Directory must wait for auth, role outlet scope, and accessible outlet state before showing empty results. If suppliers are not present after outlet scope becomes ready, the page triggers its own supplier fetch instead of relying on browser focus.
- Purchase Input supplier dropdowns only show active suppliers assigned to the selected outlet.
- Supplier Directory outlet usage counts come from assigned outlets, not only historical purchase records.
- Removing a supplier from an outlet is blocked when that supplier has purchase records in that outlet.

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

Manual setup link:

```json
{
  "ok": true,
  "mode": "manual_link",
  "setupLink": "...",
  "message": "Manual setup link generated.",
  "accessState": "invited"
}
```

Frontend fallback behavior:

- Email setup success shows "Login setup email sent." only when the Edge Function returns ok true for email mode.
- Email setup failure with canGenerateManualLink shows a warning modal with Generate Setup Link.
- Employees already in Invitation Pending can still resend setup email or generate a manual setup link.
- Manual setup links are copyable and do not expose passwords.
- Supabase invite and recovery setup links must use `redirectTo = APP_URL/setup-password`, not the app root.

Password recovery:

- Detect invite/recovery callback tokens.
- Establish a temporary setup session from URL.
- Show Set New Password screen and replace callback tokens with `/setup-password`.
- Block dashboard/app routes while employee access is not active.
- Call `supabase.auth.updateUser({ password })`.
- For pending employee setup, call `complete_employee_password_setup()` to set `access_state = active`, `setup_completed_at`, and login metadata.
- For normal Forgot Password recovery on an already-active employee, do not call the setup-completion RPC; reload the active user context after the password update succeeds.
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
- supplier_outlets
- product_sales_reports
- product_sales_items
- asset_categories
- asset_items
- asset_movement_logs
- asset_inspections
- asset_inspection_items
- asset_inspection_evidence
- asset_maintenance_records

Inventory Control tables:

- inventory_categories
- inventory_items
- inventory_item_outlets (`inventory_item_id`, `outlet_id`, `par_level`, `storage_location`, `is_active`)
- inventory_item_outlet_suppliers (`inventory_item_outlet_id`, `supplier_id`)
- inventory_stock_check_groups
- inventory_stock_check_group_categories
- inventory_stock_check_group_items (legacy compatibility only; not used by the current group editing workflow)
- inventory_stock_checks (`stock_check_type` = `scheduled` or `audit`; stores `check_name`, `shift`, `check_date`, `status`, `created_by`, `submitted_by`, and `submitted_at`; audit rows may store `audit_type`, `audit_name`, `audit_category_ids`, and `notes`)
- inventory_stock_check_items (snapshot rows for counted stock check items; supports `category_id`, `par_level_quantity`, `actual_count_quantity`, `variance`, `notes`, `skipped`, and `skip_reason`)
- inventory_stock_requests
- inventory_stock_request_items
- inventory_purchase_orders
- inventory_purchase_order_items
- inventory_purchase_receipts
- inventory_purchase_receipt_items
- inventory_movements
- inventory_waste_records
- inventory_recipes
- inventory_recipe_items

Asset table status and condition rules:

- `asset_items.asset_code`, `location`, `purchase_date`, `warranty_expiry`, and `notes` are optional metadata used by Asset Tracking import and future asset lifecycle reporting.
- `asset_items.condition` stores operational condition.
- Allowed condition values are `healthy`, `needs_attention`, `under_maintenance`, `low_quantity`, `damaged`, `missing`, and `disposed`.
- `asset_items.status` stores record lifecycle only.
- Allowed asset status values are `active` and `archived`.
- `asset_maintenance_records.status` allows only `scheduled`, `in_progress`, and `completed`.
- Asset and maintenance constraints must not allow old values such as `needs_review`, `inactive`, or `cancelled`.

Operational records:

- Asset inspections, maintenance records, inventory checks, inventory requests, purchase orders, movements, and waste records must retain historical rows.
- Historical records are never rewritten only to change current dashboard state.
- Current operational summaries derive from latest valid records plus current active scope.
- `inventory_purchase_orders` must preserve `completion_type` (`full` or `partial`), `completion_reason`, and unfulfilled quantity when a PO is completed.

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
- suppliers readable by suppliers.view, purchase_input.view, purchase_comparison.view where needed.
- sales_channels readable by sales_channels.view, sales_input.view, sales_comparison.view where needed.
- outlet_tax_configs readable by tax_settings.view, sales_input.view, dashboard.view where needed.
- asset_categories readable by asset_tracking.view.
- inventory_categories readable by related Inventory Control view/manage permissions.
- inventory_items readable by inventory_master.view, inventory_stock_check.view, inventory_orders.view, inventory_movements.view, inventory_waste.view, and inventory_recipes.view where needed.

Transaction records:

Sales records:

- SELECT: sales_input.view OR sales_comparison.view OR dashboard.view
- INSERT: sales_input.create OR sales_input.import
- UPDATE: sales_input.edit OR sales_input.import
- DELETE: sales_input.delete

Purchase records:

- SELECT: purchase_input.view OR purchase_comparison.view OR dashboard.view
- INSERT: purchase_input.create OR purchase_input.import
- UPDATE: purchase_input.edit OR purchase_input.import
- DELETE: purchase_input.delete

Asset records:

- SELECT: asset_tracking.view
- INSERT: asset_tracking.create
- UPDATE: asset_tracking.edit OR asset_tracking.manage
- DELETE/archive: asset_tracking.delete
- Asset tables with outlet_id must enforce role_outlets outlet scope.
- Asset categories are global configuration, but linked asset records remain outlet-scoped.
- Asset maintenance records are readable and writable only when the user can access the linked asset outlet and has the required asset_tracking permission.
- Asset inspections and inspection items are readable and writable only when the user can access the inspection outlet and has asset_tracking.view/manage as appropriate.

Inventory Control records:

- SELECT: related Inventory Control view permission plus accessible outlet scope.
- INSERT: related create permission plus accessible outlet scope.
- UPDATE: related edit/review/approve/manage permission plus accessible outlet scope.
- DELETE/archive: related delete/manage permission plus accessible outlet scope.
- Inventory item master records may be global, but item-outlet links restrict outlet usage.
- Stock Check Groups, Stock Checks, Requests, Purchase Orders, Movements, and Waste records must enforce outlet scope.
- RLS must prevent users from adding inventory items to groups for outlets they cannot access.
- RLS must prevent users from approving requests or managing orders without the related approval/manage permission.

Supplier outlet links:

- supplier_outlets must enforce that non-protected users can only read and write links for accessible outlets.
- Purchase Input supplier lookups must only return suppliers linked to the selected accessible outlet.
- Supplier Directory All Outlets mode must aggregate only accessible outlet links.

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
→ Employee profile defaults to System Access disabled
→ Click Enable Access
→ Add email
→ Assign role
→ Send Login Setup Email
→ Edge Function sends setup email
→ Employee sets password
→ Setup completion RPC sets access_state = active and setup_completed_at
→ App access is allowed

Disable Access:
→ Set access_state = disabled
→ Preserve login email, role_id, auth_user_id, last_login_at, employee profile, and historical records

Change Login Email:
→ Explicit Change Login Email action
→ Validate new email
→ Save pending login email
→ Require new setup/verification link
```

### 12.5 Module Import Workflow

```text
Open owning module
→ Click module import action
→ Upload file
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

Rules:

- Sales import is launched from Sales Input and requires `sales_input.import`.
- Purchase import is launched from Purchase Input and requires `purchase_input.import`.
- Embedded Purchase Import launched from Purchase Input is outlet-scoped to the currently selected Purchase Input outlet. The modal shows `Import Target Outlet: [Outlet Name]`, validates every uploaded row against that selected outlet, and blocks import when a file contains a different outlet code/name. Month and Year are not inherited from the Purchase Input page filters; they are derived from each imported file row so multi-month imports are allowed.
- Purchase Import unknown supplier review must carry the selected default category into preview validation. If an import row has no category and the operator chooses Create supplier with a category, that category fills the row for preview and is saved as the new supplier default during confirmed import.
- Recent import history is scoped by owning module and selected outlet only, not by the current Month/Year page filters.
- Import batch history is scoped by owning module and outlet; `import_batches` / `import_batch_rows` allow Sales Input import users to write sales batches and Purchase Input import users to write purchase batches without granting unrelated module import access. The original uploaded filename is audit metadata and must remain immutable; optional display names, remarks, archive, void, and revert workflows are future controlled correction flows rather than hard-delete behavior.
- The centralized Data Import page is not active in current navigation.

### 12.6 Duty Roster Weekly Scheduling

```text
Select outlet and week
→ Load active employees
→ Map employee job positions to Floor/Kitchen/Other groups
→ Group employees in roster employee column
→ Empty cells show + Add Shift on hover
→ Click empty cell to open Add Shift drawer
→ Or select a Quick Shift Template to enter assignment mode
→ Click roster cell to instantly assign selected template
→ Save shift to duty_rosters
→ Use Bulk Assign to apply one shift to multiple dates
→ Review Floor/Kitchen coverage by day in the side panel
→ Publish roster when ready
→ Stamp published roster snapshots for employee, position, department, outlet, shift and publish timestamp
→ Lock roster when finalized
→ Audit critical roster actions
```

### 12.7 Outlet Duty Roster Overview

```text
Open Overview > Outlet Duty Roster
→ Select outlet and month
→ Load duty_rosters for the full month
→ Apply group, position, and employee filters
→ Render monthly calendar roster summary cards
→ Click Off Day, Annual Leave, or MC KPI to view filtered details
→ Click date card
→ Open daily duty drawer
→ Review Floor/Kitchen/Other staff on duty
→ Use Open Schedule View to focus the selected roster week for editing
```

Rules:

- Do not show hardcoded staffing health labels such as Fully Staffed, Understaffed, Critical shortage, or 9+ staff thresholds.
- Outlet Duty Roster is factual only until outlet-specific manpower targets exist.
- Empty dates show Not Scheduled Yet.
- Scheduled dates show actual staff scheduled count plus Floor, Kitchen, OFF, AL, and MC count chips.
- Monthly calendar date cards hide zero-value detail chips; Floor, Kitchen, OFF, AL, and MC chips show only when the count is above zero.
- If a date has no working staff and no OFF/AL/MC entries, the card shows a lighter dashed `No Schedule` state while preserving the Today badge when relevant.
- KPI cards are Scheduled Shifts, Off Day, Annual Leave, and MC.
- Off Day, Annual Leave, and MC KPIs count matching entries for the selected outlet, month, group, position, and employee search filters.
- Clicking the Off Day, Annual Leave, or MC KPI opens the matching detail drawer with Date, Staff Name, Position, Group / Department, and Type.
- Empty detail drawers show a clear no-records message for the current period.
- Calendar date cards use compact chips/badges for Draft/Published/Locked, Today, Staff Scheduled, Floor, Kitchen, OFF, AL, and MC, with a subtle hover state and View details affordance.
- Calendar date cards show Draft, Published, or Locked only when shifts exist.
- Daily status derives from duty_rosters rows: all published = Published, all locked = Locked, otherwise Draft.
- Today is marked with a small Today badge and subtle green styling.
- The legend only explains AL, MC, Today and roster status badges.
- If no roster exists for a selected date, the drawer shows one clean empty state: No staff scheduled for this date.
- Published and locked days use roster snapshots so historical staff remain visible even after employee resignation or termination.

Roster settings:

- Position Group Mapping uses group-first cards:
  - Floor Team multi-select positions.
  - Kitchen Team multi-select positions.
  - Unassigned Positions appear under Other in roster.
- Save Position Groups writes all position mappings in one action.
- Shift templates are outlet-specific and must never fall back to templates from another outlet.
- If the selected outlet has no active templates, Duty Roster shows an empty state until templates are created in Settings.
- Shift Template Settings use compact stacked FeedX cards:
  - Add/Edit Template form.
  - Draggable active template cards.
  - Collapsed Archived Templates section.
- Time selection supports manual typing and dropdown suggestions.
- Manual typed time accepts common roster formats such as `2pm`, `2 pm`, `2:00pm`, `02:00pm`, `14:00`, `9`, `930am`, `09:30am`, and `0930`.
- Time input normalizes to `hh:mmam` / `hh:mmpm` display format, for example `02:00pm` and `09:30am`.
- Invalid examples such as `25:00`, `13pm`, `abc`, and `2:99pm` show: `Enter time like 2pm, 2:30pm, 14:00, or select from the list.`
- Suggestion dropdown selections must immediately update Start Time / End Time, close the dropdown, clear validation, and update Live Preview.
- If End Time is earlier than Start Time, Duty Roster treats the shift as overnight and shows a next-day warning in the template preview.
- Time is stored internally as 24-hour HH:MM and displayed as friendly operational text such as 10am - 6pm.
- Break Duration is labeled clearly with minute options such as 60 mins unpaid.
- sort_order controls quick template display order.
- Templates are archived with is_active = false instead of hard deleted.
- Dark mode roster template cards use neutral enterprise surfaces instead of fully colored card fills. Status is represented through a left accent border, badge/icon treatment, and readable text.
- Duty Roster template accents are: Full/working green, OFF gray, MC medical leave purple, and AL annual leave blue. Medical Leave purple uses a restrained `rgba(168,85,247,0.12)` background and `#C084FC` text in dark mode.
- Archived templates are hidden from quick assign but remain available for historical roster display.
- Quick Shift Templates load from the selected outlet.
- Month view uses compact shift codes for dense scheduling.
- Duty Roster page layout:
  - Filters.
  - KPI Summary Cards.
  - Roster Grid.
- Right-side Department Coverage card is removed from the scheduling workspace.
- Share Roster follows duty_roster.export permission.
- Share Roster generates clean light-theme roster images with selectable layouts:
  - Horizontal for desktop viewing, printing, and wide WhatsApp images.
  - Vertical for mobile WhatsApp sharing.
- Horizontal share image uses:
  - Outlet name.
  - Week date range.
  - Roster status.
  - Employee groups by Floor/Kitchen/Other.
  - 7-day table with employee rows.
- Vertical share image uses:
  - Portrait layout.
  - Legend row.
  - Group sections.
  - Employee cards with daily shift pills.
- Both layouts include:
  - Friendly shift time format.
  - Generated date/time footer.
- Share image actions:
  - Download Image.
  - Copy Image.

### 12.8 Asset Inspection

```text
Select outlet, inspection type, date, and scope
→ Load preset checklist from selected scope
→ Add or remove assets manually when needed
→ Count assets and select conditions
→ Mark items skipped when needed
→ Upload evidence or add remark when operationally useful
→ Review Inspection Summary and Issues Found
→ Submit inspection from Review & Submit or save draft
→ Update asset quantities, conditions, last inspected date, and movement logs
→ Inspection History updates newest first
```

Rules:

- Inspection Type is an operational preset, not only a label.
- Checked By is auto-populated from the authenticated employee and saves the employee id.
- Checklist items can be dynamically added, removed, or skipped.
- Skipped state is preserved in drafts.
- Inspection has three steps: Setup, Checklist, Review & Submit.
- Mobile inspection progress stays visible below the modal header and shows completed, remaining, and progress percentage.
- Review & Submit shows asset photos, evidence photos, exception rows first, Inspection Summary, and Issues Found.
- Submitted inspections show Checked By and timestamp.
- Inspection History sorts newest first by inspection date, then created_at, then updated_at.

### 12.9 Asset Maintenance

```text
Open maintainable asset profile
→ Maintenance History
→ Add Maintenance Record
→ Choose Scheduled, In Progress, or Completed
→ Enter status-specific fields
→ Save record
→ Update asset condition when selected by user
→ Update asset service summary from latest completed record
```

Rules:

- Maintenance is shown only when category setting and asset override resolve to enabled.
- Scheduled → In Progress → Completed is supported.
- Direct Completed creation is supported.
- Completed records can optionally set condition back to Good.
- Latest completed maintenance controls current Last Service Date.
- Latest completed maintenance with Next Service Date controls current Next Service Due.
- Latest completed maintenance without Next Service Date clears stale current reminders.

### 12.10 Inventory Stock Check

```text
Open Inventory Control > Stock Check
→ Select outlet and date
→ System shows due stock check groups
→ Start a due group
→ Count items
→ Review variance
→ Save Draft or Submit
→ Reviewer can Review or Lock when permitted
→ Inventory movements and alerts update where applicable
```

Rules:

- Monthly groups are due by configured monthly rule such as 1st day, 15th day, or last day of month.
- Custom groups are due only on selected weekdays.
- Daily and Weekly frequencies are removed from the current scope.
- Groups select categories, not manual item lists.
- Stock Check rows are generated from active inventory items where `category_id` is in the group category list and the item is linked to the group outlet from Master Inventory.
- Legacy item-link data may be retained for compatibility, but it must not drive new group editing workflows.
- If possible, legacy item-linked groups should infer category links from their existing items.

### 12.11 Stock Request and Purchase Order

```text
Outlet creates stock request
→ Request submitted for approval
→ Approver reviews full or partial quantities
→ Approved request converts to Purchase Order
→ Purchase Order groups items by supplier
→ Delivery status updates
→ Completed delivery creates inventory movements
```

Rules:

- Approval access comes from configurable Role & Permission.
- No stock request or PO workflow may hardcode role names.
- Purchase Orders may combine requests by supplier while retaining outlet breakdown.

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
- Compact enterprise density with clear hierarchy.
- Global visual density follows Linear / Stripe Dashboard / Vercel / Notion Enterprise references: compact, premium, readable, and never bulky.
- Use weight, contrast, spacing, and status color instead of oversized text.
- Tables should feel stable and scannable, not like spreadsheets.
- Dashboard pages should prioritize workflow visibility and operational action.
- Drawer views should be read-first unless the user explicitly enters create/edit mode.
- Nested workflows inside drawers should use same-drawer mode changes or correctly stacked top-level portals.
- Dropdowns, context menus, popovers, tooltips, and row action menus must render through a portal/floating layer when they may cross card/table boundaries.
- Floating layers must not be clipped by overflow containers and must not resize rows or parent cards.
- Table hover states must never change row height, scale rows, or shift layout.
- Use actual dates in operational records. Relative labels may be used only as supplemental helper text or tooltip.
- Quick filters must not duplicate primary dropdown filters.
- Asset condition filters belong in the Condition dropdown; operational quick filters are reserved for workflow shortcuts.
- UI wording must use finalized business terms consistently:
  - Good
  - Needs Attention
  - Under Maintenance
  - Low Quantity
  - Damaged
  - Missing
  - Disposed
  - Active
  - Archived
  - Scheduled
  - In Progress
  - Completed
- Do not use old asset/maintenance terms in user-facing UI:
  - Healthy
  - Needs Review
  - Inactive
  - Cancelled

Shared UI foundation primitives:

- FloatingLayer: shared portal/fixed-position primitive for action menus, dropdowns, select popovers, date pickers, contextual popovers, and lightweight tooltips.
- Drawer: shared right-side drawer primitive for read-first profiles and nested workflows.
- Timeline: shared event-stream primitive for Recent Activity, Inspection History, Maintenance History, Movement Log, Audit Log, and Dashboard Alerts.
- DashboardSection: shared dashboard/card section wrapper for consistent section title, subtitle, action placement, density, and spacing.
- StatusBadge: shared semantic badge primitive for lifecycle, condition, alert, maintenance, inspection, inventory, and dashboard states.
- MetricCard: shared KPI/summary card primitive with default, primary, warning, danger, info, and neutral variants plus compact and standard sizes.
- DatePickerField: shared enterprise calendar/date picker built on FloatingLayer for all date selection across FeedX.

Date picker rules:

- All modules must use the shared FeedX DatePickerField rather than native browser date inputs or page-local calendar implementations.
- Calendar popovers use FloatingLayer so they do not clip inside cards, tables, drawers, or modals.
- Date picker styling follows FeedX semantic surfaces, green selected state, soft green hover, muted outside-month days, and subtle today indicator.
- Date picker supports outside click close, Escape close, keyboard opening, arrow-key day navigation, Today, and Clear.
- Display format is `DD MMM YYYY` style, for example `28 May 2026`.
- Manual input may accept numeric format such as `28/05/2026`.
- Dark mode must keep card surfaces, text, hover state, selected state, and outside-month days readable.

Dark mode semantic color rules:

- Dark mode uses separate semantic tokens for success, warning, danger, info, neutral, primary, elevated surfaces, muted surfaces, subtle borders, and readable text.
- Dark mode cards use neutral premium surfaces: card `#111827`, border `#1F2937`. Avoid full green, purple, blue, or white card fills for operational content.
- Status should be represented with a left accent border, compact badge, and icon rather than a fully colored card background.
- Light mode color treatment must remain unchanged; dark-mode overrides tune only dark surfaces, borders, and text contrast.
- Info, warning, success, and danger cards use tinted dark backgrounds with lighter readable text. Do not use saturated blue text on dark blue backgrounds or dark red text on dark red backgrounds.
- Insight cards, security notes, alert callouts, status badges, and operational summary tiles must use semantic dark surfaces instead of muddy light color translations.
- Badge and status pill text must keep strong contrast in dark mode for Active, Completed, Draft, Warning, High, Info, Success, and Error states.
- FeedX green remains the brand accent, but semantic warning/danger/info states must stay visually distinct from the brand color.
- Employee profile section labels such as Personal Info and Employment Info use visible slate text (`#94A3B8`) in dark mode while keeping existing letter spacing.

FloatingLayer migration status:

- SupplierCombobox uses FloatingLayer for supplier search dropdowns.
- FilterPopover uses FloatingLayer for filter option popovers.
- AppShell notification popover uses FloatingLayer.
- AppShell profile/theme popover uses FloatingLayer.
- AppShell sidebar profile popover uses FloatingLayer.
- AppShell sidebar account actions must be directly bound: View My Profile opens the current employee profile modal, Change Password opens the password update modal, and Sign Out clears the Supabase session and redirects to login.
- Change Password modal uses Current Password, New Password, and Confirm New Password fields with Show/Hide toggles. New passwords require only 8+ characters, at least one letter, and at least one number; special characters and case-mix are not required.
- Change Password shows a live requirements checklist and simple strength label: Weak for missing/short values, Medium for 8+ characters with letters and numbers, and Strong for 12+ characters with letters and numbers.
- Change Password must keep Save disabled until current password is filled, the new password passes requirements, and confirmation matches. Wrong current password errors display as `Current password is incorrect.`
- Passwords must never be stored in FeedX tables, logged, or displayed by default. Future enhancement: update `last_password_changed_at` if/when the profile schema supports it.
- Sidebar account menu buttons must stop pointer/mouse propagation so FloatingLayer outside-click handling cannot swallow the click.
- New dropdowns, action menus, contextual popovers, date pickers, and tooltips must use FloatingLayer by default unless a stronger shared primitive already wraps it.
- New overlays must not use arbitrary `z-[9999]` style values or page-local `createPortal` positioning unless documented as a temporary migration exception.

Typography tokens:

```text
type-page-title     page titles, about 28-30px desktop
type-section-title  dashboard and section headings, 15-16px equivalent
type-card-title     compact card titles, 14-15px equivalent
type-body           standard body copy, about 13-14px
type-body-sm        secondary body copy, about 12px
type-caption        metadata, badge text, helper text, about 11px
type-micro          tiny labels, about 10px
type-metric         KPI values, about 26-30px maximum
```

Typography rules:

- Shared components must use semantic type classes instead of raw `text-sm`, `text-lg`, or arbitrary text sizes.
- Raw Tailwind typography is allowed only for one-off visual exceptions, not repeated UI patterns.
- Page-level modules should migrate gradually through shared components rather than mass rewriting every text node.
- Desktop density is tracked in `FEEDX_TYPOGRAPHY_AUDIT.md`; future typography changes should update that audit when they intentionally alter the global scale.
- Sidebar navigation uses 13.5px-14px, medium-weight labels with 20px line height. Sidebar section labels use 11px, uppercase, 0.12em letter spacing, and 600 weight.
- Sidebar user footer uses 14px for the name and 12px for the role.
- Page header eyebrow labels use 12px uppercase text with 0.18em letter spacing. Page titles stay strong at about 26-28px with 700 weight, and subtitles use 13-14px muted text.
- KPI card labels use 11-12px semibold uppercase treatment, values are capped around 26-28px, helper text uses 12-13px, and desktop padding should sit near 14-18px depending on density.
- Filter labels use 12px semibold text. Input/select text uses 14px and controls stay usable around 40-44px high on desktop.
- Chart labels, legends, and tooltips should be compact and avoid oversized legends.

StatusBadge semantic map:

```text
Green: Good, Completed, Positive, Active
Amber: Watch, Needs Attention, Pending, Due Soon
Red: Critical, Missing, Error, Overdue, Damaged
Blue: Scheduled, Info, In Progress, Under Maintenance
Gray: Archived, Disposed, No Data, Draft
```

StatusBadge rules:

- Same padding, radius, and type scale across modules.
- Icons are optional but must follow the semantic tone.
- Modules should not create local badge colors unless a new semantic status is added to the shared map.

MetricCard rules:

- KPI value typography is standardized globally through `text-primary-type-kpi-value`. Final value scale is 22.5px / 28px / 600 for a refined enterprise SaaS density. KPI values must not use page-title-sized utilities such as `text-4xl`, `text-5xl`, or custom 40px+ values.
- Dashboard KPI cards use MetricCard.
- Duty Roster and Outlet Duty Roster KPI summaries use MetricCard with semantic icons, compact 11-12px labels, the shared KPI value scale, and cleaned human-readable labels such as Scheduled Shifts, Off Day, Annual Leave, and MC.
- People KPI summaries across Employees, Job Positions, Departments, and Roles & Permissions use MetricCard with semantic icons, compact 11-12px labels, muted label color, and the shared KPI value scale. Upcoming Celebrations mini stats follow the same icon + label language with softer secondary-card styling.
- Inventory and operations KPI summaries across Wastage, Recipes & Usage, Inventory Movements, Stock Check Groups, Asset Tracking, and Month Closing Control Center use MetricCard or the same MetricCard header/value language: a small semantic icon, 11-12px muted semibold label, and the shared compact KPI value scale.
- Analytics-heavy KPI strips, such as Product Analytics, should use `MetricCard variant="compact"` to reduce card height, icon footprint, and whitespace while keeping numeric values prominent.
- Product Analytics KPI hierarchy: numeric KPI cards inherit `text-primary-type-kpi-value`; product/category names cap at `text-[22px] leading-[28px] font-semibold` with English primary and Chinese secondary where bilingual names exist; secondary helper text remains 12-13px.
- Clickable summary cards must show pointer affordance and active state when filtering/drilling down.
- Hover lift is allowed for standalone dashboard cards only.
- MetricCard must not be used inside table rows with transform hover behavior.

Table interaction rules:

- Global table headers use 11-12px semibold uppercase text with about 0.08em letter spacing.
- Table body primary text uses about 14px; secondary text uses about 12px muted text.
- Table row padding should remain compact and scannable while preserving touch/readability. Avoid oversized vertical padding in dense management pages.
- Table action buttons use compact 13px text and must not crowd the row edge.
- Use `table-row-interactive` for stable hover rows.
- Use `table-action-cell` for the View + overflow action pattern.
- Table rows must not translate, scale, expand, or change height on hover.
- Hidden action groups must not appear in a way that changes row layout.

Timeline rules:

- Timeline events use actual dates.
- Same-day records show time.
- Newest-first sorting is default.
- Timeline should be compact by default and avoid oversized cards.
- Standard event shape:
  - id
  - date
  - time
  - type
  - title
  - description
  - actor
  - outlet
  - status
  - metadata
  - actions

Z-index scale:

```text
base: 0
sticky: 30
drawer overlay: 100
modal overlay: 100
modal/drawer content: 110
popover: 150
tooltip: 160
lightbox: 180
confirmation overlay: 200
confirmation content: 210
toast: 9999
```

Layering rules:

- Drawers sit above normal page content.
- Modals and drawers use the shared overlay/content layer and must not rely on page-local z-index values.
- Popovers opened from drawers or modals sit above their parent surface.
- Tooltips and lightboxes sit above popovers.
- Confirmation dialogs opened from a modal or drawer must use the shared global ConfirmDialog layer so destructive confirmations always render above the parent surface.
- Nested confirmation examples include Disable Access, Archive Recipe, Archive Inventory Item, Delete Draft Audit, Delete Draft Stock Check, Archive Employee, and future destructive actions.
- Toasts must remain above modals, confirmations, and lightboxes so modal action feedback is always readable.
- Avoid arbitrary high z-index values such as z-[9999] unless there is a temporary migration reason.
- New overlay UI must use the shared primitives before adding page-local layering code.

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
- productAnalyticsService
- assetTrackingService
- inventoryService
- inventoryStockCheckService
- inventoryRequestService
- inventoryPurchaseOrderService
- inventoryMovementService

Service rules:

- Throw detailed internal errors for console debugging.
- Show clean business messages in UI.
- Never silently fail writes.
- Refresh persistence must survive page reload.
- Outlet-scoped services must apply accessible outlet filtering before querying or writing.
- UI filtering alone is not sufficient for outlet-scoped data.
- Derived dashboard counts must document their base scope and must not accidentally derive from a currently active drill-down filter.

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
- Inventory forecasting and predictive ordering
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
- Asset, inventory, and dashboard summary logic can drift if base scope and active drill-down filters are not documented in each module.
- Status naming can drift if Condition, Status, Maintenance Status, Inspection Status, and Inventory Status are not kept separate.

### 17.1 Production Readiness Status - 1 June 2026

Current recommendation: **NOT READY for production cutover until release gates are completed.**

This is not a feature-readiness failure. Core FeedX modules are implemented in the staging codebase and `npm run build` is expected to pass, but production cutover requires environment-level verification that was not completed by static code review alone.

Production release gates:

- Confirm all local Supabase migrations are applied to the production project and PostgREST schema cache has no stale-column errors.
- Verify production RLS for owner/admin, all-outlet role, selected-outlet role, view-only role, and no-permission role.
- Verify production Storage buckets and policies for `inventory-item-photos` and `asset-photos`.
- Verify production Supabase Auth redirects, SMTP email delivery, forgot-password, invite/setup-password, and employee onboarding Edge Function.
- Execute `FEEDX_PRODUCTION_UAT_CHECKLIST.md` before cutover.
- Confirm no authenticated production workflow relies on browser-local operational records or fallback/demo data.

Release governance documents:

- `FEEDX_PRODUCTION_READINESS_AUDIT.md`
- `FEEDX_PRODUCTION_UAT_CHECKLIST.md`
- `FEEDX_RELEASE_CANDIDATE_REPORT.md`
- `FEEDX_GO_LIVE_CHECKLIST.md`
- `FEEDX_DEVELOPMENT_LOG.md`
- `docs/releases/`

FeedX production operations development governance:

- Production:
  - Git branch: `main`
  - Vercel project: `fnb-system`
  - Supabase project: `fnb-system`
- Staging:
  - Git branch: `dev`
  - Vercel project: `fnb-system-staging`
  - Supabase project: `fnb-system-staging`
- All development, fixes, UI work, schema work, and testing happen on `dev`.
- Never develop directly on `main`.
- Never modify Production Supabase directly unless the operator explicitly approves that production action.
- All schema changes must be migration-based.
- Before merge, run:
  - `npm run build`
  - `git diff --check`
- Update required documentation before merge.
- Production releases move `dev` to `main` only after approval.
- Production deploys only from `main`.
- Production schema promotion applies migrations to the Production Supabase project only; staging test data must never be copied into Production.
- Supabase CLI must be explicitly linked to the intended Supabase project before any environment-specific command.

FeedX documentation policy:

- Layer 1: `FEEDX_PROJECT_MASTER_DOCUMENT.md`
  - Source of truth for final business logic, architecture decisions, permissions, workflows, system rules, and production architecture.
  - Do not use as a daily change log.
- Layer 2: `FEEDX_DEVELOPMENT_LOG.md`
  - Concise development history.
  - Update after every meaningful completed development session.
  - Format: Date, Module, Changes, Notes.
- Layer 3: `docs/releases/`
  - One release note file per production release that reaches `main`/Production.
  - Format: Version, Date, Changes, Migration Impact, Deployment Notes.

Required documentation after development:

- Every completed development task must update `FEEDX_DEVELOPMENT_LOG.md`.
  - Required fields: Date, Module, Summary of changes, Notes.
  - Applies to UI changes, bug fixes, new features, auth changes, schema changes, and production operations changes.
- Business logic changes must update `FEEDX_PROJECT_MASTER_DOCUMENT.md`.
- Production merges/releases must create or update the matching release note under `docs/releases/`.
- Before reporting task completion, documentation updates must be confirmed.
- A feature/change is not complete until:
  - code is updated,
  - build is verified when applicable,
  - documentation is updated.

Implemented production-scope decisions documented as current:

- Dashboard is the UI name for the Overview Dashboard route.
- Supplier Categories is the UI name for supplier spend/category settings.
- Wastage is the UI name for spoilage, expiry, damaged inventory, and kitchen wastage.
- Recipe Intelligence is a standalone Inventory Control analytics page with its own `recipe_intelligence.view` and `recipe_intelligence.manage` permissions.
- Recipes & Usage contains Recipe BOM setup and Product Mapping setup.
- Centralized Data Import is removed from active navigation; Sales Import and Purchase Import live inside their module pages.
- Stock Requests remains deferred and out of current MVP scope.
- Login, Forgot Password, Setup Password, and Reset Password share the modern FeedX auth visual system.

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
