import { createContext, useMemo } from "react";

export const FactoryNavigationContext = createContext(null);

export function FactoryNavigationProvider({ auditReferenceLoading, openAuditReference, rawMovementReferenceLoading, openRawMaterialMovementReference, openingBatchTraceabilityDispatchId, openBatchTraceabilityDispatch, openCreateSupplier, openEditSupplier, archiveSupplier, openCreateCustomer, openEditCustomer, archiveCustomer, openCreateStorageLocation, openEditStorageLocation, archiveStorageLocation, children }) {
  const value = useMemo(
    () => ({ auditReferenceLoading, openAuditReference, rawMovementReferenceLoading, openRawMaterialMovementReference, openingBatchTraceabilityDispatchId, openBatchTraceabilityDispatch, openCreateSupplier, openEditSupplier, archiveSupplier, openCreateCustomer, openEditCustomer, archiveCustomer, openCreateStorageLocation, openEditStorageLocation, archiveStorageLocation }),
    [auditReferenceLoading, openAuditReference, rawMovementReferenceLoading, openRawMaterialMovementReference, openingBatchTraceabilityDispatchId, openBatchTraceabilityDispatch, openCreateSupplier, openEditSupplier, archiveSupplier, openCreateCustomer, openEditCustomer, archiveCustomer, openCreateStorageLocation, openEditStorageLocation, archiveStorageLocation],
  );

  return <FactoryNavigationContext.Provider value={value}>{children}</FactoryNavigationContext.Provider>;
}
