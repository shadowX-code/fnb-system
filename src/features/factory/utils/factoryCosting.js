import { money } from "./factoryFormatters.js";

export function normalizedCostUnit(uom) {
  const unit = String(uom || "").trim().toLowerCase();
  if (["kg", "kilogram", "kilograms"].includes(unit)) return { key: "kg", family: "weight", toBase: 1000, display: "kg" };
  if (["g", "gram", "grams"].includes(unit)) return { key: "g", family: "weight", toBase: 1, display: "g" };
  if (["l", "litre", "liter", "litres", "liters"].includes(unit)) return { key: "l", family: "volume", toBase: 1000, display: "L" };
  if (["ml", "millilitre", "milliliter", "millilitres", "milliliters"].includes(unit)) return { key: "ml", family: "volume", toBase: 1, display: "ml" };
  return null;
}

export function convertCostQuantity(quantityValue, fromUom, toUom) {
  const from = normalizedCostUnit(fromUom); const to = normalizedCostUnit(toUom);
  if (!from || !to || from.family !== to.family) return null;
  return (Number(quantityValue || 0) * from.toBase) / to.toBase;
}

export function latestReceivingCostInfo(receivings = [], rawMaterialId, rawMaterial = {}) {
  const row = [...receivings].filter((entry) => entry.raw_material_id === rawMaterialId && Number(entry.unit_cost || 0) > 0).sort((a, b) => new Date(b.received_date || b.created_at || 0) - new Date(a.received_date || a.created_at || 0))[0];
  if (!row && Number(rawMaterial.manual_unit_cost || 0) > 0) return { unitCost: Number(rawMaterial.manual_unit_cost || 0), uom: rawMaterial.manual_cost_uom || "", receiptNo: "", supplierName: "", receivedDate: "", missingCost: false, costSource: "Manual Cost" };
  return { unitCost: Number(row?.unit_cost || 0), uom: row?.uom || "", receiptNo: row?.receiving_no || "", supplierName: row?.supplier_name || "", receivedDate: row?.received_date || "", missingCost: !row, costSource: row ? "Receiving Cost" : "Missing Cost" };
}

export function unitCostDisplay(costInfo) {
  if (costInfo?.missingCost) return "Missing Cost";
  if (!costInfo?.uom) return "Unsupported UOM";
  return `${money(costInfo.unitCost)} / ${normalizedCostUnit(costInfo.uom)?.display || costInfo.uom}`;
}

export function recipeCostLineInfo(item, receivings, rawMaterial = {}) {
  const latestCost = latestReceivingCostInfo(receivings, item.raw_material_id, rawMaterial);
  const quantityWithWastage = Number(item.quantity_used || 0) * (1 + Number(item.wastage_percent || 0) / 100);
  const convertedQty = latestCost.missingCost ? 0 : convertCostQuantity(quantityWithWastage, item.uom, latestCost.uom);
  const unsupportedCost = !latestCost.missingCost && convertedQty == null;
  return { quantityWithWastage, convertedQty: convertedQty || 0, unitCost: latestCost.unitCost, costUom: latestCost.uom, lineCost: unsupportedCost || latestCost.missingCost ? 0 : (convertedQty || 0) * latestCost.unitCost, source: latestCost.receiptNo || latestCost.costSource || (latestCost.missingCost ? "Missing Cost" : "Unsupported UOM"), costSource: latestCost.costSource || "", supplierName: latestCost.supplierName, receivedDate: latestCost.receivedDate, missingCost: latestCost.missingCost, unsupportedCost };
}

export function recipeCostInfo(recipe, receivings) {
  const itemRows = (recipe.items || []).map((item) => {
    const lineCost = recipeCostLineInfo(item, receivings, item);
    return { ...item, quantity_with_wastage: lineCost.quantityWithWastage, unit_cost: lineCost.unitCost, cost_uom: lineCost.costUom, cost_source: lineCost.source, cost_source_type: lineCost.costSource, supplier_name: lineCost.supplierName, received_date: lineCost.receivedDate, missing_cost: lineCost.missingCost, unsupported_cost: lineCost.unsupportedCost, standard_cost: lineCost.lineCost };
  });
  const standardCost = itemRows.reduce((sum, item) => sum + item.standard_cost, 0);
  const yieldQuantity = Number(recipe.yield_quantity || 0);
  return { itemRows, standardCost, costPerUnit: yieldQuantity ? standardCost / yieldQuantity : 0, missingCostRows: itemRows.filter((item) => item.missing_cost).length, unsupportedCostRows: itemRows.filter((item) => item.unsupported_cost).length };
}

export function usageUnitCostInfo(usage, receivings) {
  const recordedCost = Number(usage.unit_cost || 0);
  if (recordedCost > 0) return { unitCost: recordedCost, source: usage.receiving_ref || "Recorded receiving", missingCost: false };
  const latestCost = latestReceivingCostInfo(receivings, usage.raw_material_id);
  return { unitCost: latestCost.unitCost, source: latestCost.receiptNo || "Missing Cost", missingCost: latestCost.missingCost };
}

export function usageUnitCost(usage, receivings) {
  return usageUnitCostInfo(usage, receivings).unitCost;
}

export function productionCostInfo(production, receivings) {
  return (production.material_usage || []).reduce((summary, usage) => {
    const costInfo = usageUnitCostInfo(usage, receivings);
    summary.cost += Number(usage.actual_usage || 0) * costInfo.unitCost;
    if (costInfo.missingCost) summary.missingCostRows += 1;
    return summary;
  }, { cost: 0, missingCostRows: 0 });
}

export function productionCost(production, receivings) {
  return productionCostInfo(production, receivings).cost;
}

export function costDisplay(value, missingCostRows = 0, unsupportedCostRows = 0) {
  if (missingCostRows) return "Missing Cost";
  if (unsupportedCostRows) return "Incomplete Cost";
  return money(value);
}
