import { useEffect, useMemo, useState } from "react";
import { factoryService } from "../../../services/factoryService.js";
import { useFactoryPagedQuery } from "../components/FactoryPagination.jsx";
import useFactoryPermissions from "./useFactoryPermissions.js";
import { isFactoryPermissionError } from "../utils/factoryPermissions.js";

const initialFilters = { product: "", category: "", batch: "", movementType: "", dateFrom: "", dateTo: "" };

export default function useProductMovementsQuery({ onNotify, onPermissionDenied }) {
  const { can, permissionSet } = useFactoryPermissions();
  const [filters, setFilters] = useState(initialFilters);
  const canView = can("factory_product_movements.view");
  const querySignature = useMemo(() => JSON.stringify({ filters, permissions: [...(permissionSet || [])].sort() }), [filters, permissionSet]);
  const [listing, actions] = useFactoryPagedQuery({
    storageKey: "product-movements",
    enabled: canView,
    querySignature,
    loadPage: ({ page, pageSize }) => factoryService.listProductMovementsPage({ page, pageSize, filters }),
    onError: (error) => {
      console.error("[Factory] Unable to load Product Movements page.", error);
      const permissionDenied = isFactoryPermissionError(error);
      onNotify?.({
        title: permissionDenied ? "Product Movement data hidden" : "Failed to load Product Movements",
        message: permissionDenied ? "Some Product Movement data is hidden by your current role." : "Unable to load the latest Product Movement data.",
        tone: "error",
      });
    },
    shouldClearOnError: isFactoryPermissionError,
    mapError: (error) => ({
      kind: isFactoryPermissionError(error) ? "permission" : "load",
      message: isFactoryPermissionError(error) ? "Some Product Movement data is hidden by your current role." : "Unable to load the latest Product Movement data.",
    }),
  });

  useEffect(() => {
    if (canView) return;
    actions.clearForPermission("Some Product Movement data is hidden by your current role.");
    onPermissionDenied?.();
  }, [actions, canView, onPermissionDenied]);

  useEffect(() => {
    if (listing.errorKind === "permission") onPermissionDenied?.();
  }, [listing.errorKind, onPermissionDenied]);

  return { filters, listing, updateFilters: (patch) => setFilters((current) => ({ ...current, ...patch })), resetFilters: () => setFilters(initialFilters), ...actions };
}
