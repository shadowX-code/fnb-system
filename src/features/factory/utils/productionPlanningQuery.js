const permissionMessage = "Some Production Planning data is hidden by your current role.";

export function shouldLoadProductionPlanningAggregate(initialTab) {
  return initialTab === "production-planning";
}

export function emptyProductionPlanningOpenJobs() {
  return { aggregates: [], diagnostics: {}, hasLoaded: false, loading: false, error: "", errorKind: "" };
}

export function productionPlanningPermissionDeniedState() {
  return { ...emptyProductionPlanningOpenJobs(), error: permissionMessage, errorKind: "permission" };
}

export function productionPlanningAggregateSuccessState(result) {
  return {
    aggregates: result?.aggregates || [],
    diagnostics: result?.diagnostics || {},
    hasLoaded: true,
    loading: false,
    error: "",
    errorKind: "",
  };
}

export function productionPlanningAggregateFailureState(current) {
  return {
    ...current,
    loading: false,
    error: current.hasLoaded
      ? "Unable to load the latest Production Planning data. Showing the last successfully loaded results."
      : "Unable to load the latest Production Planning data.",
    errorKind: "load",
  };
}

export async function loadProductionPlanningAggregate({
  canView,
  getAggregate,
  isCurrent,
  setState,
  isPermissionError,
  onPermissionDenied,
  onError,
}) {
  if (!canView) {
    setState(productionPlanningPermissionDeniedState());
    onPermissionDenied?.();
    return { kind: "permission" };
  }

  setState((current) => ({ ...current, loading: true }));
  try {
    const result = await getAggregate();
    if (!isCurrent()) return { kind: "stale" };
    setState(productionPlanningAggregateSuccessState(result));
    return { kind: "success", result };
  } catch (error) {
    if (!isCurrent()) return { kind: "stale", error };
    onError?.(error);
    if (isPermissionError(error)) {
      setState(productionPlanningPermissionDeniedState());
      onPermissionDenied?.();
      return { kind: "permission", error };
    }
    setState((current) => productionPlanningAggregateFailureState(current));
    return { kind: "error", error };
  }
}
