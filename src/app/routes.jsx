import { lazy } from "react";
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
import ReportsPage from "../features/reports/pages/ReportsPage.jsx";
import OperatingExpensesPage from "../features/sales-purchase/pages/OperatingExpensesPage.jsx";
import SharedDutyRosterPage from "../features/roster/pages/SharedDutyRosterPage.jsx";
import SettingsPage from "../features/sales-purchase/pages/SettingsPage.jsx";
import SupplierManagementPage from "../features/sales-purchase/pages/SupplierManagementPage.jsx";
import UsersPage from "../features/company-users/pages/UsersPage.jsx";
import JobPositionsPage from "../features/company-users/pages/JobPositionsPage.jsx";
import DepartmentsPage from "../features/company-users/pages/DepartmentsPage.jsx";
import RolesPage from "../features/company-users/pages/RolesPage.jsx";
import AuditLogsPage from "../features/company-users/pages/AuditLogsPage.jsx";
import CrewWorkspacePage from "../features/crew/pages/CrewWorkspacePage.jsx";
import CrewAttendanceAdminPage from "../features/crew/pages/CrewAttendanceAdminPage.jsx";
import CrewLearningAdminResetPage from "../features/crew/pages/CrewLearningAdminResetPage.jsx";
import CrewSopLibraryPage from "../features/crew/pages/CrewSopLibraryPage.jsx";
import CrewGrowthAdminPage from "../features/crew/pages/CrewGrowthAdminPage.jsx";
import CrewPerformanceAdminPage from "../features/crew/pages/CrewPerformanceAdminPage.jsx";
import CrewRewardAdminPage from "../features/crew/pages/CrewRewardAdminPage.jsx";
import CrewOperationsAdminPage from "../features/crew/pages/CrewOperationsAdminPage.jsx";
import CrewLeaveAdminPage from "../features/crew/pages/CrewLeaveAdminPage.jsx";
import CrewCashCheckoutAdminPage from "../features/crew/pages/CrewCashCheckoutAdminPage.jsx";
import { GuestAiDeveloperPage, GuestAiDevicesPage, GuestAiInteractionsPage, GuestAiOverviewPage, GuestAiStudioPage } from "../features/guest-ai/pages/GuestAiWorkspacePages.jsx";
import { getSidebarSections, moduleRegistry, viewPermission } from "../../config/modules.ts";

// Keep one component identity per feature, including all of its route aliases.
const FactoryWorkspacePage = lazy(() => import("../features/factory/pages/FactoryWorkspacePage.jsx"));
const InventoryControlPage = lazy(() => import("../features/sales-purchase/pages/InventoryControlPage.jsx"));
const AssetTrackingPage = lazy(() => import("../features/sales-purchase/pages/AssetTrackingPage.jsx"));

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

