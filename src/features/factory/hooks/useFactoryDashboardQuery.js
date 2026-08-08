import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { factoryService } from "../../../services/factoryService.js";
import useFactoryPermissions from "./useFactoryPermissions.js";
import { isFactoryPermissionError } from "../utils/factoryPermissions.js";
import { emptyFactoryDashboardState, loadFactoryDashboardSnapshot } from "../utils/factoryDashboardQuery.js";

export default function useFactoryDashboardQuery({ month, finishedGoodId }) {
  const { can, permissionSet } = useFactoryPermissions();
  const [state, setState] = useState(emptyFactoryDashboardState);
  const requestRef = useRef(0);
  const canView = can("factory_dashboard.view");
  const permissionSignature = useMemo(() => JSON.stringify([...(permissionSet || [])].sort()), [permissionSet]);
  const load = useCallback(async () => { const requestId = requestRef.current + 1; requestRef.current = requestId; return loadFactoryDashboardSnapshot({ canView, getSnapshot: () => factoryService.getFactoryDashboardAnalytics({ month, finishedGoodId }), isCurrent: () => requestRef.current === requestId, setState, isPermissionError: isFactoryPermissionError, onError: (error) => console.error("[Factory] Unable to load monthly dashboard analytics.", error) }); }, [canView, finishedGoodId, month]);
  useEffect(() => { load(); return () => { requestRef.current += 1; }; }, [load, permissionSignature]);
  return { state, retry: load };
}
