import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { factoryService } from "../../../services/factoryService.js";
import useFactoryPermissions from "./useFactoryPermissions.js";
import { isFactoryPermissionError } from "../utils/factoryPermissions.js";
import { emptyProductionPlanningOpenJobs, loadProductionPlanningAggregate } from "../utils/productionPlanningQuery.js";

export default function useProductionPlanningQuery({ onPermissionDenied } = {}) {
  const { can, permissionSet } = useFactoryPermissions();
  const [openJobs, setOpenJobs] = useState(emptyProductionPlanningOpenJobs);
  const requestRef = useRef(0);
  const canView = can("factory_job_orders.view");
  const permissionSignature = useMemo(() => JSON.stringify([...(permissionSet || [])].sort()), [permissionSet]);

  const load = useCallback(async () => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    return loadProductionPlanningAggregate({
      canView,
      getAggregate: () => factoryService.getProductionPlanningOpenJobOrderAggregate(),
      isCurrent: () => requestRef.current === requestId,
      setState: setOpenJobs,
      isPermissionError: isFactoryPermissionError,
      onPermissionDenied,
      onError: (error) => console.error("[Factory] Unable to load Production Planning open Job Order quantities.", error),
    });
  }, [canView, onPermissionDenied]);

  useEffect(() => {
    load();
    return () => { requestRef.current += 1; };
  }, [load, permissionSignature]);

  return { openJobs, retry: load };
}
