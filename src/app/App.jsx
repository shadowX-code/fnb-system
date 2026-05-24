import { useEffect, useMemo, useState } from "react";
import ConfirmDialog from "../components/feedback/ConfirmDialog.jsx";
import ToastViewport from "../components/feedback/ToastViewport.jsx";
import AppShell from "../layouts/AppShell.jsx";
import { operationsService } from "../features/sales-purchase/services/operationsService.js";
import { salesPurchaseRoutes, sidebarSections } from "./routes.jsx";
import { outletService } from "../services/outletService.js";
import { supplierService } from "../services/supplierService.js";
import { purchaseCategoryService } from "../services/purchaseCategoryService.js";
import { salesChannelService } from "../services/salesChannelService.js";
import { outletTaxConfigService } from "../services/outletTaxConfigService.js";
import { salesRecordService } from "../services/salesRecordService.js";
import { purchaseRecordService } from "../services/purchaseRecordService.js";
import { operatingExpenseService } from "../services/operatingExpenseService.js";
import { useAuth } from "../auth/AuthContext.jsx";
import LoginPage from "../auth/LoginPage.jsx";
import SetNewPasswordPage from "../auth/SetNewPasswordPage.jsx";
import { filterOutletScopedRows, getAccessibleOutlets } from "../utils/accessControl.js";

function normalizeSuppliers(suppliers, categories) {
  return suppliers.map((supplier) => {
    const category = categories.find(
      (item) =>
        item.id === supplier.default_category_id ||
        item.id === supplier.category ||
        item.name.toLowerCase() === String(supplier.category ?? "").toLowerCase(),
    );
    const isActive = supplier.is_active ?? supplier.status !== "inactive";
    return {
      id: supplier.id,
      name: supplier.name,
      category: supplier.category ?? category?.name ?? "",
      phone: supplier.phone ?? "",
      remark: supplier.remark ?? "",
      is_active: Boolean(isActive),
      status: isActive ? "active" : "inactive",
      default_category_id: supplier.default_category_id || category?.id || categories[0]?.id || "",
      created_at: supplier.created_at ?? "",
      updated_at: supplier.updated_at ?? "",
    };
  });
}

function inferSalesChannelType(name) {
  const normalized = String(name ?? "").toLowerCase();
  if (normalized === "net sales" || normalized === "nett sales" || normalized === "gross sales") {
    return "total";
  }
  if (
    normalized.includes("sst") ||
    normalized.includes("deduction") ||
    normalized.includes("refund") ||
    normalized.includes("commission") ||
    normalized.includes("subsidy") ||
    normalized.includes("adjustment")
  ) {
    return "adjustment";
  }
  return "channel";
}

function canonicalSalesChannelName(name) {
  const normalized = String(name ?? "").toLowerCase();
  if (normalized.includes("sst")) return "sst";
  return normalized.replace(/\(-\)/g, "").replace(/deduction/g, "").replace(/[^a-z0-9]+/g, "").trim();
}

function normalizeSalesChannels(channels) {
  return channels.map((channel, index) => ({
    id: channel.id,
    name: channel.name,
    is_active: channel.is_active ?? channel.status !== "inactive",
    status: channel.status ?? ((channel.is_active ?? true) ? "active" : "inactive"),
    type: channel.type || inferSalesChannelType(channel.name),
    sort_order: channel.sort_order ?? index + 1,
    created_at: channel.created_at,
    updated_at: channel.updated_at,
  }));
}

function remapSalesRecordsToChannels(records, previousChannels, nextChannels) {
  const previousById = new Map(previousChannels.map((channel) => [channel.id, channel]));
  const nextByCanonicalName = new Map(nextChannels.map((channel) => [canonicalSalesChannelName(channel.name), channel]));

  return records.map((record) => {
    const previousChannel = previousById.get(record.channel_id);
    if (!previousChannel) return record;
    const nextChannel = nextByCanonicalName.get(canonicalSalesChannelName(previousChannel.name));
    if (!nextChannel) return record;
    return { ...record, channel_id: nextChannel.id };
  });
}

function filterRoutesByPermission(routes, auth) {
  return routes.filter((route) => !route.permission || auth.hasPermission(route.permission));
}

function filterSectionsByPermission(sections, routes, auth) {
  const routeById = new Map(routes.map((route) => [route.id, route]));
  return sections
    .map((section) => {
      const items = section.items.filter((item) => {
        if (item.type === "label") return true;
        const route = routeById.get(item.id);
        return route && (!route.permission || auth.hasPermission(route.permission));
      });
      const hasVisibleRoute = items.some((item) => item.type !== "label");
      return { ...section, items: hasVisibleRoute ? items : [] };
    })
    .filter((section) => section.items.length);
}

