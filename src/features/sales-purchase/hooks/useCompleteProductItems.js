import { useEffect, useState } from "react";
import { productAnalyticsService } from "../../../services/productAnalyticsService.js";

// Scope changes invalidate the previous result before the next effect starts.
export function useCompleteProductItems(reportIds, version) {
  const key = [...new Set(reportIds)].sort().join("|");
  const [read, setRead] = useState({ key: null, version: null, data: [], error: null });
  useEffect(() => {
    let cancelled = false;
    setRead({ key: null, version: null, data: [], error: null });
    productAnalyticsService.listCompleteItemsByReportIds(key ? key.split("|") : [])
      .then((data) => {
        if (!cancelled) setRead({ key, version, data, error: null });
      })
      .catch((error) => {
        if (!cancelled) setRead({ key, version, data: [], error: error.message || "Product sales could not be loaded completely." });
      });
    return () => { cancelled = true; };
  }, [key, version]);
  const settled = read.key === key && read.version === version;
  return { data: settled ? read.data : [], loading: !settled, error: settled ? read.error : null };
}
