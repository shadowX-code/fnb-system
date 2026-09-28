import { useCallback, useEffect, useRef, useState } from "react";
import { subscribeInventoryRevalidation } from "../../../../services/inventoryRevalidation.js";
import { loadInventoryDashboard } from "./inventoryDashboardService.js";

export default function useInventoryDashboardRead({ outletIds, actorId, enabled }) {
  const outletKey = outletIds.join("|");
  const scopeKey = `${actorId}:${outletKey}`;
  const [snapshot, setSnapshot] = useState({ scopeKey: "", data: null, state: "loading", error: "" });
  const request = useRef(0);
  const currentScope = useRef(scopeKey);
  currentScope.current = scopeKey;
  const refresh = useCallback(async () => {
    if (!enabled) return null;
    const id = ++request.current;
    setSnapshot((previous) => ({ scopeKey, data: previous.scopeKey === scopeKey ? previous.data : null, state: previous.scopeKey === scopeKey && previous.data ? "refreshing" : "loading", error: "" }));
    try {
      const data = await loadInventoryDashboard(outletIds);
      if (id !== request.current || currentScope.current !== scopeKey) return null;
      setSnapshot({ scopeKey, data, state: "ready", error: "" });
      return data;
    } catch (error) {
      if (id !== request.current || currentScope.current !== scopeKey) return null;
      setSnapshot((previous) => ({ scopeKey, data: previous.scopeKey === scopeKey ? previous.data : null, state: "error", error: error.message || "Unable to load Inventory Dashboard.", completeness: error.readState || "error" }));
      return null;
    }
  }, [scopeKey, enabled]);
  useEffect(() => { refresh(); return () => { request.current += 1; }; }, [refresh]);
  useEffect(() => subscribeInventoryRevalidation(() => { refresh(); }), [refresh]);
  return { ...(snapshot.scopeKey === scopeKey ? snapshot : { scopeKey, data: null, state: "loading", error: "" }), refresh };
}