export const routeDetails = {
  guest_ai_overview: {
    description: "Guest AI device, voice runtime, and foundation status overview.",
    component: GuestAiOverviewPage,
    permission: "guest_ai.access",
  },
  guest_ai_devices: {
    description: "Canonical ownership view for Guest AI devices and local device health.",
    component: GuestAiDevicesPage,
    permission: "guest_ai.access",
  },
  guest_ai_interactions: {
    description: "Privacy-first interaction domain with no persisted guest conversation history.",
    component: GuestAiInteractionsPage,
    permission: "guest_ai.access",
  },
  guest_ai_studio: {
    description: "Current bounded Guest AI runtime configuration and provider status.",
    component: GuestAiStudioPage,
    permission: "guest_ai.access",
  },
  guest_ai_developer: {
    description: "Developer-only Guest AI device, voice, and protocol diagnostics console.",
    component: GuestAiDeveloperPage,
    permission: "guest_ai.developer",
  },
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
  reports: {
    description: "Generate outlet-scoped Monthly Profit and Yearly P&L poster previews from the canonical Reporting read contract.",
    component: ReportsPage,
  },
  product_analytics: {
    description: "Monthly POS product sales report upload and product performance analytics.",
    component: ProductAnalyticsPage,
  },
  outlet_duty_roster: {
    description: "Legacy Restaurant roster link resolved to the Crew-owned Duty Roster.",
    component: SharedDutyRosterPage,
    permission: "crew_roster.view",
    props: { ownership: "crew" },
  },
  "operating-expenses": {
    description: "Monthly operating expense input for management P&L.",
    component: OperatingExpensesPage,
  },
  "duty-roster": {
    description: "Legacy Restaurant roster link resolved to the Crew-owned Duty Roster.",
    component: SharedDutyRosterPage,
    permission: "crew_roster.view",
    props: { ownership: "crew" },
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
    description: "Monitor released, in-progress and completed Factory production work.",
    component: FactoryWorkspacePage,
    permission: "factory_job_orders.view",
    props: { initialTab: "production-overview" },
  },
  factory_job_order_records: {
    description: "Create, manage and review Factory production job orders.",
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
  factory_production_planning: {
    description: "Monitor finished goods stock against par levels and create production job orders.",
    component: FactoryWorkspacePage,
    permission: "factory_production_planning.view",
    props: { initialTab: "production-planning" },
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
  factory_mesti_cleaning: {
    description: "Complete and verify MeSTI Cleaning of Area requirements with monthly compliance history.",
    component: FactoryWorkspacePage,
    permission: "factory_mesti_cleaning.view",
    props: { initialTab: "mesti-cleaning" },
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
    permission: "factory_production_sop.view OR factory_production_sop.create OR factory_production_sop.edit OR factory_production_sop.manage",
    props: { initialTab: "production-sop" },
  },
  factory_audit_logs: {
    description: "Review read-only Factory module audit events and document changes.",
    component: FactoryWorkspacePage,
    permission: "factory_audit_logs.view",
    props: { initialTab: "audit-logs" },
  },
  factory_storage_locations: {
    description: "Manage Factory Locations and storage eligibility for stock workflows.",
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
  factory_customers: {
    description: "Manage Factory customer and destination master data used by finished goods dispatch.",
    component: FactoryWorkspacePage,
    permission: "factory_customers.view",
    props: { initialTab: "customers" },
  },
  crew_dashboard: {
    description: "Crew mobile access and workforce foundation overview.",
    component: CrewWorkspacePage,
    permission: "crew_dashboard.view",
  },
  crew_employees: {
    description: "Manage employee Crew mobile access and one-time passcodes.",
    component: CrewWorkspacePage,
    permission: "crew_employees.view",
    props: { initialTab: "employees" },
  },
  crew_attendance: {
    description: "Review Crew mobile attendance history.",
    component: CrewAttendanceAdminPage,
    permission: "crew_attendance.view",
  },
  crew_roster: {
    description: "Plan and publish the shared outlet Duty Roster from Crew Workforce.",
    component: SharedDutyRosterPage,
    permission: "crew_roster.view",
    props: { ownership: "crew" },
  },
  crew_leave: {
    description: "Review employee leave requests with roster context and controlled approval projections.",
    component: CrewLeaveAdminPage,
    permission: "crew_leave.view",
  },
  crew_operations: {
    description: "Create, schedule, assign and review unified outlet Tasks.",
    component: CrewOperationsAdminPage,
    permission: "crew_operations.view",
    props: {},
  },
  crew_cash_checkout: {
    description: "Reconcile outlet cash and review the linked Cash Deposit ledger.",
    component: CrewCashCheckoutAdminPage,
    permission: "crew_cash_checkout.view OR crew_cash_deposit.view",
  },
  crew_operation_templates: {
    description: "Compatibility route for the unified Crew Tasks workspace.",
    component: CrewOperationsAdminPage,
    permission: "crew_operations.view",
    props: {},
  },
  crew_learning: {
    description: "Configure mandatory outlet onboarding and review Crew progress.",
    component: CrewLearningAdminResetPage,
    permission: "crew_learning.view OR crew_learning.manage",
    props: { initialTab: "onboarding" },
  },
  crew_journeys: {
    description: "Compatibility route for outlet onboarding.",
    component: CrewLearningAdminResetPage,
    permission: "crew_learning.view OR crew_learning.manage",
    props: { initialTab: "onboarding" },
  },
  crew_progress: {
    description: "Compatibility route for outlet onboarding progress.",
    component: CrewLearningAdminResetPage,
    permission: "crew_learning.view OR crew_learning.manage",
    props: { initialTab: "onboarding" },
  },
  crew_sop_library: {
    description: "Maintain versioned Crew SOPs and acknowledgement content.",
    component: CrewSopLibraryPage,
    permission: "crew_sop.view OR crew_sop.manage",
  },
  crew_growth: {
    description: "Monitor outlet skill coverage and Crew certification readiness.",
    component: CrewGrowthAdminPage,
    permission: "crew_growth.view",
    props: { initialTab: "overview" },
  },
  crew_growth_skills: {
    description: "Maintain outlet-scoped Crew skills and certification requirements.",
    component: CrewGrowthAdminPage,
    permission: "crew_growth.view",
    props: { initialTab: "skills" },
  },
  crew_growth_people: {
    description: "Compatibility route for the unified Growth Overview.",
    component: CrewGrowthAdminPage,
    permission: "crew_growth.view",
    props: { initialTab: "overview" },
  },
  crew_growth_reviews: {
    description: "Compatibility route for integrated Growth Overview certification review.",
    component: CrewGrowthAdminPage,
    permission: "crew_growth.view",
    props: { initialTab: "overview" },
  },
  crew_performance: {
    description: "Review explainable monthly Crew performance and evidence.",
    component: CrewPerformanceAdminPage,
    permission: "crew_performance.view",
    props: { initialTab: "overview" },
  },
  crew_performance_reviews: {
    description: "Compatibility route for the unified Performance Overview Review Queue.",
    component: CrewPerformanceAdminPage,
    permission: "crew_performance.review",
    props: { initialTab: "overview" },
  },
  crew_customer_feedback: {
    description: "Review outlet-bound guest feedback and audited scoring exclusions.",
    component: CrewPerformanceAdminPage,
    permission: "crew_feedback.view",
    props: { initialTab: "feedback" },
  },
  crew_reward: {
    description: "Manage transparent outlet monthly Reward Pools and Crew payouts.",
    component: CrewRewardAdminPage,
    permission: "crew_reward.view",
    props: { initialTab: "overview" },
  },
  crew_reward_cycles: {
    description: "Compatibility route for unified Reward Overview Campaign history.",
    component: CrewRewardAdminPage,
    permission: "crew_reward.view",
    props: {},
  },
};

export const salesPurchaseRoutes = moduleRegistry.filter((module) => module.routable !== false).map((module) => {
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
