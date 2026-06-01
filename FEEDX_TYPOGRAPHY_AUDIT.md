# FeedX Desktop Typography Audit

Date: 2026-06-01

## Scope

Reviewed the active FeedX desktop surface through shared components and page usage patterns across:

- Dashboard, Outlet P&L, Product Analytics, Sales Comparison, Purchase Comparison, Alerts & Insights
- Outlet Duty Roster, Duty Roster, Sales Input, Purchase Input, Operating Expenses
- Asset Tracking, Outlets, Data Health
- Master Inventory, Par Levels, Stock Check Groups, Stock Check, Purchase Orders, Inventory Movements, Waste & Variance
- Recipes & Usage, Recipe Intelligence
- Employees, Job Positions, Departments, Roles & Permissions, Audit Logs

The audit focused on shared typography primitives first because most pages consume the same `PageHeader`, `MetricCard`, `DataTable`, `Card`, `SelectField`, sidebar, button, and control classes.

## Current Issues

| Area | Finding | Impact |
| --- | --- | --- |
| Page headers | Shared title token had drifted toward 30px desktop. | Strong, but slightly heavy on dense management pages. |
| Sidebar | Navigation was mostly refined, but item text was still a little heavier/larger than the target enterprise feel. | Sidebar competed with page content. |
| KPI cards | Shared MetricCard was acceptable but standard card padding and primary value clamp allowed a bulky feel. Product Analytics also had a page-local KPI card at `min-h-[116px]`. | Dashboard and analytics screens felt more spacious than needed. |
| Tables | Shared table classes were already stable, but global table text needed a clearer 11-12px header / 14px body standard. | Dense tables varied by module. |
| Forms and filters | Shared controls were compact but some exact sizing was rem-based, making desktop text closer to 13px than the requested 14px. | Inputs could feel slightly small after the overall compacting pass. |
| Buttons | Buttons used shared classes, but text should sit around 13.5px rather than drifting larger or smaller by root font scaling. | Action bars looked more consistent after exact sizing. |
| Charts | Shared chart labels are already compact, but the product and recipe analytics pages still contain some local chart labels. | No P0 issue; keep future chart work aligned to the scale. |
| Modals | Shared modal title uses `type-title`, which is compact. Larger asset/detail modals still have local large headings. | Acceptable for read-first detail drawers, but future detail views should use shared heading tokens. |

## Proposed Desktop Scale

| Element | Target |
| --- | --- |
| Sidebar nav | 13.5px-14px, weight 500, line-height 20px |
| Sidebar section labels | 10.5px-11px, uppercase, 0.12em letter spacing, weight 600 |
| Sidebar user footer | Name 14px, role 12px |
| Page title | 26px-28px, weight 700 |
| Page subtitle | 13px-14px muted |
| Page eyebrow | 12px, uppercase, 0.18em letter spacing |
| KPI label | 11px-12px, semibold uppercase |
| KPI value | 26px-28px normal cards, max 28px for primary cards |
| KPI helper | 12px-13px |
| Card title | 14px-15px for compact cards, 17px-18px only for major local sections |
| Card subtitle | 12px-13px |
| Table header | 11px-12px, semibold uppercase, 0.08em letter spacing |
| Table body primary | 13.5px-14px |
| Table body secondary | 12px muted |
| Form label | 12px semibold |
| Input/select | 14px |
| Buttons | 13.5px-14px |
| Badge | 11px-12px |
| Modal title | 20px-22px for workflow modals; compact shared modal titles stay smaller for utility dialogs |

## Implementation Notes

Updated shared styling rather than page-by-page overrides:

- `src/styles/index.css`
  - Refined global type tokens: page title, headings, card title, metric, body-sm, caption, micro.
  - Standardized controls to exact 14px text.
  - Standardized primary/secondary buttons to exact 13.5px text.
  - Reinforced global table header/body/secondary/action text rules.
- `src/layouts/AppShell.jsx`
  - Sidebar nav item text set to exact 13.5px medium.
  - Sidebar section labels and footer already aligned to compact scale.
- `src/components/layout/PageHeader.jsx`
  - Eyebrow, page title, and subtitle now follow the target scale.
- `src/components/ui/MetricCard.jsx`
  - Reduced standard card height/padding.
  - Metric values now use the shared `type-kpi-value` token based on the Purchase Comparison KPI scale.
  - KPI label is now semibold uppercase 12px-style treatment.
  - Added `variant="compact"` for analytics-heavy KPI strips that need higher density without weakening global dashboard cards.
- `src/components/tables/DataTable.jsx`
  - Table body text standardized to 14px with compact row padding.
- `src/components/forms/SelectField.jsx`
  - Select button text uses exact 14px.
- `src/features/sales-purchase/pages/ProductAnalyticsPage.jsx`
  - Page-local KPI cards were replaced with shared `MetricCard variant="compact"`.
  - Product Analytics numeric KPI values now inherit the shared `type-kpi-value` standard from MetricCard, instead of carrying a page-specific compact value class.
  - Product/category KPI values use a distinct name hierarchy: English primary capped at `text-[22px] leading-[28px] font-semibold`, Chinese secondary at 13px muted text.
  - Icon footprint and vertical whitespace were reduced so more Product Analytics content appears above the fold.

## Page Impact Summary

| Page / Module | Expected Result |
| --- | --- |
| Dashboard | KPI cards and page header feel less oversized while retaining executive hierarchy. |
| Product Analytics | KPI strip is notably more compact through shared compact MetricCards; tables inherit balanced header/body scale. |
| Master Inventory | Shared tables and buttons read cleaner without reducing mobile touch targets. |
| Recipes & Usage / Recipe Intelligence | Shared cards, tables, buttons, and filters align to the same scale. |
| Employees / People pages | KPI and table density aligns with Inventory and analytics pages. |
| Purchase Orders / Inventory Movements / Waste | Shared table and button scale improves scanning. |
| Duty Roster / Outlet Duty Roster | Sidebar/global scale applies; roster-specific visual cards remain readable. |
| Sales/Purchase Comparison | MetricCard and table refinements apply to the main comparison workspaces. |

## Remaining Technical Debt

- Some large read-first detail views, especially Asset Tracking detail/inspection surfaces, still use page-local `text-2xl` or `text-3xl`. These are intentional for hero/detail emphasis today, but should migrate to shared detail-view heading tokens later.
- Product Analytics and Recipe Intelligence contain local chart label styling. Future chart work should centralize axis, legend, and tooltip typography in chart primitives.
- Some older module-specific KPI cards remain outside `MetricCard`. They should be migrated opportunistically when those pages are next touched.

## Verification

- Build verification required after typography changes: `npm run build`.
