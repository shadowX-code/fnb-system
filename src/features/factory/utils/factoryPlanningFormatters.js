export const planningStatusOptions = [
  { value: "", label: "All" },
  { value: "Healthy", label: "Healthy" },
  { value: "Low Stock", label: "Low Stock" },
  { value: "Out of Stock", label: "Out of Stock" },
  { value: "No Par Level", label: "No Par Level" },
];

export function planningStatusTone(status) {
  if (status === "Healthy") return "success";
  if (status === "Low Stock") return "warning";
  if (status === "Out of Stock") return "danger";
  return "neutral";
}

export function planningCoveragePercent(value) {
  return value == null ? null : Math.max(0, Math.min(100, value));
}

export function planningCategoryOptions(categories, finishedGoods) {
  const categoryMap = new Map();
  (categories || []).forEach((category) => {
    if (category.id || category.name) categoryMap.set(category.id || category.name, category.name);
  });
  (finishedGoods || []).forEach((sku) => {
    if (sku.category_id || sku.category) categoryMap.set(sku.category_id || sku.category, sku.category || "Category");
  });
  return [...categoryMap.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function normalizePlanningPackSizeToBase(qty, uom) {
  const amount = Number(qty || 0);
  const unit = String(uom || "").trim().toLowerCase();
  if (!amount || !unit) return null;
  if (["kg", "kilogram", "kilograms"].includes(unit)) return { amount, uom: "kg" };
  if (["g", "gram", "grams"].includes(unit)) return { amount: amount / 1000, uom: "kg" };
  if (["l", "litre", "liter", "litres", "liters"].includes(unit)) return { amount, uom: "L" };
  if (["ml", "millilitre", "milliliter", "millilitres", "milliliters"].includes(unit)) return { amount: amount / 1000, uom: "L" };
  return null;
}

export function planningPackagingTypeLabel(sku) { return sku?.packaging_type || "Pack"; }
export function planningPluralizePackagingType(type, value) { const label = type || "Pack"; return Number(value || 0) === 1 ? label : /ch$/i.test(label) ? `${label}es` : `${label}s`; }
export function planningPackagingSkuDisplayName(sku) { const size = Number(sku?.pack_size_qty || 0) > 0 ? `${sku.pack_size_qty}${sku.pack_size_uom || ""}`.trim() : ""; return [size, planningPackagingTypeLabel(sku)].filter(Boolean).join(" ") || sku?.variant_name || "Packaging SKU"; }
export function planningSkuBalanceLabel(sku, quantity) { const balance = Number(sku?.current_balance || 0); return quantity(balance, planningPluralizePackagingType(planningPackagingTypeLabel(sku), balance)); }
export function planningSkuBaseEquivalentLabel(sku, quantity) { const balance = Number(sku?.current_balance || 0); const base = normalizePlanningPackSizeToBase(sku?.pack_size_qty || sku?.base_qty, sku?.pack_size_uom || sku?.base_uom); return base ? quantity(balance * base.amount, base.uom) : ""; }
