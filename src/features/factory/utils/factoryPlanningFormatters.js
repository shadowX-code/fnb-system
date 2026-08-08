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
