import { isValidClosingQuantity } from "./monthEndClosing.js";

function quantity(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function hasPinnedAuditCost(row) {
  const cost = quantity(row.unitCostSnapshot);
  return cost !== null && cost >= 0;
}

export function hasUsableAuditCount(row) {
  return !row.skipped && !row.na && !["skipped", "na", "pending"].includes(row.status)
    && isValidClosingQuantity(row.actualCount);
}

/** Display-only projection from immutable Audit item evidence and its pinned cost. */
export function auditStockCheckValuation(rows = []) {
  let stockValue = 0;
  let shortageValue = 0;
  let excessValue = 0;
  let stockIncomplete = 0;
  let varianceIncomplete = 0;
  let missingCostCount = 0;

  const items = rows.map((row) => {
    const actual = quantity(row.actualCount);
    const par = quantity(row.expectedQty);
    const cost = quantity(row.unitCostSnapshot);
    const validCost = hasPinnedAuditCost(row);
    const rowStockValue = hasUsableAuditCount(row) && row.unit?.trim() && validCost ? actual * cost : null;
    if (!validCost) missingCostCount += 1;
    const rowVarianceValue = rowStockValue !== null && isValidClosingQuantity(row.expectedQty) ? (actual - par) * cost : null;

    if (rowStockValue === null) stockIncomplete += 1;
    else stockValue += rowStockValue;
    if (rowVarianceValue === null) varianceIncomplete += 1;
    else {
      if (rowVarianceValue < 0) shortageValue += -rowVarianceValue;
      if (rowVarianceValue > 0) excessValue += rowVarianceValue;
    }
    return { ...row, stockValue: rowStockValue, varianceValue: rowVarianceValue };
  });

  const valuedItemCount = items.length - stockIncomplete;
  const varianceItemCount = items.length - varianceIncomplete;
  return {
    items,
    knownStockValue: valuedItemCount ? stockValue : null,
    valuedItemCount,
    missingCostCount,
    stockValue: stockIncomplete ? null : stockValue,
    shortageValue: varianceItemCount ? shortageValue : null,
    excessValue: varianceItemCount ? excessValue : null,
    netVariance: varianceItemCount ? excessValue - shortageValue : null,
    varianceItemCount,
    stockIncomplete,
    varianceIncomplete,
  };
}
