const permissionMessage = "Some Factory Dashboard data is hidden by your current role.";

export function emptyFactoryDashboardAnalytics() {
  return { filters: { permissions: {} }, kpis: { production_output: { by_uom: [], batch_count: 0 }, dispatch_volume: {}, completion_rate: {}, qc_pass_rate: {}, raw_receiving: { by_uom: [] }, inventory_alerts: {} }, production_summary: [], top_dispatch_products: [], top_raw_materials: [], planned_vs_actual: [], raw_material_flow: [], production_dispatch_trend: { months: [], production: [], dispatch: [] }, qc_performance: { top_failures: [] }, inventory_health: {}, action_required: [] };
}

export function emptyFactoryDashboardState() { return { snapshot: emptyFactoryDashboardAnalytics(), hasLoaded: false, loading: false, error: "", errorKind: "" }; }
export function dashboardPermissionDeniedState() { return { ...emptyFactoryDashboardState(), error: permissionMessage, errorKind: "permission" }; }
export function dashboardSnapshotSuccessState(snapshot) { return { snapshot, hasLoaded: true, loading: false, error: "", errorKind: "" }; }
export function dashboardSnapshotFailureState(current) { return { ...current, loading: false, error: current.hasLoaded ? "Unable to load the latest Factory Dashboard. Showing the last successfully loaded analytics." : "Unable to load Factory Dashboard analytics.", errorKind: "load" }; }

export async function loadFactoryDashboardSnapshot({ canView, getSnapshot, isCurrent, setState, isPermissionError, onError }) {
  if (!canView) { setState(dashboardPermissionDeniedState()); return { kind: "permission" }; }
  setState((current) => ({ ...current, loading: true }));
  try {
    const snapshot = await getSnapshot();
    if (!isCurrent()) return { kind: "stale" };
    setState(dashboardSnapshotSuccessState(snapshot));
    return { kind: "success", snapshot };
  } catch (error) {
    if (!isCurrent()) return { kind: "stale", error };
    onError?.(error);
    if (isPermissionError(error)) { setState(dashboardPermissionDeniedState()); return { kind: "permission", error }; }
    setState((current) => dashboardSnapshotFailureState(current));
    return { kind: "error", error };
  }
}
