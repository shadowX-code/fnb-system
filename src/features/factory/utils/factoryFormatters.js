export function money(value) {
  return `RM${Number(value || 0).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function packSizeText(sku) {
  return Number(sku?.pack_size_qty || 0) > 0
    ? `${sku.pack_size_qty} ${sku.pack_size_uom || ""}`.trim()
    : "";
}

export function packagingTypeLabel(sku) {
  return sku?.packaging_type || "Pack";
}

export function pluralizePackagingType(type, value) {
  const label = type || "Pack";
  if (Number(value || 0) === 1) return label;
  if (/ch$/i.test(label)) return `${label}es`;
  return `${label}s`;
}

export function skuBalanceLabel(sku) {
  const balance = Number(sku?.current_balance || 0);
  return quantity(balance, pluralizePackagingType(packagingTypeLabel(sku), balance));
}

export function dispatchTotalLabel(dispatch) {
  const items = Array.isArray(dispatch?.items) ? dispatch.items : [];
  if (!items.length) return "—";
  const types = [...new Set(items.map((item) => packagingTypeLabel(item)).filter(Boolean))];
  if (types.length === 1) {
    return quantity(dispatch.total_qty, pluralizePackagingType(types[0], dispatch.total_qty));
  }
  const itemCount = Number(dispatch.items_count || items.length);
  return `${itemCount.toLocaleString("en-MY")} SKU${itemCount === 1 ? "" : "s"}`;
}

export function recipeOperatorIdentity(recipe) {
  const productName = recipe?.product_name
    || recipe?.finished_good?.product_name
    || recipe?.finished_good?.name_en
    || "Finished Good";
  return [productName, recipe?.version || "v1"].filter(Boolean).join(" · ");
}

export function compactCompare(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function normalizePackSizeToBase(qty, uom) {
  const amount = Number(qty || 0);
  const unit = String(uom || "").trim().toLowerCase();
  if (!amount || !unit) return null;
  if (["kg", "kilogram", "kilograms"].includes(unit)) return { amount, uom: "kg" };
  if (["g", "gram", "grams"].includes(unit)) return { amount: amount / 1000, uom: "kg" };
  if (["l", "litre", "liter", "litres", "liters"].includes(unit)) return { amount, uom: "L" };
  if (["ml", "millilitre", "milliliter", "millilitres", "milliliters"].includes(unit)) return { amount: amount / 1000, uom: "L" };
  return null;
}

export function dispatchLineBaseEquivalentLabel(item) {
  const qty = Number(item?.quantity || 0);
  const base = normalizePackSizeToBase(item?.pack_size_qty || item?.base_qty, item?.pack_size_uom || item?.base_uom);
  if (!qty || !base) return "—";
  return quantity(qty * base.amount, base.uom);
}

export function quantity(value, uom) {
  return `${Number(value || 0).toLocaleString("en-MY", { maximumFractionDigits: 2 })}${uom ? ` ${uom}` : ""}`;
}

export function signedQuantity(value, uom) {
  const numeric = Number(value || 0);
  const sign = numeric > 0 ? "+" : "";
  return `${sign}${numeric.toLocaleString("en-MY", { maximumFractionDigits: 2 })}${uom ? ` ${uom}` : ""}`;
}

export function ledgerQuantity(value, uom, { signed = false } = {}) {
  const numeric = Number(value || 0);
  const formatted = Math.abs(numeric).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sign = signed ? numeric > 0 ? "+" : numeric < 0 ? "-" : "" : numeric < 0 ? "-" : "";
  return `${sign}${formatted}${uom ? ` ${uom}` : ""}`;
}

export function ledgerQuantityList(rows) {
  const values = Array.isArray(rows) ? rows : [];
  return values.length ? values.map((row) => ledgerQuantity(row.quantity, row.uom)).join(" · ") : "—";
}

export function percent(value) {
  return `${Number(value || 0).toLocaleString("en-MY", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

export function productionTimeLabel(minutes) {
  const totalMinutes = Number(minutes || 0);
  if (!totalMinutes) return "Not set";
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours && mins) return `${hours}h ${mins}m`;
  if (hours) return `${hours}h`;
  return `${mins}m`;
}

export function sopStepEstimatedMinutes(step) {
  const subSteps = Array.isArray(step?.sub_steps) ? step.sub_steps : [];
  if (subSteps.length) return subSteps.reduce((sum, subStep) => sum + (Number(subStep.estimated_minutes || 0) || 0), 0);
  const minutes = Number(step?.estimated_time_minutes || 0);
  return Number.isFinite(minutes) && minutes >= 0 ? minutes : 0;
}

export function sopTotalEstimatedMinutes(sop) {
  const steps = Array.isArray(sop?.steps) ? sop.steps : [];
  if (steps.length) return steps.reduce((sum, step) => sum + sopStepEstimatedMinutes(step), 0);
  const minutes = Number(sop?.estimated_minutes || 0);
  return Number.isFinite(minutes) && minutes >= 0 ? minutes : 0;
}

export function sopMinutesLabel(minutes) {
  const numeric = Number(minutes || 0);
  return `${Number.isFinite(numeric) && numeric >= 0 ? numeric.toLocaleString("en-MY") : "0"} mins`;
}

export function validSopMinutes(value) {
  if (value === null || value === undefined || value === "") return true;
  const numeric = Number(value);
  return Number.isFinite(numeric) && Number.isInteger(numeric) && numeric >= 0;
}

export function rawMaterialLabel(material) {
  return material?.name_en || material?.name || "";
}

export function finishedGoodLabel(product) {
  return product?.product_family_name || product?.product_name_en || product?.product_name || "";
}
