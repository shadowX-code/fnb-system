import { money } from "./factoryFormatters.js";
import { convertRawMaterialQuantity, dimensionalFactoryUom, normalizeFactoryUom } from "./factoryUomConversions.js";

export function normalizedCostUnit(uom) {
  const unit = normalizeFactoryUom(uom);
  const dimensional = dimensionalFactoryUom(unit);
  if (dimensional) return { key: unit, family: dimensional.dimension, toBase: dimensional.toBase, display: dimensional.display };
  return null;
}

export function convertCostQuantity(quantityValue, fromUom, toUom) {
  const sourceUom = String(fromUom || "").trim().toLowerCase();
  const costUom = String(toUom || "").trim().toLowerCase();
  if (sourceUom && sourceUom === costUom) return Number(quantityValue || 0);
  const from = normalizedCostUnit(fromUom); const to = normalizedCostUnit(toUom);
  if (!from || !to || from.family !== to.family) return null;
  return (Number(quantityValue || 0) * from.toBase) / to.toBase;
}

export function latestReceivingCostInfo(receivings = [], rawMaterialId, rawMaterial = {}) {
  const row = [...receivings].filter((entry) => entry.raw_material_id === rawMaterialId && Number(entry.unit_cost || 0) > 0).sort((a, b) => new Date(b.received_date || b.created_at || 0) - new Date(a.received_date || a.created_at || 0))[0];
  if (!row && Number(rawMaterial.manual_unit_cost || 0) > 0) return { unitCost: Number(rawMaterial.manual_unit_cost || 0), uom: rawMaterial.manual_cost_uom || "", receiptNo: "", supplierName: "", receivedDate: "", missingCost: false, costSource: "Manual Cost" };
  return { unitCost: Number(row?.unit_cost || 0), uom: row?.uom || "", receiptNo: row?.receipt_no || "", supplierName: row?.supplier_name || "", receivedDate: row?.received_date || "", missingCost: !row, costSource: row ? "Receiving Cost" : "Missing Cost" };
}

export function unitCostDisplay(costInfo) {
  if (costInfo?.missingCost) return "Missing Cost";
  if (!costInfo?.uom) return "Unsupported UOM";
  return `${money(costInfo.unitCost)} / ${normalizedCostUnit(costInfo.uom)?.display || costInfo.uom}`;
}

export function recipeCostLineInfo(item, receivings, rawMaterial = {}) {
  const material = { ...rawMaterial, ...item.raw_material };
  const latestCost = latestReceivingCostInfo(receivings, item.raw_material_id, material);
  const quantityWithWastage = Number(item.quantity_used || 0) * (1 + Number(item.wastage_percent || 0) / 100);
  const conversion = latestCost.missingCost ? { quantity: 0, reason: "" } : convertRawMaterialQuantity(quantityWithWastage, item.recipe_usage_uom || item.uom, latestCost.uom, material);
  const convertedQty = conversion.quantity;
  const unsupportedCost = !latestCost.missingCost && convertedQty == null;
  return { quantityWithWastage, convertedQty: convertedQty || 0, unitCost: latestCost.unitCost, costUom: latestCost.uom, lineCost: unsupportedCost || latestCost.missingCost ? 0 : (convertedQty || 0) * latestCost.unitCost, source: latestCost.receiptNo || latestCost.costSource || (latestCost.missingCost ? "Missing Cost" : "Unsupported UOM"), costSource: latestCost.costSource || "", supplierName: latestCost.supplierName, receivedDate: latestCost.receivedDate, missingCost: latestCost.missingCost, unsupportedCost, conversionReason: conversion.reason || "" };
}

export function recipeCostInfo(recipe, receivings) {
  const itemRows = (recipe.items || []).map((item) => {
    const lineCost = recipeCostLineInfo(item, receivings, item);
    return { ...item, quantity_with_wastage: lineCost.quantityWithWastage, unit_cost: lineCost.unitCost, cost_uom: lineCost.costUom, cost_source: lineCost.source, cost_source_type: lineCost.costSource, supplier_name: lineCost.supplierName, received_date: lineCost.receivedDate, missing_cost: lineCost.missingCost, unsupported_cost: lineCost.unsupportedCost, conversion_reason: lineCost.conversionReason, standard_cost: lineCost.lineCost };
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

export function costVarianceInfo(standardCost, actualCost) {
  const standard = Number(standardCost || 0);
  const actual = Number(actualCost || 0);
  const variance = actual - standard;
  const variancePercent = standard ? (variance / standard) * 100 : 0;
  return { variance, variancePercent };
}

export function costDisplay(value, missingCostRows = 0, unsupportedCostRows = 0) {
  if (missingCostRows) return "Missing Cost";
  if (unsupportedCostRows) return "Incomplete Cost";
  return money(value);
}
