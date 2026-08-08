import { useCallback, useEffect, useRef, useState } from "react";
import { factoryService } from "../../../services/factoryService.js";
import useFactoryPermissions from "./useFactoryPermissions.js";
import { isFactoryPermissionError } from "../utils/factoryPermissions.js";
import { malaysiaBusinessMonthInput, shiftFactoryMonth } from "../utils/factoryDates.js";

const emptySnapshot = () => ({ filters: {}, kpis: {}, production_summary: [], production_trend: [], dispatch_trend: [], planned_vs_actual: [], raw_material_flow: [], action_required: [] });

export default function useFactoryDashboardQuery({ active, onNotify }) {
  const { can } = useFactoryPermissions();
  const [month, setMonth] = useState(() => malaysiaBusinessMonthInput());
  const [finishedGoodId, setFinishedGoodId] = useState("");
  const [analytics, setAnalytics] = useState({ snapshot: emptySnapshot(), hasLoaded: false, loading: false, error: "", errorKind: "" });
  const requestRef = useRef(0);
  const load = useCallback(async () => {
    if (!active) return;
    const requestId = requestRef.current + 1; requestRef.current = requestId;
    if (!can("factory_dashboard.view")) { setAnalytics({ snapshot: emptySnapshot(), hasLoaded: false, loading: false, error: "Factory Dashboard analytics are hidden by your current role.", errorKind: "permission" }); return; }
    setAnalytics((current) => ({ ...current, loading: true, error: "", errorKind: "" }));
    try {
      const snapshot = await factoryService.getFactoryDashboardAnalytics({ month, finishedGoodId });
      if (requestRef.current === requestId) setAnalytics({ snapshot, hasLoaded: true, loading: false, error: "", errorKind: "" });
    } catch (error) {
      if (requestRef.current !== requestId) return;
      console.error("[Factory] Unable to load monthly dashboard analytics.", error);
      const permissionDenied = isFactoryPermissionError(error);
      setAnalytics((current) => ({ snapshot: permissionDenied ? emptySnapshot() : current.snapshot, hasLoaded: permissionDenied ? false : current.hasLoaded, loading: false, error: permissionDenied ? "Factory Dashboard analytics are hidden by your current role." : "Unable to load the latest Dashboard analytics.", errorKind: permissionDenied ? "permission" : "load" }));
      onNotify?.({ title: permissionDenied ? "Factory Dashboard hidden" : "Unable to load Factory Dashboard", message: permissionDenied ? "Factory Dashboard analytics are hidden by your current role." : "Unable to load the latest Dashboard analytics.", tone: "error" });
    }
  }, [active, can, finishedGoodId, month, onNotify]);
  useEffect(() => { load(); return () => { requestRef.current += 1; }; }, [load]);
  return { month, setMonth, previousMonth: () => setMonth((current) => shiftFactoryMonth(current, -1)), nextMonth: () => setMonth((current) => shiftFactoryMonth(current, 1)), thisMonth: () => setMonth(malaysiaBusinessMonthInput()), finishedGoodId, setFinishedGoodId, analytics, retry: load };
}
