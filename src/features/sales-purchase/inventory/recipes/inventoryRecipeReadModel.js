import { getBusinessDateInput } from "../InventorySharedPresentation.jsx";
const makeId = prefix => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2,9)}`;
export const recipeMenuCategories = ["Main Dish", "Beverage", "Side Dish", "Sauce", "Dessert", "Prep Item", "Combo", "Other"];

export function formatRestaurantRecipeCurrency(value) {
  const amount = Number(value);
  return `RM${(Number.isFinite(amount) ? amount : 0).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function mapRemoteRecipeItem(row = {}) {
  return {
    id: row.id,
    itemId: row.inventory_item_id || "",
    quantityUsed: row.quantity_used === null || row.quantity_used === undefined ? 0 : Number(row.quantity_used),
    unit: row.unit || "",
    wastagePercent: row.wastage_percent === null || row.wastage_percent === undefined ? 0 : Number(row.wastage_percent),
    remark: row.remark || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || row.created_at || "",
  };
}

export function mapRemoteMenuCategory(row = {}) {
  return {
    id: row.id || makeId("menu_cat"),
    name: row.name || "",
    description: row.description || "",
    status: row.status || "active",
    sortOrder: Number(row.sort_order ?? row.sortOrder ?? 0),
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || row.created_at || "",
  };
}

export function safeRecipe(recipe) {
  return recipe && typeof recipe === "object" ? recipe : {};
}

export function recipeCode(recipe = {}) {
  return String(safeRecipe(recipe).recipeCode || safeRecipe(recipe).recipe_code || "").trim();
}

export function recipeNameEn(recipe = {}) {
  const safe = safeRecipe(recipe);
  return String(safe.recipeNameEn || safe.recipe_name_en || safe.recipeName || safe.recipe_name || "").trim();
}

export function recipeNameCn(recipe = {}) {
  const safe = safeRecipe(recipe);
  return String(safe.recipeNameCn || safe.recipe_name_cn || "").trim();
}

export function normalizeProductRecipeKey(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function mappingDecisionStatus(mapping = {}) {
  if (!mapping) return "pending";
  if (mapping.status === "ignored") return "ignored";
  return mapping.recipe_id ? "mapped" : "pending";
}

export function mappingConfidenceLabel(confidence) {
  if (confidence >= 90) return "High";
  if (confidence >= 60) return "Medium";
  if (confidence > 0) return "Low";
  return "None";
}

export function getRecipeMappingCandidates(recipe = {}) {
  return [
    { type: "recipe_code", value: recipeCode(recipe), confidence: 98 },
    { type: "recipe_name_en", value: recipeNameEn(recipe), confidence: 92 },
    { type: "recipe_name_cn", value: recipeNameCn(recipe), confidence: 88 },
  ].filter((entry) => entry.value);
}

export function suggestRecipeMatch(productName, recipes = []) {
  const productKey = normalizeProductRecipeKey(productName);
  if (!productKey) return { recipe: null, confidence: 0, matchType: "" };
  for (const recipe of recipes) {
    const match = getRecipeMappingCandidates(recipe).find((candidate) => normalizeProductRecipeKey(candidate.value) === productKey);
    if (match) return { recipe, confidence: match.confidence, matchType: match.type };
  }
  const fuzzy = recipes
    .map((recipe) => {
      const candidates = getRecipeMappingCandidates(recipe);
      const matched = candidates.find((candidate) => {
        const key = normalizeProductRecipeKey(candidate.value);
        return key && (productKey.includes(key) || key.includes(productKey));
      });
      return matched ? { recipe, confidence: Math.max(55, matched.confidence - 25), matchType: `${matched.type}_partial` } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.confidence - a.confidence)[0];
  return fuzzy || { recipe: null, confidence: 0, matchType: "" };
}

export function monthSerial(year, month) {
  return Number(year) * 12 + Number(month);
}

export function serialToMonthParts(serial) {
  const value = Number(serial || 0);
  const year = Math.floor((value - 1) / 12);
  const month = value - year * 12;
  return { year, month };
}

export function formatMonthSerial(serial) {
  const { year, month } = serialToMonthParts(serial);
  if (!year || !month) return "—";
  return new Date(year, month - 1, 1).toLocaleDateString("en-MY", { month: "short", year: "numeric" });
}

export function buildMonthSerialRange(startSerial, endSerial) {
  const start = Number(startSerial || 0);
  const end = Number(endSerial || 0);
  if (!start || !end || end < start) return [];
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

export function businessMonthSerial(offsetMonths = 0) {
  const [year, month] = getBusinessDateInput("Asia/Kuala_Lumpur").split("-").map(Number);
  return monthSerial(year, month) + offsetMonths;
}

export function mapRemoteRecipe(row = {}, items = []) {
  const nameEn = row.recipe_name_en || row.recipe_name || "";
  const nameCn = row.recipe_name_cn || "";
  const code = row.recipe_code || "";
  return {
    id: row.id,
    outletId: row.outlet_id || "",
    recipeCode: code,
    recipe_code: code,
    recipeNameEn: nameEn,
    recipe_name_en: nameEn,
    recipeNameCn: nameCn,
    recipe_name_cn: nameCn,
    recipeName: nameEn || nameCn || code || "Recipe",
    menuCategory: row.menu_category || "",
    recipePhotoUrl: row.recipe_photo_url || "",
    recipe_photo_url: row.recipe_photo_url || "",
    sellingPrice: row.selling_price === null || row.selling_price === undefined ? "" : Number(row.selling_price),
    selling_price: row.selling_price === null || row.selling_price === undefined ? "" : Number(row.selling_price),
    servingSize: row.serving_size === null || row.serving_size === undefined ? "" : String(Number(row.serving_size)),
    status: row.status || "active",
    notes: row.notes || "",
    createdBy: row.created_by || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || row.created_at || "",
    ingredients: items.map(mapRemoteRecipeItem),
  };
}

export function recipeIngredientCost(line = {}, item) {
  const quantity = Number(line.quantityUsed || 0);
  const unitCost = Number(item?.cost || 0);
  const totalCost = quantity * unitCost;
  const wastageCost = totalCost * (Number(line.wastagePercent || 0) / 100);
  return {
    quantity,
    unitCost,
    totalCost,
    wastageCost,
  };
}

export function recipeCostSummary(recipe = {}, items = []) {
  const itemById = new Map(items.map((item) => [item.id, item]));
  return (recipe.ingredients || []).reduce((summary, line) => {
    const cost = recipeIngredientCost(line, itemById.get(line.itemId));
    return {
      ingredientCost: summary.ingredientCost + cost.totalCost,
      wastageCost: summary.wastageCost + cost.wastageCost,
      totalCost: summary.totalCost + cost.totalCost + cost.wastageCost,
    };
  }, { ingredientCost: 0, wastageCost: 0, totalCost: 0 });
}

export function recipeMarginPercent(sellingPrice, cost) {
  const price = Number(sellingPrice || 0);
  const totalCost = Number(cost || 0);
  if (!price || price <= 0) return null;
  return ((price - totalCost) / price) * 100;
}

export function recipeMarginTone(margin) {
  if (margin === null || margin === undefined || !Number.isFinite(Number(margin))) return "neutral";
  if (margin >= 70) return "success";
  if (margin >= 40) return "warning";
  return "danger";
}

export function formatRecipeMargin(margin) {
  if (margin === null || margin === undefined || !Number.isFinite(Number(margin))) return "—";
  return `${Math.round(margin)}%`;
}

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

import { buildDynamicYearOptions, yearsFromRecords } from "../../../../utils/yearOptions.js";
const recipeAnalysisPeriodOptions = [{value:"current",label:"Current Month",months:1}, {value:"last3",label:"Last 3 Months",months:3}, {value:"last6",label:"Last 6 Months",months:6}, {value:"last12",label:"Last 12 Months",months:12}];
export function createRecipeWorkspaceProjection({data, outletById, activeRecipeOutletId, recipeFilters, recipeAnalysisPeriod = "last3", recipeReportYear, recipeReportMonth, recipeTrendYear, recipeProductReports = [], recipeProductItems = [], recipeProductMappings = [], recipeMappingSelections = {}, recipeMappingFilters = {status:"all",search:""}, isRecipeIntelligencePage = false}) {
    const recipeReadModel = createInventoryRecipeReadModel({
      recipes: data.recipes,
      items: data.items,
      outletsById: outletById,
      menuCategories: data.menuCategories?.length ? data.menuCategories : recipeMenuCategories.map((name, index) => mapRemoteMenuCategory({ id: `default_menu_${index + 1}`, name, sort_order: index + 1, status: "active" })),
      activeOutletId: activeRecipeOutletId,
      filters: recipeFilters,
    });
    const { activeMenuCategories, filteredRecipes } = recipeReadModel;
    const recipeCostRows = filteredRecipes.map((recipe) => {
      const summary = recipeCostSummary(recipe, data.items);
      const margin = recipeMarginPercent(recipe.sellingPrice ?? recipe.selling_price, summary.totalCost);
      return { recipe, summary, margin };
    });
    const averageRecipeCost = recipeCostRows.length
      ? recipeCostRows.reduce((sum, row) => sum + row.summary.totalCost, 0) / recipeCostRows.length
      : 0;
    const pricedMargins = recipeCostRows.filter((row) => row.margin !== null && Number.isFinite(Number(row.margin)));
    const averageMargin = pricedMargins.length
      ? pricedMargins.reduce((sum, row) => sum + row.margin, 0) / pricedMargins.length
      : null;
    const highestCostRecipe = recipeCostRows.reduce((highest, row) => !highest || row.summary.totalCost > highest.summary.totalCost ? row : highest, null);
    const selectedPeriod = recipeAnalysisPeriodOptions.find((option) => option.value === recipeAnalysisPeriod) || recipeAnalysisPeriodOptions[1];
    const analysisStartSerial = businessMonthSerial(-(selectedPeriod.months - 1));
    const analysisEndSerial = businessMonthSerial(0);
    const analysisMonths = buildMonthSerialRange(analysisStartSerial, analysisEndSerial);
    const analysisMonthSet = new Set(analysisMonths);
    const selectedReportSerial = monthSerial(recipeReportYear, recipeReportMonth);
    const selectedReportMonthSet = new Set([selectedReportSerial]);
    const selectedReportLabel = formatMonthSerial(selectedReportSerial);
    const trendMonths = buildMonthSerialRange(monthSerial(recipeTrendYear, 1), monthSerial(recipeTrendYear, 12));
    const trendMonthSet = new Set(trendMonths);
    const availableTrendYears = buildDynamicYearOptions([
      recipeTrendYear,
      Number(recipeReportYear),
      ...yearsFromRecords(recipeProductReports, "report_year"),
    ]);
    const availableReportYears = availableTrendYears;
    const reportById = new Map(recipeProductReports.map((report) => [report.id, report]));
    const buildProductSalesByName = (allowedSerials = null) => recipeProductItems.reduce((totals, item) => {
        const key = normalizeProductRecipeKey(item.product_name);
        if (!key) return totals;
        const report = reportById.get(item.report_id);
        const monthValue = item.report_month || item.month || report?.report_month || "";
        const yearValue = item.report_year || item.year || report?.report_year || "";
        const serial = monthSerial(yearValue || 0, monthValue || 0);
        if (!serial || serial <= 0) return totals;
        if (allowedSerials && !allowedSerials.has(serial)) return totals;
        const current = totals.get(key) || { productName: item.product_name, quantity: 0, revenue: 0, latestSerial: 0, latestMonth: "", monthly: new Map() };
        const quantity = Number(item.quantity || 0);
        const revenue = Number(item.nett_sales || item.revenue || 0);
        current.quantity += quantity;
        current.revenue += revenue;
        const monthBucket = current.monthly.get(serial) || { month: serial, quantity: 0, revenue: 0 };
        monthBucket.quantity += quantity;
        monthBucket.revenue += revenue;
        current.monthly.set(serial, monthBucket);
        if (serial > current.latestSerial) {
          current.latestSerial = serial;
          current.latestMonth = yearValue && monthValue ? `${yearValue}-${String(monthValue).padStart(2, "0")}` : "";
        }
        totals.set(key, current);
        return totals;
      }, new Map());
    const analysisProductSalesByName = buildProductSalesByName(analysisMonthSet);
    const monthlyProductSalesByName = buildProductSalesByName(selectedReportMonthSet);
    const allProductSalesByName = buildProductSalesByName();
    const productSalesByName = isRecipeIntelligencePage ? monthlyProductSalesByName : analysisProductSalesByName;
    const yearlyProductSalesByName = buildProductSalesByName(trendMonthSet);
    const recipeCostById = new Map(recipeCostRows.map((row) => [row.recipe.id, row]));
    const mappingByProductKey = new Map(recipeProductMappings.map((mapping) => [normalizeProductRecipeKey(mapping.product_name), mapping]).filter(([key]) => key));
    const mappedMappings = recipeProductMappings.filter((mapping) => mappingDecisionStatus(mapping) === "mapped");
    const mappingCandidateRecipes = filteredRecipes.filter((recipe) => recipe.status === "active");
    const productMappingKeys = new Set([
      ...productSalesByName.keys(),
      ...allProductSalesByName.keys(),
      ...recipeProductMappings.map((mapping) => normalizeProductRecipeKey(mapping.product_name)).filter(Boolean),
    ]);
    const productMappingRows = [...productMappingKeys]
      .map((key) => {
        const product = productSalesByName.get(key) || allProductSalesByName.get(key) || { productName: mappingByProductKey.get(key)?.product_name || "Product", quantity: 0, revenue: 0, latestSerial: 0, latestMonth: "", monthly: new Map() };
        const allProduct = allProductSalesByName.get(key);
        const lastSeenSerial = allProduct?.latestSerial || product.latestSerial || 0;
        const latestBucket = lastSeenSerial ? allProduct?.monthly?.get(lastSeenSerial) || product.monthly?.get(lastSeenSerial) : null;
        const mapping = mappingByProductKey.get(key);
        const status = mappingDecisionStatus(mapping);
        const mappedRecipe = status === "mapped" ? recipeCostById.get(mapping?.recipe_id)?.recipe || data.recipes.find((recipe) => recipe.id === mapping?.recipe_id) : null;
        const suggestion = suggestRecipeMatch(product.productName, mappingCandidateRecipes);
        return {
          key,
          productName: product.productName,
          quantity: Number(latestBucket?.quantity ?? product.quantity ?? 0),
          revenue: Number(latestBucket?.revenue ?? product.revenue ?? 0),
          latestMonth: lastSeenSerial ? formatMonthSerial(lastSeenSerial) : "—",
          lastSeenSerial,
          lastSeenLabel: lastSeenSerial ? formatMonthSerial(lastSeenSerial) : "—",
          activityStatus: lastSeenSerial && lastSeenSerial >= selectedReportSerial - 2 ? "active" : "inactive",
          mapping,
          status,
          mappedRecipe,
          suggestedRecipe: suggestion.recipe,
          confidence: suggestion.confidence,
          matchType: suggestion.matchType,
          selectedRecipeId: recipeMappingSelections[key] || mapping?.recipe_id || suggestion.recipe?.id || "",
        };
      })
      .sort((a, b) => Number(b.revenue || 0) - Number(a.revenue || 0));
    const recipeMappingSearch = recipeMappingFilters.search.trim().toLowerCase();
    const visibleProductMappingRows = productMappingRows.filter((row) => {
      const recipeText = `${recipeCode(row.mappedRecipe || row.suggestedRecipe)} ${recipeNameEn(row.mappedRecipe || row.suggestedRecipe)} ${recipeNameCn(row.mappedRecipe || row.suggestedRecipe)}`.toLowerCase();
      return (recipeMappingFilters.status === "all" || row.status === recipeMappingFilters.status)
        && (!recipeMappingSearch || `${row.productName} ${recipeText}`.toLowerCase().includes(recipeMappingSearch));
    });

return {recipeReadModel, activeMenuCategories, filteredRecipes, recipeCostRows, averageRecipeCost, pricedMargins, averageMargin, highestCostRecipe, selectedPeriod, analysisStartSerial, analysisEndSerial, analysisMonths, analysisMonthSet, selectedReportSerial, selectedReportMonthSet, selectedReportLabel, trendMonths, trendMonthSet, availableTrendYears, availableReportYears, reportById, buildProductSalesByName, analysisProductSalesByName, monthlyProductSalesByName, allProductSalesByName, productSalesByName, yearlyProductSalesByName, recipeCostById, mappingByProductKey, mappedMappings, mappingCandidateRecipes, productMappingKeys, productMappingRows, recipeMappingSearch, visibleProductMappingRows};
}
