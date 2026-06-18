import DashboardOverviewPage from "../features/sales-purchase/pages/DashboardOverviewPage.jsx";
import SPDashboardPage from "../features/sales-purchase/pages/SPDashboardPage.jsx";
import AlertsInsightsPage from "../features/sales-purchase/pages/AlertsInsightsPage.jsx";
import DataHealthPage from "../features/sales-purchase/pages/DataHealthPage.jsx";
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
import InventoryControlPage from "../features/sales-purchase/pages/InventoryControlPage.jsx";
import SettingsPage from "../features/sales-purchase/pages/SettingsPage.jsx";
import SupplierManagementPage from "../features/sales-purchase/pages/SupplierManagementPage.jsx";
import UsersPage from "../features/company-users/pages/UsersPage.jsx";
import JobPositionsPage from "../features/company-users/pages/JobPositionsPage.jsx";
import DepartmentsPage from "../features/company-users/pages/DepartmentsPage.jsx";
import RolesPage from "../features/company-users/pages/RolesPage.jsx";
import AuditLogsPage from "../features/company-users/pages/AuditLogsPage.jsx";
import FactoryWorkspacePage from "../features/factory/pages/FactoryWorkspacePage.jsx";
import { getSidebarSections, moduleRegistry, viewPermission } from "../../config/modules.ts";

