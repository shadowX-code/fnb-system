// The Product Recipes screen and its Assistant reader use the same product identity
// and the same definition of the current standard. An older active version may
// coexist with a newer draft.
export function recipeProductIdentity(row) {
  const sku = row.finished_good || {};
  const family = row.product_family || sku.product_family || {};
  return {
    finished_good_id: row.finished_good_id || "",
    product_family_id: row.product_family_id || sku.product_family_id || "",
    product_family_name: family.name_en || "",
    product_name: family.name_en || sku.product_name || row.product_name || "",
    product_name_en: family.name_en || sku.product_name_en || sku.product_name || row.product_name || "",
    product_name_cn: family.name_cn || sku.product_name_cn || "",
    product_name_bm: family.name_bm || sku.product_name_bm || "",
    version: row.version || "v1",
    status: row.status || "draft",
  };
}

const nameOrder = new Intl.Collator("en-MY", { numeric: true, sensitivity: "base" });

export function groupProductRecipes(recipes, families = []) {
  const familyById = new Map(families.map(family => [family.id, family]));
  const groups = new Map();
  for (const recipe of recipes) {
    const family = familyById.get(recipe.product_family_id);
    const name = recipe.product_name_en || recipe.product_name || recipe.product_family_name || "Finished Good";
    const key = recipe.product_family_id ? "family:" + recipe.product_family_id
      : recipe.finished_good_id ? "sku:" + recipe.finished_good_id : "legacy:" + name.toLowerCase() + ":" + recipe.id;
    if (!groups.has(key)) groups.set(key, {
      productName: family?.name_en || name,
      productNameCn: family?.name_cn || recipe.product_name_cn || "",
      versions: [],
    });
    groups.get(key).versions.push(recipe);
  }
  return [...groups.values()].map(group => {
    group.versions.sort((left, right) => nameOrder.compare(right.version || "", left.version || "")
      || String(right.updated_at || right.created_at || "").localeCompare(String(left.updated_at || left.created_at || ""))
      || String(left.id || "").localeCompare(String(right.id || "")));
    return group;
  }).sort((left, right) => nameOrder.compare(left.productName, right.productName));
}
