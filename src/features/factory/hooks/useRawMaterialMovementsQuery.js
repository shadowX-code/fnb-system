import { useEffect, useMemo, useState } from "react";
import { factoryService } from "../../../services/factoryService.js";
import { useFactoryPagedQuery } from "../components/FactoryPagination.jsx";
import useFactoryPermissions from "./useFactoryPermissions.js";
import { isFactoryPermissionError } from "../utils/factoryPermissions.js";

const initialFilters = { material: "", movementType: "", storageLocation: "", dateFrom: "", dateTo: "", search: "", batchId: "", batchLabel: "" };

export default function useRawMaterialMovementsQuery({ onNotify, onPermissionDenied }) {
  const { can, permissionSet } = useFactoryPermissions();
  const [filters, setFilters] = useState(initialFilters);
  const canView = can("factory_raw_material_movements.view");
  const querySignature = useMemo(() => JSON.stringify({ filters, permissions: [...(permissionSet || [])].sort() }), [filters, permissionSet]);
  const [listing, actions] = useFactoryPagedQuery({
    storageKey: "raw-movements",
    enabled: canView,
    querySignature,
    loadPage: ({ page, pageSize }) => factoryService.listFactoryListingPage({ listing: "raw-movements", page, pageSize, filters }),
    onError: (error) => {
      console.error("[Factory] Unable to load raw-movements.", error);
      const permissionDenied = isFactoryPermissionError(error);
      onNotify?.({
        title: permissionDenied ? "Raw Material Movement data hidden" : "Failed to load Raw Material Movements",
        message: permissionDenied ? "Raw Material Movement data is hidden by your current role." : "Unable to load the latest Raw Material Movement data.",
        tone: "error",
      });
    },
    shouldClearOnError: isFactoryPermissionError,
    mapError: (error) => ({
      kind: isFactoryPermissionError(error) ? "permission" : "load",
      message: isFactoryPermissionError(error) ? "Raw Material Movement data is hidden by your current role." : "Unable to load the latest Raw Material Movement data.",
    }),
  });

  useEffect(() => {
    if (canView) return;
    actions.clearForPermission("Raw Material Movement data is hidden by your current role.");
    onPermissionDenied?.();
  }, [actions, canView, onPermissionDenied]);

  useEffect(() => {
    if (listing.errorKind === "permission") onPermissionDenied?.();
  }, [listing.errorKind, onPermissionDenied]);

  return {
    filters,
    listing,
    updateFilters: (patch) => setFilters((current) => ({ ...current, ...patch })),
    clearBatch: () => setFilters((current) => ({ ...current, batchId: "", batchLabel: "" })),
    selectBatch: (row) => {
      const batchId = String(row?.batch_id || "").trim();
      if (!batchId) return;
      setFilters((current) => ({ ...current, batchId, batchLabel: String(row?.internal_batch_no || "").trim() }));
    },
    ...actions,
  };
}