function ModulePlaceholderPage({ moduleId = "", moduleLabel = "Module", moduleSection = "Workspace" }) {
  const isFactoryModule = String(moduleId).startsWith("factory_");
  return (
    <div className="card p-6">
      <div className="text-xs font-bold uppercase tracking-wide text-text-muted">{moduleSection}</div>
      <h2 className="mt-2 text-xl font-semibold text-text-primary">{moduleLabel}</h2>
      <p className="mt-2 text-sm text-text-secondary">
        {isFactoryModule
          ? "This Factory module is registered for navigation, permissions and audit scope, but it is not part of the current functional Factory 1A-1E workflow yet."
          : "This module is registered for navigation, permissions, route protection and audit scope, but its working page has not been implemented yet."}
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
    description: "Manage structured supplier categories used by suppliers and imports.",
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
  inventory_control: {
    description: "Inventory dashboard for stock health, ordering activity and inventory risks.",
    component: InventoryControlPage,
    permission: "inventory_dashboard.view",
    props: { initialTab: "dashboard" },
  },
  inventory_dashboard: {
    description: "Monitor stock health, ordering activity and inventory risks.",
    component: InventoryControlPage,
    permission: "inventory_dashboard.view",
    props: { initialTab: "dashboard" },
  },
  inventory_master: {
    description: "Create and manage all inventory items used across outlets.",
    component: InventoryControlPage,
    permission: "inventory_master.view",
    props: { initialTab: "master" },
  },
  inventory_categories: {
    description: "Manage inventory item categories used across inventory workflows.",
    component: InventoryControlPage,
    permission: "inventory_categories.view",
    props: { initialTab: "categories" },
  },
  inventory_par_levels: {
    description: "Bulk manage outlet-specific minimum stock levels.",
    component: InventoryControlPage,
    permission: "inventory_par_levels.view OR inventory_master.view",
    props: { initialTab: "par-levels" },
  },
  inventory_groups: {
    description: "Manage outlet-level stock check groups and frequencies.",
    component: InventoryControlPage,
    permission: "inventory_groups.view",
    props: { initialTab: "groups" },
  },
  inventory_stock_check: {
    description: "Complete scheduled inventory checks by outlet and group.",
    component: InventoryControlPage,
    permission: "inventory_stock_check.view",
    props: { initialTab: "stock-check" },
  },
  inventory_orders: {
    description: "Create draft POs from reviewed stock check suggestions or manual purchase planning.",
    component: InventoryControlPage,
    permission: "inventory_orders.view",
    props: { initialTab: "orders" },
  },
  inventory_movements: {
    description: "Track purchases, transfers, waste, usage and adjustments.",
    component: InventoryControlPage,
    permission: "inventory_movements.view",
    props: { initialTab: "movements" },
  },
  inventory_waste: {
    description: "Record spoilage, expiry, damaged inventory and kitchen wastage.",
    component: InventoryControlPage,
    permission: "inventory_waste.view",
    props: { initialTab: "waste" },
  },
  inventory_recipes: {
    description: "Link menu items to ingredients and estimate consumption.",
    component: InventoryControlPage,
    permission: "inventory_recipes.view",
    props: { initialTab: "recipes" },
  },
  recipe_intelligence: {
    description: "Analyze recipe profit, mapped product performance, and ingredient demand.",
    component: InventoryControlPage,
    permission: "recipe_intelligence.view",
    props: { initialTab: "recipe-intelligence" },
  },
  "data-health": {
    description: "Month lock, completeness checks and data freshness controls.",
    component: DataHealthPage,
  },
  "audit-logs": {
    description: "Review authentication, access, employee and operational audit events.",
    component: AuditLogsPage,
  },
  factory_dashboard: {
    description: "Factory operations dashboard for production, warehouse and raw material readiness.",
    component: FactoryWorkspacePage,
    permission: "factory_dashboard.view",
    props: { initialTab: "dashboard" },
  },
  factory_job_orders: {
    description: "Create and manage factory production job orders.",
    component: FactoryWorkspacePage,
    permission: "factory_job_orders.view",
    props: { initialTab: "job-orders" },
  },
  factory_raw_receiving: {
    description: "Record supplier deliveries into factory raw material stock.",
    component: FactoryWorkspacePage,
    permission: "factory_raw_receiving.view",
    props: { initialTab: "raw-receiving" },
  },
  factory_raw_inventory: {
    description: "Manage raw material master data and monitor factory raw material balances.",
    component: FactoryWorkspacePage,
    permission: "factory_raw_inventory.view",
    props: { initialTab: "raw-inventory" },
  },
  factory_raw_movements: {
    description: "View raw material stock movement history from receiving, production and stock checks.",
    component: FactoryWorkspacePage,
    permission: "factory_raw_movements.view",
    props: { initialTab: "raw-movements" },
  },
  factory_raw_stock_check: {
    description: "Count factory raw material stock, review variance and approve controlled adjustments.",
    component: FactoryWorkspacePage,
    permission: "factory_raw_stock_check.view",
    props: { initialTab: "raw-stock-check" },
  },
  factory_production: {
    description: "Execute production jobs, capture actual material usage and stock in finished goods.",
    component: FactoryWorkspacePage,
    permission: "factory_production.view",
    props: { initialTab: "production" },
  },
  factory_production_reports: {
    description: "Review read-only factory production, material usage, yield, costing and stock movement reports.",
    component: FactoryWorkspacePage,
    permission: "factory_production_reports.view",
    props: { initialTab: "reports" },
  },
  factory_batch_traceability: {
    description: "Trace production batches across job order, raw material usage, QC and finished goods stock-in.",
    component: FactoryWorkspacePage,
    permission: "factory_batch_traceability.view",
    props: { initialTab: "batch-traceability" },
  },
  factory_finished_goods: {
    description: "Review finished goods SKU balances, production history, batches and movement activity.",
    component: FactoryWorkspacePage,
    permission: "factory_finished_goods.view",
    props: { initialTab: "finished-goods" },
  },
  factory_finished_goods_dispatch: {
    description: "Record outbound finished goods dispatches and finished goods stock-out movement.",
    component: FactoryWorkspacePage,
    permission: "factory_finished_goods_dispatch.view",
    props: { initialTab: "finished-goods-dispatch" },
  },
  factory_product_movements: {
    description: "Review read-only finished goods stock movement history.",
    component: FactoryWorkspacePage,
    permission: "factory_product_movements.view",
    props: { initialTab: "product-movements" },
  },
  factory_product_stock_check: {
    description: "Count finished goods stock, review variance and approve controlled adjustments.",
    component: FactoryWorkspacePage,
    permission: "factory_product_stock_check.view",
    props: { initialTab: "product-stock-check" },
  },
  factory_product_recipes: {
    description: "Manage standard raw material BOMs for Finished Goods production defaults.",
    component: FactoryWorkspacePage,
    permission: "factory_product_recipes.view",
    props: { initialTab: "product-recipes" },
  },
  factory_production_sop: {
    description: "Manage standard production SOP steps and QC checkpoint references by product.",
    component: FactoryWorkspacePage,
    permission: "factory_production_sop.view",
    props: { initialTab: "production-sop" },
  },
  factory_storage_locations: {
    description: "Manage Factory storage locations used by raw material and finished goods master records.",
    component: FactoryWorkspacePage,
    permission: "factory_storage_locations.view",
    props: { initialTab: "storage-locations" },
  },
  factory_suppliers: {
    description: "Manage Factory supplier master data used by raw material receiving.",
    component: FactoryWorkspacePage,
    permission: "factory_suppliers.view",
    props: { initialTab: "suppliers" },
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
