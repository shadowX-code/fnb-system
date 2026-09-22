import { createContext, useContext, useEffect, useMemo, useState } from "react";

export const CREW_ADMIN_OUTLET_STORAGE_KEY = "feedx.crew.admin.outlet";
const CrewAdminOutletContext = createContext(null);
// Isolated page tests render without App's provider. Keep their page-level fallback
// available to the nested shared Outlet field; production always uses the provider.
let standaloneOutletContext = null;

function storedOutletId() {
  try { return localStorage.getItem(CREW_ADMIN_OUTLET_STORAGE_KEY) || ""; } catch { return ""; }
}

export function CrewAdminOutletProvider({ outlets = [], children }) {
  const allowedOutlets = useMemo(() => outlets.filter((outlet) => outlet?.id && outlet.is_active !== false && outlet.status !== "inactive"), [outlets]);
  const [outletId, setOutletIdState] = useState(storedOutletId);
  useEffect(() => {
    if (!allowedOutlets.length) { if (outletId) setOutletIdState(""); return; }
    if (!allowedOutlets.some((outlet) => String(outlet.id) === String(outletId))) setOutletIdState(allowedOutlets[0].id);
  }, [allowedOutlets, outletId]);
  useEffect(() => {
    try { if (outletId) localStorage.setItem(CREW_ADMIN_OUTLET_STORAGE_KEY, outletId); else localStorage.removeItem(CREW_ADMIN_OUTLET_STORAGE_KEY); } catch { /* local preference only */ }
  }, [outletId]);
  const value = useMemo(() => ({
    outlets: allowedOutlets,
    outletId: allowedOutlets.some((outlet) => String(outlet.id) === String(outletId)) ? outletId : allowedOutlets[0]?.id || "",
    setOutletId: (nextId) => { if (allowedOutlets.some((outlet) => String(outlet.id) === String(nextId))) setOutletIdState(nextId); },
  }), [allowedOutlets, outletId]);
  return <CrewAdminOutletContext.Provider value={value}>{children}</CrewAdminOutletContext.Provider>;
}

export function useCrewAdminOutlet(fallbackOutlets = []) {
  const context = useContext(CrewAdminOutletContext);
  const allowedFallbacks = useMemo(() => fallbackOutlets.filter((outlet) => outlet?.id && outlet.is_active !== false && outlet.status !== "inactive"), [fallbackOutlets]);
  const [fallbackId, setFallbackId] = useState(() => {
    const stored = storedOutletId();
    return allowedFallbacks.some((outlet) => String(outlet.id) === String(stored)) ? stored : allowedFallbacks[0]?.id || "";
  });
  useEffect(() => {
    if (!context && allowedFallbacks.length && !allowedFallbacks.some((outlet) => String(outlet.id) === String(fallbackId))) setFallbackId(allowedFallbacks[0].id);
  }, [allowedFallbacks, context, fallbackId]);
  if (context) return context;
  if (allowedFallbacks.length) {
    standaloneOutletContext = { outlets: allowedFallbacks, outletId: fallbackId || allowedFallbacks[0]?.id || "", setOutletId: setFallbackId };
    return standaloneOutletContext;
  }
  return standaloneOutletContext || { outlets: [], outletId: "", setOutletId: () => {} };
}
