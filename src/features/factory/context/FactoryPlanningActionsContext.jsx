import { createContext, useContext, useMemo } from "react";

const FactoryPlanningActionsContext = createContext(null);

export function FactoryPlanningActionsProvider({ openPlanningJobOrderDraft, openProductionPlanningPar, children }) {
  const value = useMemo(() => ({ openPlanningJobOrderDraft, openProductionPlanningPar }), [openPlanningJobOrderDraft, openProductionPlanningPar]);
  return <FactoryPlanningActionsContext.Provider value={value}>{children}</FactoryPlanningActionsContext.Provider>;
}

export default function useFactoryPlanningActions() {
  return useContext(FactoryPlanningActionsContext);
}
