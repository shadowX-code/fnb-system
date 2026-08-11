const normalizedCostUnit = (uom) => {
  const unit = String(uom || "").trim().toLowerCase();
  if (unit === "kg" || unit === "kilogram" || unit === "kilograms") return { family: "weight", toBase: 1000 };
  if (unit === "g" || unit === "gram" || unit === "grams") return { family: "weight", toBase: 1 };
  if (unit === "l" || unit === "litre" || unit === "liter" || unit === "litres" || unit === "liters") return { family: "volume", toBase: 1000 };
  if (unit === "ml" || unit === "millilitre" || unit === "milliliter" || unit === "millilitres" || unit === "milliliters") return { family: "volume", toBase: 1 };
  return null;
};

const convertCostQuantity = (quantityValue, fromUom, toUom) => {
  const from = normalizedCostUnit(fromUom);
  const to = normalizedCostUnit(toUom);
  if (!from || !to || from.family !== to.family) return null;
  return (Number(quantityValue || 0) * from.toBase) / to.toBase;
};

const latestReceivingCostInfo = (receivings, rawMaterialId, rawMaterial = {}) => {
  const rows = (receivings || [])
    .filter((row) => row.raw_material_id === rawMaterialId && Number(row.unit_cost || 0) > 0)
    .sort((a, b) => new Date(b.received_date || b.created_at || 0) - new Date(a.received_date || a.created_at || 0));
  const row = rows[0];
  if (!row && Number(rawMaterial.manual_unit_cost || 0) > 0) return { unitCost: Number(rawMaterial.manual_unit_cost), uom: rawMaterial.manual_cost_uom || "", missingCost: false };
  return { unitCost: Number(row?.unit_cost || 0), uom: row?.uom || "", missingCost: !row };
};

const recipeCostInfo = (recipe, receivings) => {
  const itemRows = (recipe?.items || []).map((item) => {
    const latestCost = latestReceivingCostInfo(receivings, item.raw_material_id, item);
    const quantityWithWastage = Number(item.quantity_used || 0) * (1 + Number(item.wastage_percent || 0) / 100);
    const convertedQty = latestCost.missingCost ? 0 : convertCostQuantity(quantityWithWastage, item.uom, latestCost.uom);
    return { missingCost: latestCost.missingCost, unsupportedCost: !latestCost.missingCost && convertedQty == null, lineCost: latestCost.missingCost || convertedQty == null ? 0 : convertedQty * latestCost.unitCost };
  });
  const standardCost = itemRows.reduce((sum, item) => sum + item.lineCost, 0);
  const yieldQuantity = Number(recipe?.yield_quantity || 0);
  return { itemRows, costPerUnit: yieldQuantity ? standardCost / yieldQuantity : 0, missingCostRows: itemRows.filter((item) => item.missingCost).length, unsupportedCostRows: itemRows.filter((item) => item.unsupportedCost).length };
};

export function finishedGoodCommercialCost(sku, recipes, receivings) {
  const activeRecipes = (recipes || []).filter((recipe) => String(recipe.status || "").toLowerCase() === "active");
  const exactMatches = sku?.product_family_id
    ? activeRecipes.filter((recipe) => recipe.product_family_id === sku.product_family_id)
    : activeRecipes.filter((recipe) => !recipe.product_family_id && recipe.finished_good_id === sku?.id);
  if (exactMatches.length !== 1) return null;
  const [recipe] = exactMatches;
  const recipeCost = recipeCostInfo(recipe, receivings);
  if (!recipeCost.itemRows.length || recipeCost.missingCostRows || recipeCost.unsupportedCostRows || Number(recipeCost.costPerUnit || 0) <= 0) return null;
  const packQty = Number(sku?.pack_size_qty ?? sku?.base_qty ?? 0);
  const packUom = sku?.pack_size_uom || sku?.base_uom || sku?.uom || "";
  const recipeUom = recipe.uom || "";
  if (!(packQty > 0) || !packUom || !recipeUom) return null;
  const recipeQty = String(packUom).trim().toLowerCase() === String(recipeUom).trim().toLowerCase()
    ? packQty
    : convertCostQuantity(packQty, packUom, recipeUom);
  return Number(recipeQty) > 0 ? Number(recipeCost.costPerUnit) * Number(recipeQty) : null;
}
