import DashboardOverviewPage from "../features/sales-purchase/pages/DashboardOverviewPage.jsx";
import SPDashboardPage from "../features/sales-purchase/pages/SPDashboardPage.jsx";
import AlertsInsightsPage from "../features/sales-purchase/pages/AlertsInsightsPage.jsx";
import DataHealthPage from "../features/sales-purchase/pages/DataHealthPage.jsx";
import DataImportPage from "../features/sales-purchase/pages/DataImportPage.jsx";
import OutletManagementPage from "../features/sales-purchase/pages/OutletManagementPage.jsx";
import PurchaseInputPage from "../features/sales-purchase/pages/PurchaseInputPage.jsx";
import PurchaseComparisonPage from "../features/sales-purchase/pages/PurchaseComparisonPage.jsx";
import SalesInputPage from "../features/sales-purchase/pages/SalesInputPage.jsx";
import SalesComparisonPage from "../features/sales-purchase/pages/SalesComparisonPage.jsx";
import OutletPnlPage from "../features/sales-purchase/pages/OutletPnlPage.jsx";
import ProductAnalyticsPage from "../features/sales-purchase/pages/ProductAnalyticsPage.jsx";
import OutletDutyRosterPage from "../features/sales-purchase/pages/OutletDutyRosterPage.jsx";
import OperatingExpensesPage from "../features/sales-purchase/pages/OperatingExpensesPage.jsx";
import DutyRosterPage from "../features/sales-purchase/pages/DutyRosterPage.jsx";
import AssetTrackingPage from "../features/sales-purchase/pages/AssetTrackingPage.jsx";
import SettingsPage from "../features/sales-purchase/pages/SettingsPage.jsx";
import SupplierManagementPage from "../features/sales-purchase/pages/SupplierManagementPage.jsx";
import UsersPage from "../features/company-users/pages/UsersPage.jsx";
import JobPositionsPage from "../features/company-users/pages/JobPositionsPage.jsx";
import DepartmentsPage from "../features/company-users/pages/DepartmentsPage.jsx";
import RolesPage from "../features/company-users/pages/RolesPage.jsx";
import AuditLogsPage from "../features/company-users/pages/AuditLogsPage.jsx";
import { getSidebarSections, moduleRegistry, viewPermission } from "../../config/modules.ts";

function ModulePlaceholderPage({ moduleLabel = "Module", moduleSection = "Workspace" }) {
  return (
    <div className="card p-6">
      <div className="text-xs font-bold uppercase tracking-wide text-text-muted">{moduleSection}</div>
      <h2 className="mt-2 text-xl font-semibold text-text-primary">{moduleLabel}</h2>
      <p className="mt-2 text-sm text-text-secondary">
        This module is registered for navigation, permissions, route protection and audit scope, but its working page has not been implemented yet.
      </p>
    </div>
  );
}

const routeDetails = {
  dashboard: {
    description: "Monthly HQ management overview for outlet health, alerts, operations and team moments.",
    component: DashboardOverviewPage,
  },
  "sp-dashboard": {
    description: "Detailed sales and purchase operational analytics dashboard.",
    component: SPDashboardPage,
    permission: "dashboard.view",
  },
  "sales-input": {
    description: "Manual monthly sales entry by outlet and structured channel.",
    component: SalesInputPage,
  },
  "sales-comparison": {
    description: "Modern Jan-Dec sales comparison with totals and previous-period variance.",
    component: SalesComparisonPage,
  },
  "sales-channels": {
    description: "Manage structured sales channels used by sales input and analytics.",
    component: SettingsPage,
    props: { initialTab: "channels", settingsMode: "sales-channels" },
  },
  "tax-settings": {
    description: "Manage outlet-level tax configuration history with effective dates.",
    component: SettingsPage,
    props: { initialTab: "tax", settingsMode: "tax" },
  },
  "purchase-input": {
    description: "Record monthly supplier purchases by outlet.",
    component: PurchaseInputPage,
  },
  "purchase-comparison": {
    description: "Supplier and category purchase comparison with abnormal cell highlighting.",
    component: PurchaseComparisonPage,
  },
  suppliers: {
    description: "Supplier master data used by purchase records through supplier_id.",
    component: SupplierManagementPage,
  },
  "purchase-categories": {
    description: "Manage structured purchase categories used by suppliers and imports.",
    component: SettingsPage,
    props: { initialTab: "categories", settingsMode: "purchase-categories" },
  },
  employees: {
    description: "Manage employee profiles, employment data, bank information and optional system login.",
    component: UsersPage,
    props: { peopleMode: "employees" },
  },
  "job-positions": {
    description: "Manage HR job titles used in employee profiles.",
    component: JobPositionsPage,
  },
  departments: {
    description: "Manage company departments for employee grouping.",
    component: DepartmentsPage,
  },
  roles: {
    description: "Manage company roles.",
    component: RolesPage,
  },
  outlets: {
    description: "Outlet master data used by sales and purchase records through outlet_id.",
    component: OutletManagementPage,
  },
  alerts: {
    description: "Rule-based insight center for abnormal sales and supplier purchase patterns.",
    component: AlertsInsightsPage,
  },
  "outlet-pnl": {
    description: "Yearly management P&L performance by outlet.",
    component: OutletPnlPage,
  },
  product_analytics: {
    description: "Monthly POS product sales report upload and product performance analytics.",
    component: ProductAnalyticsPage,
  },
  outlet_duty_roster: {
    description: "Monthly outlet duty coverage overview.",
    component: OutletDutyRosterPage,
  },
  "operating-expenses": {
    description: "Monthly operating expense input for management P&L.",
    component: OperatingExpensesPage,
  },
  "duty-roster": {
    description: "Weekly outlet employee scheduling by department.",
    component: DutyRosterPage,
  },
  asset_tracking: {
    description: "Track outlet assets, quantities, inspections and movement logs.",
    component: AssetTrackingPage,
  },
  "data-import": {
    description: "Future-ready Excel and CSV import flow with mock progress feedback.",
    component: DataImportPage,
  },
  "data-health": {
    description: "Month lock, completeness checks and data freshness controls.",
    component: DataHealthPage,
  },
  "audit-logs": {
    description: "Review authentication, access, employee and operational audit events.",
    component: AuditLogsPage,
  },
};

export const salesPurchaseRoutes = moduleRegistry.map((module) => {
  const details = routeDetails[module.id] ?? {};
  return {
    id: module.id,
    label: module.label,
    eyebrow: module.section,
    description: details.description ?? `${module.label} workspace.`,
    component: details.component ?? ModulePlaceholderPage,
    permission: details.permission ?? viewPermission(module.id),
    props: {
      moduleId: module.id,
      moduleLabel: module.label,
      moduleSection: module.section,
      ...(details.props ?? {}),
    },
  };
});

export const sidebarSections = getSidebarSections();
