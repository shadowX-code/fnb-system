import { useEffect, useMemo, useState } from "react";
import { factoryService } from "../../../services/factoryService.js";
import { useFactoryPagedQuery } from "../components/FactoryPagination.jsx";
import useFactoryPermissions from "./useFactoryPermissions.js";
import { isFactoryPermissionError } from "../utils/factoryPermissions.js";

const initialFilters = { dateFrom: "", dateTo: "", finishedGood: "", batchNo: "", batchType: "", expiryStatus: "", storageLocation: "", reconciliationStatus: "", search: "" };

export default function useBatchTraceabilityQuery({ onNotify, onPermissionDenied }) {
  const { can, permissionSet } = useFactoryPermissions();
  const [filters, setFilters] = useState(initialFilters);
  const canView = can("factory_batch_traceability.view");
  const querySignature = useMemo(() => JSON.stringify({ filters, permissions: [...(permissionSet || [])].sort() }), [filters, permissionSet]);
  const [listing, actions] = useFactoryPagedQuery({
    storageKey: "batch-traceability",
    enabled: canView,
    querySignature,
    loadPage: ({ page, pageSize }) => factoryService.listFactoryListingPage({ listing: "batch-traceability", page, pageSize, filters }),
    onError: (error) => {
      console.error("[Factory] Unable to load batch-traceability.", error);
      const permissionDenied = isFactoryPermissionError(error);
      onNotify?.({ title: permissionDenied ? "Batch traceability hidden" : "Failed to load Batch Traceability", message: permissionDenied ? "Batch traceability is hidden by your current role." : "Unable to load the latest batch traceability data.", tone: "error" });
    },
    shouldClearOnError: isFactoryPermissionError,
    mapError: (error) => ({ kind: isFactoryPermissionError(error) ? "permission" : "load", message: isFactoryPermissionError(error) ? "Batch traceability is hidden by your current role." : "Unable to load the latest batch traceability data." }),
  });

  useEffect(() => {
    if (canView) return;
    actions.clearForPermission("Batch traceability is hidden by your current role.");
    onPermissionDenied?.();
  }, [actions, canView, onPermissionDenied]);

  useEffect(() => {
    if (listing.errorKind === "permission") onPermissionDenied?.();
  }, [listing.errorKind, onPermissionDenied]);

  return { filters, listing, updateFilters: (patch) => setFilters((current) => ({ ...current, ...patch })), clearFilters: () => setFilters(initialFilters), ...actions };
}
