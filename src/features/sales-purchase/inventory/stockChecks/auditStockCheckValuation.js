function quantity(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** Display-only projection from immutable Audit item evidence and its pinned cost. */
export function auditStockCheckValuation(rows = []) {
  let stockValue = 0;
  let shortageValue = 0;
  let excessValue = 0;
  let netVariance = 0;
  let stockIncomplete = 0;
  let varianceIncomplete = 0;

  const items = rows.map((row) => {
    const actual = quantity(row.actualCount);
    const par = quantity(row.expectedQty);
    const cost = quantity(row.unitCostSnapshot);
    const validCost = cost !== null && cost >= 0;
    const rowStockValue = !row.skipped && !row.na && actual !== null && validCost ? actual * cost : null;
    const rowVarianceValue = rowStockValue !== null && par !== null ? (actual - par) * cost : null;

    if (rowStockValue === null) stockIncomplete += 1;
    else stockValue += rowStockValue;
    if (rowVarianceValue === null) varianceIncomplete += 1;
    else {
      netVariance += rowVarianceValue;
      if (rowVarianceValue < 0) shortageValue += -rowVarianceValue;
      if (rowVarianceValue > 0) excessValue += rowVarianceValue;
    }
    return { ...row, stockValue: rowStockValue, varianceValue: rowVarianceValue };
  });

  return {
    items,
    stockValue: stockIncomplete ? null : stockValue,
    shortageValue: varianceIncomplete ? null : shortageValue,
    excessValue: varianceIncomplete ? null : excessValue,
    netVariance: varianceIncomplete ? null : netVariance,
    stockIncomplete,
    varianceIncomplete,
  };
}
