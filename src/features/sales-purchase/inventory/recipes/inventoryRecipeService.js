import { supabase } from "../../../../lib/supabase.ts";
import { inventoryLifecycleService } from "../../../../services/inventoryLifecycleService.js";
import { readCompleteInventoryRows } from "../../../../services/inventoryCompleteRead.js";
import { isUuid, isActiveInventoryItem, mapRemoteInventoryItem, mapRemoteCategory } from "../inventoryItemModel.js";
import { recipeCode, recipeNameEn, recipeNameCn, mapRemoteRecipe, mapRemoteMenuCategory } from "./inventoryRecipeReadModel.js";
const debugLog = (...args) => { if (import.meta.env.DEV) console.log(...args); };

export async function persistRemoteRecipe(recipe = {}, userId) {
  if (!isUuid(recipe.outletId)) throw new Error("Outlet is required.");
  const code = recipeCode(recipe);
  const nameEn = recipeNameEn(recipe);
  const nameCn = recipeNameCn(recipe);
  if (!code) throw new Error("Recipe code is required.");
  if (!nameEn) throw new Error("Recipe Name EN is required.");
  if (!nameCn) throw new Error("Recipe Name CN is required.");
  const ingredients = (recipe.ingredients || recipe.items || []).map((line) => {
    const quantityUsed = Number(line.quantityUsed ?? line.quantity_used ?? 0);
    const wastagePercent = Number(line.wastagePercent ?? line.wastage_percent ?? 0);
    return {
      id: line.id,
      inventory_item_id: line.itemId || line.inventory_item_id || "",
      quantity_used: quantityUsed,
      unit: line.unit || null,
      wastage_percent: Number.isFinite(wastagePercent) ? wastagePercent : 0,
      remark: line.remark || null,
    };
  });
  if (!ingredients.length) throw new Error("At least one ingredient is required.");
  if (ingredients.some((line) => !isUuid(line.inventory_item_id))) throw new Error("Every ingredient needs an inventory item.");
  if (ingredients.some((line) => !Number.isFinite(line.quantity_used) || line.quantity_used <= 0)) throw new Error("Quantity used must be greater than zero.");
  if (ingredients.some((line) => !Number.isFinite(line.wastage_percent) || line.wastage_percent < 0)) throw new Error("Wastage percentage cannot be negative.");

  const servingSize = Number(recipe.servingSize ?? recipe.serving_size ?? "");
  const sellingPrice = Number(recipe.sellingPrice ?? recipe.selling_price ?? "");
  const recipePayload = {
    outlet_id: recipe.outletId,
    recipe_code: code,
    recipe_name: nameEn,
    recipe_name_en: nameEn,
    recipe_name_cn: nameCn,
    menu_category: recipe.menuCategory || recipe.menu_category || null,
    recipe_photo_url: recipe.recipePhotoUrl || recipe.recipe_photo_url || null,
    selling_price: Number.isFinite(sellingPrice) && sellingPrice >= 0 ? sellingPrice : null,
    serving_size: Number.isFinite(servingSize) && servingSize >= 0 ? servingSize : null,
    status: recipe.status || "active",
    notes: recipe.notes || null,
    updated_at: new Date().toISOString(),
  };
  const rpcResult = await inventoryLifecycleService.saveInventoryRecipe({ recipe: {
    id: isUuid(recipe.id) ? recipe.id : null,
    ...recipePayload,
    ingredients,
  } });
  return mapRemoteRecipe(rpcResult.recipe || {}, rpcResult.items || []);
}

export async function archiveRemoteRecipe(recipeId) {
  if (!isUuid(recipeId)) throw new Error("Recipe is required.");
  const result = await supabase
    .from("inventory_recipes")
    .update({ status: "inactive", updated_at: new Date().toISOString() })
    .eq("id", recipeId)
    .select("*")
    .single();
  debugLog("[RecipeSaveDebug]", { action: "archive", recipeId, result: { data: result.data, error: result.error }, error: result.error });
  if (result.error) throw result.error;
  return mapRemoteRecipe(result.data, []);
}

export async function persistRemoteMenuCategory(category = {}) {
  const name = String(category.name || "").trim();
  if (!name) throw new Error("Menu category name is required.");
  const payload = {
    name,
    description: String(category.description || "").trim() || null,
    status: category.status || "active",
    sort_order: Number(category.sortOrder ?? category.sort_order ?? 0) || 0,
    updated_at: new Date().toISOString(),
  };
  const mode = isUuid(category.id) ? "edit" : "create";
  const result = mode === "edit"
    ? await supabase
      .from("inventory_menu_categories")
      .update(payload)
      .eq("id", category.id)
      .select("*")
      .single()
    : await supabase
      .from("inventory_menu_categories")
      .insert(payload)
      .select("*")
      .single();
  debugLog("[RecipeMenuCategoryDebug]", { action: mode, payload, result: { data: result.data, error: result.error }, error: result.error });
  if (result.error) throw result.error;
  return mapRemoteMenuCategory(result.data);
}
export async function loadRecipeSources(outletIds) {
  if (!outletIds.length) return [];
  const headers = await readCompleteInventoryRows("inventory_recipes", {in: {outlet_id: outletIds}, order: "created_at", ascending: false});
  const ids = headers.data.map(row => row.id);
  const lines = ids.length ? await readCompleteInventoryRows("inventory_recipe_items", {in: {recipe_id: ids}, order: "created_at"}) : {data: []};
  const byRecipe = new Map();
  for (const line of lines.data) byRecipe.set(line.recipe_id, [...(byRecipe.get(line.recipe_id) || []), line]);
  return headers.data.map(row => mapRemoteRecipe(row, byRecipe.get(row.id) || []));
}

export async function loadInventoryRecipes(outletId) {
  const [recipes, items, links, categories, menuCategories] = await Promise.all([
    loadRecipeSources([outletId]),
    readCompleteInventoryRows("inventory_items", {order: "created_at", ascending: false}),
    readCompleteInventoryRows("inventory_item_outlets", {eq: {outlet_id: outletId}}),
    readCompleteInventoryRows("inventory_categories", {order: "sort_order"}),
    readCompleteInventoryRows("inventory_menu_categories", {order: "sort_order"}),
  ]);
  const categoryRows = categories.data.map(mapRemoteCategory);
  const categoryById = new Map(categoryRows.map(row => [row.id, row]));
  const configs = new Map();
  for (const link of links.data) configs.set(link.inventory_item_id, [...(configs.get(link.inventory_item_id) || []), link]);
  return {recipes, items: items.data.map(row => mapRemoteInventoryItem(row, configs.get(row.id) || [], categoryById)).filter(isActiveInventoryItem), categories: categoryRows, menuCategories: menuCategories.data.map(mapRemoteMenuCategory), completeness: "complete"};
}
