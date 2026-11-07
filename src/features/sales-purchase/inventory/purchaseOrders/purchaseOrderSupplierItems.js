// Each catalog supplies only the current outlet's eligible supplier IDs for an item.
export function purchaseOrderSupplierItems(items, supplierId, supplierIdsForItem) {
  return supplierId ? items.filter((item) => supplierIdsForItem(item)?.includes(supplierId)) : [];
}
