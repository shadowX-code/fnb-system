export function deriveProductionPlanningRows({ finishedGoods, recipes, aggregates, activeRecipeForSku }) {
  const openJobsBySku = new Map((aggregates || []).map((row) => [row.packagingSkuId, row]));
  return (finishedGoods || []).filter((sku) => sku.status === "active").map((sku) => {
    const recipe = activeRecipeForSku(recipes, sku, sku.product_family_name || sku.product_name);
    const aggregate = openJobsBySku.get(sku.id); const ready = !Number(aggregate?.invalidJobOrderCount || 0);
    const currentBalance = Number(sku.current_balance || 0); const parLevel = Number(sku.min_stock_level || 0); const openJobQty = ready ? Number(aggregate?.openJobOrderQty || 0) : null;
    return { ...sku, planning_status: parLevel <= 0 ? "No Par Level" : currentBalance <= 0 ? "Out of Stock" : currentBalance < parLevel ? "Low Stock" : "Healthy", coverage_percent: parLevel > 0 ? (currentBalance / parLevel) * 100 : null, open_job_qty: openJobQty, open_job_count: Number(aggregate?.openJobOrderCount || 0), open_job_quantity_incomplete: Number(aggregate?.invalidJobOrderCount || 0) > 0, suggested_production_qty: ready && parLevel > 0 ? Math.max(parLevel - currentBalance - openJobQty, 0) : ready ? 0 : null, active_recipe: recipe, finished_good_name: sku.product_family_name || sku.product_name, finished_good_name_cn: sku.product_family_name_cn || sku.product_name_cn || "" };
  });
}
