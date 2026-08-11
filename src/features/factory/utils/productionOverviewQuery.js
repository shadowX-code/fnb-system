export function shouldLoadProductionOverview(initialTab) {
  return initialTab === "production-overview" || initialTab === "production";
}

export function operationalJobOrdersRequest({ date, can }) {
  return {
    date,
    includeProductions: Boolean(can?.("factory_production.view") || can?.("factory_production.complete")),
  };
}

export function emptyProductionOverviewState() {
  return { jobs: [], productions: [], summary: {}, hasLoaded: false, loading: false, error: "", errorKind: "" };
}

export function productionOverviewSuccessState(result) {
  return {
    jobs: result?.jobs || [],
    productions: result?.productions || [],
    summary: result?.summary || {},
    hasLoaded: true,
    loading: false,
    error: "",
    errorKind: "",
  };
}

export function productionOverviewPermissionDeniedState() {
  return {
    ...emptyProductionOverviewState(),
    error: "Some Production Overview data is hidden by your current role.",
    errorKind: "permission",
  };
}

export function productionOverviewFailureState(current) {
  return {
    ...current,
    loading: false,
    error: "Unable to load the latest operational Job Orders.",
    errorKind: "load",
  };
}

export async function loadProductionOverview({ getOperationalJobs, isCurrent, setState, isPermissionError, onPermissionDenied, onError }) {
  setState((current) => ({ ...current, loading: true }));
  try {
    const result = await getOperationalJobs();
    if (!isCurrent()) return { kind: "stale" };
    setState(productionOverviewSuccessState(result));
    return { kind: "success", result };
  } catch (error) {
    if (!isCurrent()) return { kind: "stale", error };
    onError?.(error);
    if (isPermissionError(error)) {
      setState(productionOverviewPermissionDeniedState());
      onPermissionDenied?.();
      return { kind: "permission", error };
    }
    setState((current) => productionOverviewFailureState(current));
    return { kind: "error", error };
  }
}
