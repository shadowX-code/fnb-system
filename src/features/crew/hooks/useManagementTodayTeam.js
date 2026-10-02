import { useCallback, useEffect, useRef, useState } from "react";
import { crewService } from "../../../services/crewService.js";

// Scope-keyed read state: an old outlet/session response is never presented in a new context.
export default function useManagementTodayTeam(token, outletId) {
  const [result, setResult] = useState(null);
  const request = useRef(0);
  const key = `${token}:${outletId}`;
  const refresh = useCallback(async () => {
    if (!token || !outletId) return;
    const id = ++request.current;
    try {
      const data = await crewService.managementTodayTeam(token, outletId);
      if (id === request.current) setResult({ key, data, error: null });
    } catch (error) {
      if (id === request.current) setResult({ key, data: null, error });
    }
  }, [token, outletId, key]);
  useEffect(() => {
    void refresh();
    const liveRefresh = () => { if (document.visibilityState !== "hidden") void refresh(); };
    const timer = window.setInterval(liveRefresh, 30_000);
    window.addEventListener("focus", liveRefresh);
    document.addEventListener("visibilitychange", liveRefresh);
    return () => { ++request.current; window.clearInterval(timer); window.removeEventListener("focus", liveRefresh); document.removeEventListener("visibilitychange", liveRefresh); };
  }, [refresh]);
  return { data: result?.key === key ? result.data : null, error: result?.key === key ? result.error : null, refresh };
}
