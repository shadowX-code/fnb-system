import { createContext, useContext } from "react";
import useFactoryProductionOverviewQuery from "../hooks/useFactoryProductionOverviewQuery.js";

const FactoryOperationalJobsContext = createContext(null);

export function FactoryOperationalJobsProvider({ route, auth, refreshKey, onPermissionDenied, children }) {
  const model = useFactoryProductionOverviewQuery({
    route,
    can: auth?.hasPermission || (() => false),
    refreshKey,
    onPermissionDenied,
    onError: (error) => console.error("[Factory] Unable to load operational Job Orders.", error),
  });
  return <FactoryOperationalJobsContext.Provider value={model}>{typeof children === "function" ? children(model) : children}</FactoryOperationalJobsContext.Provider>;
}

export function useFactoryOperationalJobs() {
  const value = useContext(FactoryOperationalJobsContext);
  if (!value) throw new Error("useFactoryOperationalJobs must be used inside FactoryOperationalJobsProvider.");
  return value;
}
