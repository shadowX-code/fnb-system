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
import { useAuth } from "../auth/AuthContext.jsx";
import LoginPage from "../auth/LoginPage.jsx";

function TemporaryPasswordReset({ auth }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");

  function submit(event) {
    event.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    auth.completeTemporaryPasswordReset(password);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-app-bg px-4">
      <form className="card w-full max-w-md space-y-4 p-6" onSubmit={submit}>
        <div>
          <div className="text-xs font-bold uppercase tracking-wide text-primary">Temporary Password</div>
          <h1 className="mt-2 text-xl font-semibold text-text-primary">Please change your password before continuing.</h1>
          <p className="mt-2 text-sm text-text-secondary">This alpha onboarding flow uses a temporary password. Production will use branded Supabase invitation emails.</p>
        </div>
        <label className="block">
          <span className="text-xs font-semibold text-text-secondary">New Password</span>
          <input className="control mt-1 h-11 w-full" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-text-secondary">Confirm Password</span>
          <input className="control mt-1 h-11 w-full" type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="new-password" />
        </label>
        {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</div> : null}
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" type="button" onClick={auth.signOut}>Back to Login</button>
          <button className="btn-primary" type="submit">Change Password</button>
        </div>
      </form>
    </div>
  );
}

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

export default function App() {
  const auth = useAuth();
  const initialRoute = window.location.hash?.replace("#", "") || "dashboard";
  const [activeRouteId, setActiveRouteId] = useState(
    salesPurchaseRoutes.some((route) => route.id === initialRoute) ? initialRoute : "dashboard",
  );
  const [store, setStore] = useState(() => ({ ...operationsService.getBootstrapData(), outlets: [], suppliers: [], purchaseCategories: [], salesChannels: [] }));
  const [masterDataStatus, setMasterDataStatus] = useState({ loading: true, errors: [] });
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
    if (!auth.session) return undefined;
    let ignore = false;
    async function loadMasterData() {
      setMasterDataStatus({ loading: true, errors: [] });
      const errors = [];
      let outlets = [];
      let suppliers = [];
      let purchaseCategories = [];
      let salesChannels = [];
      let outletTaxConfigs = [];
      let salesRecords = [];
      let purchaseRecords = [];

      const [outletResult, supplierResult, categoryResult, salesChannelResult, taxConfigResult, salesRecordResult, purchaseRecordResult] = await Promise.allSettled([
        outletService.listActiveOutlets(),
        supplierService.listSuppliers(),
        purchaseCategoryService.listPurchaseCategories(),
        salesChannelService.listSalesChannels(),
        outletTaxConfigService.listOutletTaxConfigs(),
        salesRecordService.listSalesRecords(),
        purchaseRecordService.listPurchaseRecords(),
      ]);
      if (outletResult.status === "fulfilled") outlets = outletResult.value;
      else {
        console.error("Unable to load outlets", outletResult.reason);
        errors.push("Unable to load outlets. Please refresh.");
      }
      if (supplierResult.status === "fulfilled") suppliers = supplierResult.value;
      else {
        console.error("Unable to load suppliers", supplierResult.reason);
        errors.push("Unable to load suppliers.");
      }
      if (categoryResult.status === "fulfilled") purchaseCategories = categoryResult.value;
      else {
        console.error("Unable to load categories", categoryResult.reason);
        errors.push("Unable to load categories.");
      }
      if (salesChannelResult.status === "fulfilled") salesChannels = normalizeSalesChannels(salesChannelResult.value);
      else {
        console.error("Unable to load sales channels", salesChannelResult.reason);
        errors.push("Unable to load sales channels.");
      }
      if (taxConfigResult.status === "fulfilled") outletTaxConfigs = taxConfigResult.value;
      else {
        console.error("Unable to load tax settings", taxConfigResult.reason);
        errors.push("Unable to load tax settings.");
      }
      if (salesRecordResult.status === "fulfilled") salesRecords = salesRecordResult.value;
      else {
        console.error("Unable to load sales records", salesRecordResult.reason);
        errors.push("Unable to load sales records.");
      }
      if (purchaseRecordResult.status === "fulfilled") purchaseRecords = purchaseRecordResult.value;
      else {
        console.error("Unable to load purchase records", purchaseRecordResult.reason);
        errors.push("Unable to load purchase records.");
      }

      if (!ignore) {
        setStore((current) => ({
          ...current,
          ...(outletResult.status === "fulfilled" ? { outlets } : {}),
          ...(taxConfigResult.status === "fulfilled" ? { outletTaxConfigs } : {}),
          ...(categoryResult.status === "fulfilled" ? { purchaseCategories } : {}),
          ...(supplierResult.status === "fulfilled" ? { suppliers: normalizeSuppliers(suppliers, purchaseCategories.length ? purchaseCategories : current.purchaseCategories) } : {}),
          ...(salesChannelResult.status === "fulfilled" ? { salesChannels } : {}),
          ...(salesRecordResult.status === "fulfilled" ? { salesRecords } : {}),
          ...(purchaseRecordResult.status === "fulfilled" ? { purchaseRecords } : {}),
        }));
        setMasterDataStatus({ loading: false, errors });
      }
    }
    loadMasterData();
    return () => {
      ignore = true;
    };
  }, [auth.session]);

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

  if (!auth.session) {
    return <LoginPage />;
  }

  if (auth.requiresPasswordReset) {
    return <TemporaryPasswordReset auth={auth} />;
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
      >
        {masterDataStatus.loading ? (
          <div className="card space-y-2 p-6 text-sm font-semibold text-text-secondary">
            <div>Loading FeedX outlets...</div>
            <div>Loading FeedX suppliers...</div>
            <div>Loading FeedX categories...</div>
            <div>Loading FeedX sales channels...</div>
            <div>Loading FeedX tax settings...</div>
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
