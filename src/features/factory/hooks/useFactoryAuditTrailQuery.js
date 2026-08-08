import { useEffect, useMemo, useState } from "react";
import { factoryService } from "../../../services/factoryService.js";
import { useFactoryPagedQuery } from "../components/FactoryPagination.jsx";
import useFactoryPermissions from "./useFactoryPermissions.js";
import { isFactoryPermissionError } from "../utils/factoryPermissions.js";

const initialFilters = { dateFrom: "", dateTo: "", module: "", action: "", user: "", search: "" };

export default function useFactoryAuditTrailQuery({ onNotify, onPermissionDenied }) {
  const { can, permissionSet } = useFactoryPermissions();
  const [filters, setFilters] = useState(initialFilters);
  const canView = can("factory_audit_logs.view");
  const querySignature = useMemo(() => JSON.stringify({ filters, permissions: [...(permissionSet || [])].sort() }), [filters, permissionSet]);
  const [listing, actions] = useFactoryPagedQuery({
    storageKey: "audit-logs", enabled: canView, querySignature,
    loadPage: ({ page, pageSize }) => factoryService.listFactoryListingPage({ listing: "audit-logs", page, pageSize, filters }),
    onError: (error) => { console.error("[Factory] Unable to load audit-logs.", error); const permissionDenied = isFactoryPermissionError(error); onNotify?.({ title: permissionDenied ? "Factory Audit Trail hidden" : "Failed to load Factory Audit Trail", message: permissionDenied ? "The Factory Audit Trail is hidden by your current role." : "Unable to load the latest Factory Audit Trail.", tone: "error" }); },
    shouldClearOnError: isFactoryPermissionError,
    mapError: (error) => ({ kind: isFactoryPermissionError(error) ? "permission" : "load", message: isFactoryPermissionError(error) ? "The Factory Audit Trail is hidden by your current role." : "Unable to load the latest Factory Audit Trail." }),
  });
  useEffect(() => { if (canView) return; actions.clearForPermission("The Factory Audit Trail is hidden by your current role."); onPermissionDenied?.(); }, [actions, canView, onPermissionDenied]);
  useEffect(() => { if (listing.errorKind === "permission") onPermissionDenied?.(); }, [listing.errorKind, onPermissionDenied]);
  return { filters, listing, updateFilters: (patch) => setFilters((current) => ({ ...current, ...patch })), clearFilters: () => setFilters(initialFilters), ...actions };
}