const BOOTSTRAP_LOADS = [
  { key: "outlets", label: "Outlets", table: "outlets", operation: "SELECT", permission: "outlets.view OR dashboard.view OR outlet_pnl.view OR outlet_duty_roster.view OR operating_expenses.view OR duty_roster.view" },
  { key: "suppliers", label: "Suppliers", table: "suppliers", operation: "SELECT", permission: "suppliers.view OR purchase_input.view OR purchase_comparison.view OR data_import.view" },
  { key: "purchaseCategories", label: "Purchase Categories", table: "purchase_categories", operation: "SELECT", permission: "purchase_categories.view OR purchase_input.view OR purchase_comparison.view OR data_import.view" },
  { key: "salesChannels", label: "Sales Channels", table: "sales_channels", operation: "SELECT", permission: "sales_channels.view OR sales_input.view OR sales_comparison.view OR data_import.view OR outlet_pnl.view" },
  { key: "outletTaxConfigs", label: "Tax Settings", table: "outlet_tax_configs", operation: "SELECT", permission: "tax_settings.view OR sales_input.view OR dashboard.view" },
  { key: "salesRecords", label: "Sales Records", table: "sales_records", operation: "SELECT", permission: "dashboard.view OR sales_input.view OR sales_comparison.view OR outlet_pnl.view" },
  { key: "purchaseRecords", label: "Purchase Records", table: "purchase_records", operation: "SELECT", permission: "dashboard.view OR purchase_input.view OR purchase_comparison.view OR outlet_pnl.view" },
  { key: "operatingExpenses", label: "Operating Expenses", table: "operating_expenses", operation: "SELECT", permission: "operating_expenses.view OR outlet_pnl.view" },
];

