import { outletConfigForItem } from '../inventoryItemModel.js';
export function buildPurchaseSuggestions(record, items, categories, suppliers) {
    const itemById = new Map(items.map(item => [item.id, item]));
    const categoryById = new Map(categories.map(category => [category.id, category]));
    if (!record || record.stockCheckType !== "scheduled" || record.status !== "submitted") return [];
    return (record.rows || [])
      .filter((row) => !row.skipped && !row.na && Number(row.actualCount || 0) < Number(row.expectedQty || 0))
      .map((row) => {
        const item = itemById.get(row.itemId);
        const config = outletConfigForItem(item, record.outletId);
        const shortageQty = Math.max(0, Number(row.expectedQty || 0) - Number(row.actualCount || 0));
        const supplierChoices = suppliers
          .filter((supplier) => (config.supplierIds || []).includes(supplier.id))
          .filter((supplier) => supplier.status === "active" || supplier.is_active === true)
          .filter((supplier) => (supplier.outletIds || supplier.assignedOutletIds || []).includes(record.outletId));
        return {
          id: row.id,
          stockCheckId: record.id,
          stockCheckItemId: row.id,
          itemId: row.itemId,
          itemName: item?.name || "Inventory item",
          categoryName: categoryById.get(item?.categoryId)?.name || "Uncategorized",
          unit: item?.unit || row.unit || "",
          parLevel: row.expectedQty,
          actualCount: row.actualCount,
          shortageQty,
          supplierChoices,
        };
      });
  }
