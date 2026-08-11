export function buildProductionPlanningJobOrderDraft({ row, recipes, finishedGoods, activeRecipeForSku, packagingProductionPlan, inheritedRecipeUom, finishedGoodParentKey, today }) {
  const suggestedPackQty = Number(row.suggested_production_qty || 0);
  const recipe = row.active_recipe || activeRecipeForSku(recipes, row, row.finished_good_name || row.product_name);
  const plan = suggestedPackQty > 0 ? packagingProductionPlan(suggestedPackQty, row, recipe?.uom) : null;
  const target = plan && !plan.error ? plan.target_production_qty : "";
  const uom = plan && !plan.error ? plan.production_uom : recipe?.uom || inheritedRecipeUom(row.product_family_id, finishedGoods, row.base_uom || row.pack_size_uom || row.uom || "");
  return { product_family_key: finishedGoodParentKey(row), finished_good_id: row.id, product_name: row.finished_good_name || row.product_name, target_production_qty: target || "", target_quantity: target || "", uom: uom || "", planned_date: today(), priority: "Normal", status: "draft" };
}
