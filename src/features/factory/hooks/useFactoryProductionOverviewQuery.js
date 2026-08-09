import { useCallback, useEffect, useRef, useState } from "react";
import { factoryService } from "../../../services/factoryService.js";
import { malaysiaBusinessDateInput } from "../utils/factoryDates.js";
import { isFactoryPermissionError } from "../utils/factoryPermissions.js";
import { emptyProductionOverviewState, loadProductionOverview, operationalJobOrdersRequest, shouldLoadProductionOverview } from "../utils/productionOverviewQuery.js";

export default function useFactoryProductionOverviewQuery({ route, can, refreshKey, onPermissionDenied, onError }) {
  const [state, setState] = useState(emptyProductionOverviewState);
  const requestRef = useRef(0);
  const enabled = shouldLoadProductionOverview(route);

  const load = useCallback(() => {
    if (!enabled) return Promise.resolve({ kind: "skipped" });
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    return loadProductionOverview({
      getOperationalJobs: () => factoryService.listOperationalJobOrders(operationalJobOrdersRequest({ date: malaysiaBusinessDateInput(), can })),
      isCurrent: () => requestRef.current === requestId,
      setState,
      isPermissionError: isFactoryPermissionError,
      onPermissionDenied,
      onError,
    });
  }, [can, enabled, onError, onPermissionDenied]);

  useEffect(() => { load(); }, [load, refreshKey]);
  useEffect(() => () => { requestRef.current += 1; }, []);

  return { ...state, retry: load };
}
