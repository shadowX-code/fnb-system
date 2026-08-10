function field(recipe, camel, snake) {
  return recipe?.[camel] || recipe?.[snake] || "";
}

export function createInventoryRecipeReadModel({ recipes = [], items = [], outletsById = new Map(), menuCategories = [], activeOutletId = "", filters = {} } = {}) {
  const itemById = new Map(items.map((item) => [item.id, item]));
  const activeMenuCategories = menuCategories.filter((category) => category.status === "active").slice().sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0) || String(a.name || "").localeCompare(String(b.name || "")));
  const search = String(filters.search || "").trim().toLowerCase();
  const filteredRecipes = recipes.filter((recipe) => {
    const outlet = outletsById.get(recipe.outletId);
    const text = `${field(recipe, "recipeCode", "recipe_code")} ${field(recipe, "recipeNameEn", "recipe_name_en")} ${field(recipe, "recipeNameCn", "recipe_name_cn")} ${recipe.menuCategory || ""} ${outlet?.name || ""} ${(recipe.ingredients || []).map((line) => itemById.get(line.itemId)?.name || "").join(" ")}`.toLowerCase();
    return recipe.outletId === activeOutletId && (filters.category === "all" || recipe.menuCategory === filters.category) && (filters.status === "all" || recipe.status === filters.status) && (!search || text.includes(search));
  });
  return { activeMenuCategories, filteredRecipes };
}