function RbacDiagnosticsPanel({ auth, loads }) {
  if (!import.meta.env.DEV) return null;

  const permissionChecks = [
    "dashboard.view",
    "sales_input.view",
    "sales_input.create",
    "sales_input.edit",
    "sales_comparison.view",
    "purchase_input.view",
    "purchase_input.create",
    "purchase_input.edit",
    "purchase_comparison.view",
    "outlet_pnl.view",
    "outlet_pnl.export",
    "outlet_duty_roster.view",
    "outlet_duty_roster.export",
    "operating_expenses.view",
    "operating_expenses.create",
    "operating_expenses.edit",
    "operating_expenses.delete",
    "duty_roster.view",
    "duty_roster.create",
    "duty_roster.edit",
    "duty_roster.delete",
    "duty_roster.manage",
    "duty_roster.export",
    "suppliers.view",
    "purchase_categories.view",
    "sales_channels.view",
    "tax_settings.view",
    "outlets.view",
    "employees.view",
    "departments.view",
    "job_positions.view",
    "roles.view",
    "audit_logs.view",
    "data_import.import",
  ];
  const failedLoads = loads.filter((load) => load.status === "error");
  return (
    <details className="card mb-4 border-amber-200 bg-amber-50 p-4 text-xs text-amber-950">
      <summary className="cursor-pointer text-sm font-bold text-amber-900">Access Diagnostics</summary>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-amber-200 bg-white/70 p-3">
          <div className="font-bold uppercase tracking-wide text-amber-700">Current User</div>
          <div className="mt-2 space-y-1">
            <div>User ID: {auth.user?.id ?? "—"}</div>
            <div>Email: {auth.user?.email ?? "—"}</div>
            <div>Employee profile: {auth.profile?.id ?? "—"}</div>
            <div>Role: {auth.profile?.role_name ?? "—"}</div>
            <div>Outlet access: {auth.isProtectedRole ? "All outlets" : `${auth.profile?.role_outlet_ids?.length ?? 0} assigned outlet(s)`}</div>
            <div>Access state: {auth.profile?.access_state ?? "—"}</div>
            <div>Login type: {auth.source === "database" ? "Secure login" : "Limited access"}</div>
            <div>Permission count: {auth.permissions.length}</div>
          </div>
          {auth.source !== "database" ? (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2 font-semibold text-red-700">
              Data access requires a secure employee login with assigned role permissions.
            </div>
          ) : null}
        </div>
        <div className="rounded-xl border border-amber-200 bg-white/70 p-3">
          <div className="font-bold uppercase tracking-wide text-amber-700">Permission Checks</div>
          <div className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
            {permissionChecks.map((code) => (
              <div key={code} className={auth.hasPermission(code) ? "text-emerald-700" : "text-red-700"}>
                {auth.hasPermission(code) ? "OK" : "NO"} {code}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-3 rounded-xl border border-amber-200 bg-white/70 p-3">
          <div className="font-bold uppercase tracking-wide text-amber-700">Startup Data Loads</div>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-amber-100 text-[11px] uppercase text-amber-700">
                <th className="py-1 pr-3">Module</th>
                <th className="py-1 pr-3">Data Source</th>
                <th className="py-1 pr-3">Action</th>
                <th className="py-1 pr-3">Required Permission</th>
                <th className="py-1 pr-3">Status</th>
                <th className="py-1 pr-3">Error</th>
              </tr>
            </thead>
            <tbody>
              {loads.map((load) => (
                <tr key={load.key} className="border-b border-amber-50">
                  <td className="py-1 pr-3 font-semibold">{load.label}</td>
                  <td className="py-1 pr-3">{load.table}</td>
                  <td className="py-1 pr-3">{load.operation}</td>
                  <td className="py-1 pr-3">{load.permission}</td>
                  <td className={load.status === "loaded" ? "py-1 pr-3 font-semibold text-emerald-700" : "py-1 pr-3 font-semibold text-red-700"}>
                    {load.status}
                  </td>
                  <td className="py-1 pr-3">{load.error ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {failedLoads.length ? <div className="mt-2 font-semibold text-red-700">{failedLoads.length} module load failure(s) detected.</div> : null}
      </div>
    </details>
  );
}

export default function App() {
  const auth = useAuth();
  const initialRoute = window.location.hash?.replace("#", "") || "dashboard";
  const [activeRouteId, setActiveRouteId] = useState(
    salesPurchaseRoutes.some((route) => route.id === initialRoute) ? initialRoute : "dashboard",
  );
  const [store, setStore] = useState(() => ({ ...operationsService.getBootstrapData(), outlets: [], suppliers: [], purchaseCategories: [], salesChannels: [], operatingExpenses: [] }));
  const [masterDataStatus, setMasterDataStatus] = useState({ loading: true, errors: [], loads: BOOTSTRAP_LOADS.map((load) => ({ ...load, status: "pending" })) });
  const [toasts, setToasts] = useState([]);
  const [confirmRequest, setConfirmRequest] = useState(null);
  const accessibleRoutes = useMemo(() => filterRoutesByPermission(salesPurchaseRoutes, auth), [auth.permissions]);
  const accessibleSections = useMemo(() => filterSectionsByPermission(sidebarSections, salesPurchaseRoutes, auth), [auth.permissions]);
  const activeRoute = useMemo(
    () => accessibleRoutes.find((route) => route.id === activeRouteId) ?? accessibleRoutes[0] ?? salesPurchaseRoutes[0],
    [accessibleRoutes, activeRouteId],
  );
  const ActivePage = activeRoute.component;

  useEffect(() => {
    if (!auth.session || auth.passwordRecovery) return undefined;
    let ignore = false;
    async function loadMasterData() {
      setMasterDataStatus({ loading: true, errors: [], loads: BOOTSTRAP_LOADS.map((load) => ({ ...load, status: "pending" })) });
      const errors = [];
      const loads = BOOTSTRAP_LOADS.map((load) => ({ ...load, status: "pending" }));
      const markLoad = (key, result, message) => {
        const index = loads.findIndex((load) => load.key === key);
        if (index === -1) return;
        loads[index] = { ...loads[index], status: result, error: message };
        if (import.meta.env.DEV) {
          console.info("[FeedX module load]", {
            ...loads[index],
            role: auth.profile?.role_name ?? null,
            permission_count: auth.permissions.length,
            permission_result: loads[index].permission.split(" OR ").some((permission) => auth.hasPermission(permission)),
          });
        }
      };
      let outlets = [];
      let suppliers = [];
      let purchaseCategories = [];
      let salesChannels = [];
      let outletTaxConfigs = [];
      let salesRecords = [];
      let purchaseRecords = [];
      let operatingExpenses = [];

      const [outletResult, supplierResult, categoryResult, salesChannelResult, taxConfigResult, salesRecordResult, purchaseRecordResult, operatingExpenseResult] = await Promise.allSettled([
        outletService.listActiveOutlets(),
        supplierService.listSuppliers(),
        purchaseCategoryService.listPurchaseCategories(),
        salesChannelService.listSalesChannels(),
        outletTaxConfigService.listOutletTaxConfigs(),
        salesRecordService.listSalesRecords(),
        purchaseRecordService.listPurchaseRecords(),
        operatingExpenseService.listOperatingExpenses(),
      ]);
      if (outletResult.status === "fulfilled") {
        outlets = outletResult.value;
        markLoad("outlets", "loaded");
      }
      else {
        console.error("Unable to load outlets", outletResult.reason);
        markLoad("outlets", "error", outletResult.reason?.message || "Unable to load outlets.");
        errors.push("Unable to load outlets. Please refresh.");
      }
      if (supplierResult.status === "fulfilled") {
        suppliers = supplierResult.value;
        markLoad("suppliers", "loaded");
      }
      else {
        console.error("Unable to load suppliers", supplierResult.reason);
        markLoad("suppliers", "error", supplierResult.reason?.message || "Unable to load suppliers.");
        errors.push("Unable to load suppliers.");
      }
      if (categoryResult.status === "fulfilled") {
        purchaseCategories = categoryResult.value;
        markLoad("purchaseCategories", "loaded");
      }
      else {
        console.error("Unable to load categories", categoryResult.reason);
        markLoad("purchaseCategories", "error", categoryResult.reason?.message || "Unable to load categories.");
        errors.push("Unable to load categories.");
      }
      if (salesChannelResult.status === "fulfilled") {
        salesChannels = normalizeSalesChannels(salesChannelResult.value);
        markLoad("salesChannels", "loaded");
      }
      else {
        console.error("Unable to load sales channels", salesChannelResult.reason);
        markLoad("salesChannels", "error", salesChannelResult.reason?.message || "Unable to load sales channels.");
        errors.push("Unable to load sales channels.");
      }
      if (taxConfigResult.status === "fulfilled") {
        outletTaxConfigs = taxConfigResult.value;
        markLoad("outletTaxConfigs", "loaded");
      }
      else {
        console.error("Unable to load tax settings", taxConfigResult.reason);
        markLoad("outletTaxConfigs", "error", taxConfigResult.reason?.message || "Unable to load tax settings.");
        errors.push("Unable to load tax settings.");
      }
      if (salesRecordResult.status === "fulfilled") {
        salesRecords = salesRecordResult.value;
        markLoad("salesRecords", "loaded");
      }
      else {
        console.error("Unable to load sales records", salesRecordResult.reason);
        markLoad("salesRecords", "error", salesRecordResult.reason?.message || "Unable to load sales records.");
        errors.push("Unable to load sales records.");
      }
      if (purchaseRecordResult.status === "fulfilled") {
        purchaseRecords = purchaseRecordResult.value;
        markLoad("purchaseRecords", "loaded");
      }
      else {
        console.error("Unable to load purchase records", purchaseRecordResult.reason);
        markLoad("purchaseRecords", "error", purchaseRecordResult.reason?.message || "Unable to load purchase records.");
        errors.push("Unable to load purchase records.");
      }
      if (operatingExpenseResult.status === "fulfilled") {
        operatingExpenses = operatingExpenseResult.value;
        markLoad("operatingExpenses", "loaded");
      }
      else {
        console.error("Unable to load operating expenses", operatingExpenseResult.reason);
        markLoad("operatingExpenses", "error", operatingExpenseResult.reason?.message || "Unable to load operating expenses.");
        errors.push("Unable to load operating expenses.");
      }

      if (!ignore) {
        const scopedOutlets = getAccessibleOutlets(auth, outlets);
        setStore((current) => ({
          ...current,
          ...(outletResult.status === "fulfilled" ? { outlets: scopedOutlets } : {}),
          ...(taxConfigResult.status === "fulfilled" ? { outletTaxConfigs: filterOutletScopedRows(auth, outletTaxConfigs) } : {}),
          ...(categoryResult.status === "fulfilled" ? { purchaseCategories } : {}),
          ...(supplierResult.status === "fulfilled" ? { suppliers: normalizeSuppliers(suppliers, purchaseCategories.length ? purchaseCategories : current.purchaseCategories) } : {}),
          ...(salesChannelResult.status === "fulfilled" ? { salesChannels } : {}),
          ...(salesRecordResult.status === "fulfilled" ? { salesRecords: filterOutletScopedRows(auth, salesRecords) } : {}),
          ...(purchaseRecordResult.status === "fulfilled" ? { purchaseRecords: filterOutletScopedRows(auth, purchaseRecords) } : {}),
          ...(operatingExpenseResult.status === "fulfilled" ? { operatingExpenses: filterOutletScopedRows(auth, operatingExpenses) } : {}),
        }));
        setMasterDataStatus({ loading: false, errors, loads });
      }
    }
    loadMasterData();
    return () => {
      ignore = true;
    };
  }, [auth.passwordRecovery, auth.session]);

  useEffect(() => {
    if (!auth.session || auth.loading || auth.contextLoading || !accessibleRoutes.length) return;
    if (!accessibleRoutes.some((route) => route.id === activeRouteId)) {
      navigate(accessibleRoutes[0].id);
    }
  }, [accessibleRoutes, activeRouteId, auth.contextLoading, auth.loading, auth.session]);

  function navigate(routeId) {
    setActiveRouteId(routeId);
    window.history.replaceState(null, "", `#${routeId}`);
  }

  function notify({ title, message = "", tone = "success" }) {
    const id = crypto.randomUUID();
    setToasts((current) => [...current, { id, title, message, tone }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 3200);
  }

  function confirm(options) {
    return new Promise((resolve) => {
      setConfirmRequest({ ...options, resolve });
    });
  }

  const ui = { notify, confirm, navigate };

  if (auth.loading || auth.contextLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-app-bg px-4">
        <div className="card p-6 text-sm font-semibold text-text-secondary">Loading Smart Operations Workspace...</div>
      </div>
    );
  }

  if (auth.passwordRecovery) {
    return <SetNewPasswordPage />;
  }

  if (!auth.session) {
    return <LoginPage />;
  }

  if (auth.error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-app-bg px-4">
        <div className="card max-w-md border-amber-200 bg-amber-50 p-6 text-center">
          <div className="text-sm font-bold uppercase tracking-wide text-amber-700">Access Error</div>
          <h1 className="mt-2 text-xl font-semibold text-text-primary">Unable to load your access permissions</h1>
          <p className="mt-2 text-sm text-text-secondary">{auth.error || "Please contact admin."}</p>
          <button className="btn-secondary mt-4" type="button" onClick={auth.signOut}>Back to Login</button>
        </div>
      </div>
    );
  }

  if (!accessibleRoutes.length) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-app-bg px-4">
        <div className="card max-w-md border-amber-200 bg-amber-50 p-6 text-center">
          <div className="text-sm font-bold uppercase tracking-wide text-amber-700">No Access</div>
          <h1 className="mt-2 text-xl font-semibold text-text-primary">No modules are available for your role</h1>
          <p className="mt-2 text-sm text-text-secondary">Please contact admin to review your role permissions.</p>
          <button className="btn-secondary mt-4" type="button" onClick={auth.signOut}>Back to Login</button>
        </div>
      </div>
    );
  }

  return (
    <>
      <AppShell
        activeRoute={activeRoute}
        activeRouteId={activeRouteId}
        sections={accessibleSections}
        onNavigate={navigate}
        store={store}
        auth={auth}
        onLogout={auth.signOut}
        onNotify={notify}
      >
        {masterDataStatus.loading ? (
          <div className="card space-y-2 p-6 text-sm font-semibold text-text-secondary">
            <div>Loading FeedX outlets...</div>
            <div>Loading FeedX suppliers...</div>
            <div>Loading FeedX categories...</div>
            <div>Loading FeedX sales channels...</div>
            <div>Loading FeedX tax settings...</div>
            <div>Loading FeedX operating expenses...</div>
          </div>
        ) : (
          <>
            {masterDataStatus.errors.length ? (
              <div className="card mb-4 border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800">
                <div>Some data could not be loaded. Available modules will continue using the data that loaded successfully.</div>
                <div className="mt-2 space-y-1 text-xs">
                  {masterDataStatus.errors.map((error) => <div key={error}>{error}</div>)}
                </div>
              </div>
            ) : null}
            <RbacDiagnosticsPanel auth={auth} loads={masterDataStatus.loads} />
            <ActivePage store={store} setStore={setStore} ui={ui} auth={auth} {...(activeRoute.props ?? {})} />
          </>
        )}
      </AppShell>
      <ToastViewport
        toasts={toasts}
        onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))}
      />
      <ConfirmDialog
        request={confirmRequest}
        onCancel={() => {
          confirmRequest?.resolve(false);
          setConfirmRequest(null);
        }}
        onConfirm={() => {
          confirmRequest?.resolve(true);
          setConfirmRequest(null);
        }}
      />
    </>
  );
}
