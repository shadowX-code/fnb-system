import { createContext, useMemo } from "react";

export const FactoryMasterDataContext = createContext(null);

export function FactoryMasterDataProvider({ data, children }) {
  const value = useMemo(
    () => ({
      finishedGoods: data?.finishedGoods || [],
      rawMaterials: data?.rawMaterials || [],
      storageLocations: data?.storageLocations || [],
      equipment: data?.equipment || [],
      equipmentCategories: data?.equipmentCategories || [],
      suppliers: data?.factorySuppliers || [],
      customers: data?.factoryCustomers || [],
      finishedGoodCategories: data?.finishedGoodCategories || [],
      rawMaterialCategories: data?.rawMaterialCategories || [],
      productFamilies: data?.productFamilies || [],
      recipes: data?.recipes || [],
      sops: data?.sops || [],
      qcChecklistTemplates: data?.qcChecklistTemplates || [],
      receivings: data?.receivings || [],
      productions: data?.productions || [],
      productMovements: data?.productMovements || [],
      productionCosts: data?.productionCosts || [],
      rawMaterialMovements: data?.rawMaterialMovements || [],
      rawStockChecks: data?.rawStockChecks || [],
      mestiCleaningRequirements: data?.mestiCleaningRequirements || [],
      mestiCalibrationRequirements: data?.mestiCalibrationRequirements || [],
    }),
    [data],
  );

  return <FactoryMasterDataContext.Provider value={value}>{children}</FactoryMasterDataContext.Provider>;
}
