import { useMemo, useState } from "react";
import ConfirmDialog from "../components/feedback/ConfirmDialog.jsx";
import ToastViewport from "../components/feedback/ToastViewport.jsx";
import AppShell from "../layouts/AppShell.jsx";
import { operationsService } from "../features/sales-purchase/services/operationsService.js";
import { salesPurchaseRoutes, sidebarSections } from "./routes.jsx";

export default function App() {
  const initialRoute = window.location.hash?.replace("#", "") || "dashboard";
  const [activeRouteId, setActiveRouteId] = useState(
    salesPurchaseRoutes.some((route) => route.id === initialRoute) ? initialRoute : "dashboard",
  );
  const [store, setStore] = useState(() => operationsService.getBootstrapData());
  const [toasts, setToasts] = useState([]);
  const [confirmRequest, setConfirmRequest] = useState(null);
  const activeRoute = useMemo(
    () => salesPurchaseRoutes.find((route) => route.id === activeRouteId) ?? salesPurchaseRoutes[0],
    [activeRouteId],
  );
  const ActivePage = activeRoute.component;

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

  return (
    <>
      <AppShell
        activeRoute={activeRoute}
        activeRouteId={activeRouteId}
        sections={sidebarSections}
        onNavigate={navigate}
        store={store}
      >
        <ActivePage store={store} setStore={setStore} ui={ui} />
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
