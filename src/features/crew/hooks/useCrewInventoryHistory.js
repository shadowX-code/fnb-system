import { useCallback, useEffect, useRef, useState } from "react";
import { crewHistoryMonths } from "../components/CrewHistoryControls.jsx";

export default function useCrewInventoryHistory(read, token, outletId, enabled) {
  const [month, setMonth] = useState(() => crewHistoryMonths("en")[0].value);
  const [status, setStatus] = useState("all");
  const [rows, setRows] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const sequence = useRef(0);
  const more = useRef(false);
  const offset = useRef(0);
  const fetchPage = useCallback(async (append) => {
    if (!enabled || !token || more.current) return;
    const id = ++sequence.current;
    more.current = true;
    setLoading(true); setError("");
    try {
      const result = await read(token, outletId, month, status === "all" ? null : status, append ? offset.current : 0);
      if (id !== sequence.current) return;
      const page = (result.rows || []).slice(0, 20);
      offset.current = (append ? offset.current : 0) + page.length;
      setRows((current) => append ? [...current, ...page] : page);
      setHasMore(Boolean(result.has_more));
    } catch (cause) { if (id === sequence.current) setError(cause.message || "Unable to load history."); }
    finally { if (id === sequence.current) { more.current = false; setLoading(false); } }
  }, [enabled, token, outletId, month, status, read]);
  useEffect(() => { sequence.current++; more.current = false; offset.current = 0; setRows([]); setHasMore(false); if (enabled) void fetchPage(false); return () => { sequence.current++; more.current = false; }; }, [fetchPage, enabled]);
  return { month, setMonth, status, setStatus, rows, hasMore, loading, error, loadMore: () => fetchPage(true), refresh: () => fetchPage(false) };
}
