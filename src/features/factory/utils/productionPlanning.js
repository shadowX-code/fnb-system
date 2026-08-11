export function deriveProductionPlanningRows({ finishedGoods, recipes, aggregates, activeRecipeForSku }) {
  const openJobsBySku = new Map((aggregates || []).map((row) => [row.packagingSkuId, row]));
  return (finishedGoods || []).filter((sku) => sku.status === "active").map((sku) => {
    const recipe = activeRecipeForSku(recipes, sku, sku.product_family_name || sku.product_name);
    const aggregate = openJobsBySku.get(sku.id); const ready = !Number(aggregate?.invalidJobOrderCount || 0);
    const currentBalance = Number(sku.current_balance || 0); const parLevel = Number(sku.min_stock_level || 0); const openJobQty = ready ? Number(aggregate?.openJobOrderQty || 0) : null;
    return { ...sku, planning_status: parLevel <= 0 ? "No Par Level" : currentBalance <= 0 ? "Out of Stock" : currentBalance < parLevel ? "Low Stock" : "Healthy", coverage_percent: parLevel > 0 ? (currentBalance / parLevel) * 100 : null, open_job_qty: openJobQty, open_job_count: Number(aggregate?.openJobOrderCount || 0), open_job_quantity_incomplete: Number(aggregate?.invalidJobOrderCount || 0) > 0, suggested_production_qty: ready && parLevel > 0 ? Math.max(parLevel - currentBalance - openJobQty, 0) : ready ? 0 : null, active_recipe: recipe, finished_good_name: sku.product_family_name || sku.product_name, finished_good_name_cn: sku.product_family_name_cn || sku.product_name_cn || "" };
  });
}

function normalizePlanningPackSizeToBase(qty, uom) {
  const amount = Number(qty || 0);
  const unit = String(uom || "").trim().toLowerCase();
  if (!amount || !unit) return null;
  if (unit === "kg" || unit === "kilogram" || unit === "kilograms") return { amount, uom: "kg" };
  if (unit === "g" || unit === "gram" || unit === "grams") return { amount: amount / 1000, uom: "kg" };
  if (unit === "l" || unit === "litre" || unit === "liter" || unit === "litres" || unit === "liters") return { amount, uom: "L" };
  if (unit === "ml" || unit === "millilitre" || unit === "milliliter" || unit === "millilitres" || unit === "milliliters") return { amount: amount / 1000, uom: "L" };
  return null;
}

export function inheritedRecipeUom(productFamilyId, finishedGoods = [], fallback = "") {
  if (!productFamilyId) return fallback || "kg";
  const skus = finishedGoods.filter((sku) => sku.product_family_id === productFamilyId);
  let inheritedUom = "";
  for (const sku of skus) {
    const base = normalizePlanningPackSizeToBase(sku.pack_size_qty || sku.base_qty, sku.pack_size_uom || sku.base_uom);
    const candidate = base?.uom || sku.base_uom || "";
    if (!candidate) continue;
    if (inheritedUom && inheritedUom !== candidate) return fallback || inheritedUom;
    inheritedUom = candidate;
  }
  return inheritedUom || fallback || "kg";
}

export function packagingProductionPlan(packQty, sku, recipeUom = "") {
  const targetPackQty = Number(packQty || 0);
  const packSizeQty = Number(sku?.pack_size_qty || sku?.base_qty || 0);
  const packSizeUom = sku?.pack_size_uom || sku?.base_uom || "";
  const packBase = normalizePlanningPackSizeToBase(packSizeQty, packSizeUom);
  const recipeBase = recipeUom ? normalizePlanningPackSizeToBase(1, recipeUom) : null;
  if (!targetPackQty) return { target_pack_qty: 0, target_production_qty: 0, production_uom: recipeBase?.uom || packBase?.uom || "", pack_size_qty: packSizeQty, pack_size_uom: packSizeUom, error: "" };
  if (!packSizeQty || !packSizeUom) return { target_pack_qty: targetPackQty, target_production_qty: 0, production_uom: "", pack_size_qty: packSizeQty, pack_size_uom: packSizeUom, error: "Packaging SKU needs Pack Size before creating Job Order." };
  if (packBase) {
    if (recipeBase && recipeBase.uom !== packBase.uom) return { target_pack_qty: targetPackQty, target_production_qty: 0, production_uom: recipeBase.uom, pack_size_qty: packSizeQty, pack_size_uom: packSizeUom, error: "Packaging SKU Pack Size UOM cannot convert to the active recipe UOM." };
    return { target_pack_qty: targetPackQty, target_production_qty: targetPackQty * packBase.amount, production_uom: packBase.uom, pack_size_qty: packSizeQty, pack_size_uom: packSizeUom, error: "" };
  }
  const normalizedPackUom = String(packSizeUom || "").trim();
  const normalizedRecipeUom = String(recipeUom || "").trim();
  if (normalizedRecipeUom && normalizedRecipeUom.toLowerCase() !== normalizedPackUom.toLowerCase()) return { target_pack_qty: targetPackQty, target_production_qty: 0, production_uom: normalizedRecipeUom, pack_size_qty: packSizeQty, pack_size_uom: packSizeUom, error: "Packaging SKU Pack Size UOM cannot convert to the active recipe UOM." };
  return { target_pack_qty: targetPackQty, target_production_qty: targetPackQty * packSizeQty, production_uom: normalizedRecipeUom || normalizedPackUom, pack_size_qty: packSizeQty, pack_size_uom: packSizeUom, error: "" };
}

export function activeRecipeForSku(recipes = [], sku = {}, productName = "") {
  return recipes.find((recipe) => recipe.status === "active" && recipe.product_family_id && recipe.product_family_id === sku?.product_family_id)
    || recipes.find((recipe) => recipe.status === "active" && recipe.finished_good_id && recipe.finished_good_id === sku?.id)
    || recipes.find((recipe) => recipe.status === "active" && String(recipe.product_name || "").toLowerCase() === String(productName || sku?.product_family_name || sku?.product_name || "").toLowerCase());
}

export function finishedGoodParentKey(sku) {
  return sku?.product_family_id ? `family:${sku.product_family_id}` : sku?.id ? `sku:${sku.id}` : "";
}
