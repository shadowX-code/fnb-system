import { createContext, useMemo } from "react";

export const FactoryNavigationContext = createContext(null);

export function FactoryNavigationProvider({ auditReferenceLoading, openAuditReference, rawMovementReferenceLoading, openRawMaterialMovementReference, openingBatchTraceabilityDispatchId, openBatchTraceabilityDispatch, openCreateSupplier, openEditSupplier, archiveSupplier, openCreateCustomer, openEditCustomer, archiveCustomer, openCreateStorageLocation, openEditStorageLocation, archiveStorageLocation, openCreateFinishedGood, openEditFinishedGood, archiveFinishedGood, openFinishedGoodPackagingSku, archiveFinishedGoodPackagingSku, openFinishedGoodCategory, openPlanningJobOrderDraft, openProductionPlanningPar, children }) {
  const value = useMemo(
    () => ({ auditReferenceLoading, openAuditReference, rawMovementReferenceLoading, openRawMaterialMovementReference, openingBatchTraceabilityDispatchId, openBatchTraceabilityDispatch, openCreateSupplier, openEditSupplier, archiveSupplier, openCreateCustomer, openEditCustomer, archiveCustomer, openCreateStorageLocation, openEditStorageLocation, archiveStorageLocation, openCreateFinishedGood, openEditFinishedGood, archiveFinishedGood, openFinishedGoodPackagingSku, archiveFinishedGoodPackagingSku, openFinishedGoodCategory, openPlanningJobOrderDraft, openProductionPlanningPar }),
    [auditReferenceLoading, openAuditReference, rawMovementReferenceLoading, openRawMaterialMovementReference, openingBatchTraceabilityDispatchId, openBatchTraceabilityDispatch, openCreateSupplier, openEditSupplier, archiveSupplier, openCreateCustomer, openEditCustomer, archiveCustomer, openCreateStorageLocation, openEditStorageLocation, archiveStorageLocation, openCreateFinishedGood, openEditFinishedGood, archiveFinishedGood, openFinishedGoodPackagingSku, archiveFinishedGoodPackagingSku, openFinishedGoodCategory, openPlanningJobOrderDraft, openProductionPlanningPar],
  );

  return <FactoryNavigationContext.Provider value={value}>{children}</FactoryNavigationContext.Provider>;
}
