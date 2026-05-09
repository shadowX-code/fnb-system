import DashboardOverviewPage from "../features/sales-purchase/pages/DashboardOverviewPage.jsx";
import AlertsInsightsPage from "../features/sales-purchase/pages/AlertsInsightsPage.jsx";
import DataHealthPage from "../features/sales-purchase/pages/DataHealthPage.jsx";
import DataImportPage from "../features/sales-purchase/pages/DataImportPage.jsx";
import OutletManagementPage from "../features/sales-purchase/pages/OutletManagementPage.jsx";
import PurchaseInputPage from "../features/sales-purchase/pages/PurchaseInputPage.jsx";
import PurchaseComparisonPage from "../features/sales-purchase/pages/PurchaseComparisonPage.jsx";
import SalesInputPage from "../features/sales-purchase/pages/SalesInputPage.jsx";
import SalesComparisonPage from "../features/sales-purchase/pages/SalesComparisonPage.jsx";
import SettingsPage from "../features/sales-purchase/pages/SettingsPage.jsx";
import SupplierManagementPage from "../features/sales-purchase/pages/SupplierManagementPage.jsx";

export const salesPurchaseRoutes = [
  {
    id: "dashboard",
    label: "Dashboard",
    eyebrow: "Overview",
    description: "Saved sales, purchase, COGS, margin and alerts overview.",
    component: DashboardOverviewPage,
  },
  {
    id: "sales-input",
    label: "Sales Input",
    eyebrow: "Sales",
    description: "Manual monthly sales entry by outlet and structured channel.",
    component: SalesInputPage,
  },
  {
    id: "sales-comparison",
    label: "Sales Comparison",
    eyebrow: "Sales",
    description: "Modern Jan-Dec sales comparison with totals and previous-period variance.",
    component: SalesComparisonPage,
  },
  {
    id: "purchase-input",
    label: "Purchase Input",
    eyebrow: "Purchases",
    description: "Record monthly supplier purchases by outlet.",
    component: PurchaseInputPage,
  },
  {
    id: "purchase-comparison",
    label: "Purchase Comparison",
    eyebrow: "Purchases",
    description: "Supplier and category purchase comparison with abnormal cell highlighting.",
    component: PurchaseComparisonPage,
  },
  {
    id: "suppliers",
    label: "Suppliers",
    eyebrow: "Management",
    description: "Supplier master data used by purchase records through supplier_id.",
    component: SupplierManagementPage,
  },
  {
    id: "outlets",
    label: "Outlets",
    eyebrow: "Management",
    description: "Outlet master data used by sales and purchase records through outlet_id.",
    component: OutletManagementPage,
  },
  {
    id: "settings",
    label: "Settings",
    eyebrow: "Settings",
    description: "Manage sales channels and purchase categories for structured reporting.",
    component: SettingsPage,
  },
  {
    id: "alerts",
    label: "Alerts & Insights",
    eyebrow: "Controls",
    description: "Rule-based insight center for abnormal sales and supplier purchase patterns.",
    component: AlertsInsightsPage,
  },
  {
    id: "data-import",
    label: "Data Import",
    eyebrow: "Controls",
    description: "Future-ready Excel and CSV import flow with mock progress feedback.",
    component: DataImportPage,
  },
  {
    id: "data-health",
    label: "Data Health",
    eyebrow: "Controls",
    description: "Month lock, completeness checks and data freshness controls.",
    component: DataHealthPage,
  },
];

export const sidebarSections = [
  {
    label: "Overview",
    items: [{ id: "dashboard", label: "Dashboard" }],
  },
  {
    label: "Sales",
    items: [
      { id: "sales-input", label: "Sales Input" },
      { id: "sales-comparison", label: "Sales Comparison" },
    ],
  },
  {
    label: "Purchases",
    items: [
      { id: "purchase-input", label: "Purchase Input" },
      { id: "purchase-comparison", label: "Purchase Comparison" },
    ],
  },
  {
    label: "Management",
    items: [
      { id: "suppliers", label: "Suppliers" },
      { id: "outlets", label: "Outlets" },
      { id: "settings", label: "Settings" },
    ],
  },
  {
    label: "Controls",
    items: [
      { id: "alerts", label: "Alerts & Insights" },
      { id: "data-import", label: "Data Import" },
      { id: "data-health", label: "Data Health" },
    ],
  },
];
