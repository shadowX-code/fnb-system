import { useCallback, useEffect, useRef, useState } from "react";
import { factoryService } from "../../../services/factoryService.js";
import { factoryBootstrap } from "../utils/factoryBootstrap.js";
import { malaysiaBusinessDateInput } from "../utils/factoryDates.js";
import { isFactoryPermissionError } from "../utils/factoryPermissions.js";
import { emptyProductionOverviewState, loadProductionOverview, operationalJobOrdersRequest, shouldLoadProductionOverview } from "../utils/productionOverviewQuery.js";

export default function useFactoryProductionOverviewQuery({ route, can, permissionSignature, refreshKey, onPermissionDenied, onError }) {
  const [state, setState] = useState(emptyProductionOverviewState);
  const requestRef = useRef(0);
  const controllerRef = useRef(null);
  const canRef = useRef(can);
  canRef.current = can;
  const productionAccess = Boolean(can?.("factory_production.view") || can?.("factory_production.complete"));
  const enabled = shouldLoadProductionOverview(route);

  const load = useCallback(() => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    if (!enabled) return Promise.resolve({ kind: "skipped" });
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    return loadProductionOverview({
      getOperationalJobs: () => factoryBootstrap(() => factoryService.listOperationalJobOrders({ ...operationalJobOrdersRequest({ date: malaysiaBusinessDateInput(), can: canRef.current }), signal: controller.signal }), controller, undefined, new Map([["pipeline", { key: "pipeline", label: "Operational Job Orders", status: "pending" }]])),
      isCurrent: () => requestRef.current === requestId,
      setState,
      isPermissionError: isFactoryPermissionError,
      onPermissionDenied,
      onError,
    });
  }, [productionAccess, permissionSignature, enabled, onError, onPermissionDenied]);

  useEffect(() => {
    load();
    return () => { requestRef.current += 1; controllerRef.current?.abort(); };
  }, [load, refreshKey]);

  return { ...state, retry: load };
}
