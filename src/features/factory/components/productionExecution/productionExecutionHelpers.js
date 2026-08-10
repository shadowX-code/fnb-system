import { activeRecipeForSku } from "../../utils/productionPlanning.js";
import { quantity } from "../../utils/factoryFormatters.js";

export function buildInitialUsageRows(job, rawMaterials, recipes) {
  const matchingRecipe = activeRecipeForSku(recipes, job.finished_good || job, job.product_name);
  if (!matchingRecipe?.items?.length) return [];
  const targetQuantity = Number(job.actual_output_qty || job.target_production_qty || job.actual_produced_qty || job.target_quantity || 0);
  const recipeYield = Number(matchingRecipe.yield_quantity || 1) || 1;
  return matchingRecipe.items.map((item) => {
    const standardUsage = (Number(item.quantity_used || 0) * targetQuantity) / recipeYield;
    return { id: `recipe-${item.id}`, recipe_item_id: item.id, raw_material_id: item.raw_material_id, standard_usage: Number(standardUsage.toFixed(4)), actual_usage: Number(standardUsage.toFixed(4)), raw_material_receiving_id: "", raw_material_lot_no: "", uom: item.uom || rawMaterials.find((material) => material.id === item.raw_material_id)?.uom || "", variance_reason: "", notes: item.notes || "", allocations: [] };
  });
}

export function productionQcEditableSignature(execution) { return JSON.stringify((execution?.steps || []).flatMap((step) => (step.qc_results || []).map((qc) => ({ id: qc.id, checklist_result: String(qc.checklist_result || "").toLowerCase(), remarks: String(qc.remarks || "").trim() })))); }
export function latestProductionQcSavedAt(execution) { return (execution?.steps || []).flatMap((step) => step.qc_results || []).map((qc) => qc.checked_at).filter(Boolean).sort().at(-1) || ""; }
export function productionQcDisplayLabel(status) { const normalized = String(status || "").trim().toLowerCase().replace(/_/g, " "); if (normalized === "no production") return "No Production"; if (["not started", "in progress", "pending", "incomplete"].includes(normalized)) return "QC Incomplete"; if (["fail", "failed"].includes(normalized)) return "QC Failed"; if (["pass", "passed"].includes(normalized)) return "QC Passed"; if (["no qc", "no qc required", "not required"].includes(normalized)) return "No QC Required"; return "Metadata unavailable"; }
export function productionQcTone(status) { const normalized = String(status || "").trim().toLowerCase().replace(/_/g, " "); if (["fail", "failed"].includes(normalized)) return "danger"; if (["pass", "passed"].includes(normalized)) return "success"; if (["not started", "in progress", "pending", "incomplete"].includes(normalized)) return "warning"; return "neutral"; }
export function allocateRawMaterialFefo(requiredQty, batches, reservedByBatch = {}) { let remaining = Number(requiredQty || 0); const allocations = []; (Array.isArray(batches) ? batches : []).forEach((batch) => { const available = Math.max(Number(batch.available_qty || 0) - Number(reservedByBatch[batch.batch_balance_id] || 0), 0); const allocatedQty = Math.min(remaining, available); if (allocatedQty > 0) { allocations.push({ ...batch, allocated_qty: allocatedQty }); reservedByBatch[batch.batch_balance_id] = Number(reservedByBatch[batch.batch_balance_id] || 0) + allocatedQty; remaining -= allocatedQty; } }); return { allocations, remaining }; }
export function jobFinishedGoodName(job) { return job?.product_family_name || job?.product_name_en || job?.product_name || "Finished Good"; }
export function factoryTimeAmPmLabel(value) { const match = /^(\d{2}):(\d{2})/.exec(String(value || "")); if (!match) return "—"; const hours = Number(match[1]); return `${String(hours % 12 || 12).padStart(2, "0")}:${match[2]} ${hours >= 12 ? "PM" : "AM"}`; }
export function factorySavedTimeLabel(value) { if (!value) return ""; const date = new Date(value); if (Number.isNaN(date.getTime())) return ""; return date.toLocaleTimeString("en-MY", { hour: "numeric", minute: "2-digit", hour12: true }).toUpperCase(); }
export function formatSignedQuantity(value, unit) { const numericValue = Number(value || 0); const prefix = numericValue > 0 ? "+" : ""; return `${prefix}${quantity(numericValue, unit)}`; }
