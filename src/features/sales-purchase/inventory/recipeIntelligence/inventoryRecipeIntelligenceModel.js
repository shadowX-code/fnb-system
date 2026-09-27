import { createRecipeWorkspaceProjection, normalizeProductRecipeKey, recipeCode, recipeNameEn, recipeNameCn, formatRestaurantRecipeCurrency, formatRecipeMargin } from "../recipes/inventoryRecipeReadModel.js";
export function classifyMenuEngineeringRow(row, averageVolume, averageMargin) {
  const highVolume = Number(row.salesVolume || 0) >= Number(averageVolume || 0);
  const highMargin = Number(row.margin || 0) >= Number(averageMargin || 0);
  if (highVolume && highMargin) {
    return {
      classification: "Star",
      impact: "High",
      reason: "High volume and high margin.",
      action: "Protect availability and keep promoting.",
    };
  }
  if (highVolume && !highMargin) {
    return {
      classification: "Workhorse",
      impact: "High",
      reason: "Strong volume but margin trails the average.",
      action: "Review ingredient cost, portioning, or price.",
    };
  }
  if (!highVolume && highMargin) {
    return {
      classification: "Puzzle",
      impact: "Medium",
      reason: "Good margin but lower sales volume.",
      action: "Improve placement, bundling, or staff recommendation.",
    };
  }
  return {
    classification: "Dog",
    impact: "Low",
    reason: "Low volume and low margin.",
    action: "Consider simplifying, repricing, or retiring.",
  };
}


export function createRecipeIntelligenceProjection(input) {
  const {data, ingredientTrendSort = "cost", ingredientTrendSelectedIds = []} = input;
  const itemById = new Map(data.items.map(row => [row.id,row]));
  const categoryById = new Map(data.categories.map(row => [row.id,row]));
  const shared = createRecipeWorkspaceProjection({...input, recipeFilters:{category:"all",status:"active",search:""},isRecipeIntelligencePage:true});
  const {mappedMappings, recipeCostById, productSalesByName, productMappingRows, analysisProductSalesByName, analysisMonths, monthlyProductSalesByName, selectedReportSerial, yearlyProductSalesByName, trendMonths, selectedPeriod} = shared;
    const matchedProductKeys = new Set();
    const menuEngineeringRows = mappedMappings
      .map((mapping) => {
        const matchKey = normalizeProductRecipeKey(mapping.product_name);
        const recipeRow = recipeCostById.get(mapping.recipe_id);
        if (!matchKey || !recipeRow || !productSalesByName.has(matchKey)) return null;
        matchedProductKeys.add(matchKey);
        const product = productSalesByName.get(matchKey);
        const { recipe, margin } = recipeRow;
        const recipeCost = Number(recipeRow.summary.totalCost || 0);
        const sellingPrice = Number(recipe.sellingPrice ?? recipe.selling_price ?? 0);
        return {
          id: recipe.id,
          label: recipeCode(recipe) || recipeNameEn(recipe) || recipeNameCn(recipe),
          recipe,
          salesVolume: product.quantity,
          revenue: product.revenue,
          margin,
          recipeCost,
          sellingPrice,
          profitPerServing: sellingPrice - recipeCost,
        };
      })
      .filter((row) => row && row.salesVolume > 0 && row.revenue > 0 && row.margin !== null && Number.isFinite(Number(row.margin)));
    const mappedRecipeCount = new Set(mappedMappings
      .filter((mapping) => recipeCostById.has(mapping.recipe_id) && productSalesByName.has(normalizeProductRecipeKey(mapping.product_name)))
      .map((mapping) => mapping.recipe_id)).size;
    const mappedProductCount = productMappingRows.filter((row) => row.status === "mapped").length;
    const pendingProductCount = productMappingRows.filter((row) => row.status === "pending").length;
    const ignoredProductCount = productMappingRows.filter((row) => row.status === "ignored").length;
    const mappingCoverage = (mappedProductCount + pendingProductCount) ? Math.round((mappedProductCount / (mappedProductCount + pendingProductCount)) * 100) : 0;
    const reliableMenuEngineeringRows = mappedRecipeCount >= 10 ? menuEngineeringRows : [];
    const buildMappedRecipeAnalytics = (salesByName, months) => {
      const monthSet = new Set(months);
      const monthlyGrossProfitBuckets = new Map(months.map((serial) => [serial, { month: serial, quantity: 0, revenue: 0, recipeCost: 0, grossProfit: 0, margin: null }]));
      const ingredientConsumptionByMonth = new Map();
      const addIngredientUsage = ({ line, item, month, usage }) => {
        if (!item || !Number(usage || 0)) return;
        const key = item.id || line.itemId || item.name;
        const unitCost = Number(item.cost || 0);
        const category = categoryById.get(item.categoryId);
        const current = ingredientConsumptionByMonth.get(key) || {
          id: key,
          ingredient: item.name || "Inventory item",
          category: category?.name || "Uncategorized",
          uom: item.unit || line.unit || "",
          unitCost,
          estimatedUsage: 0,
          totalCost: 0,
          monthly: new Map(),
        };
        current.estimatedUsage += usage;
        current.totalCost += usage * unitCost;
        const monthBucket = current.monthly.get(month) || { month, usage: 0, cost: 0 };
        monthBucket.usage += usage;
        monthBucket.cost += usage * unitCost;
        current.monthly.set(month, monthBucket);
        ingredientConsumptionByMonth.set(key, current);
      };
      mappedMappings.forEach((mapping) => {
        const matchKey = normalizeProductRecipeKey(mapping.product_name);
        const product = salesByName.get(matchKey);
        const recipeRow = recipeCostById.get(mapping.recipe_id);
        if (!product || !recipeRow) return;
        const { recipe, summary } = recipeRow;
        const recipeCost = Number(summary.totalCost || 0);
        const sellingPrice = Number(recipe.sellingPrice ?? recipe.selling_price ?? 0);
        const profitPerServing = sellingPrice - recipeCost;
        product.monthly.forEach((monthSale, month) => {
          if (!monthSet.has(month)) return;
          const quantity = Number(monthSale.quantity || 0);
          const gross = monthlyGrossProfitBuckets.get(month) || { month, quantity: 0, revenue: 0, recipeCost: 0, grossProfit: 0, margin: null };
          gross.quantity += quantity;
          gross.revenue += Number(monthSale.revenue || 0);
          gross.recipeCost += quantity * recipeCost;
          gross.grossProfit += quantity * profitPerServing;
          gross.margin = gross.revenue > 0 ? (gross.grossProfit / gross.revenue) * 100 : null;
          monthlyGrossProfitBuckets.set(month, gross);
          (recipe.ingredients || []).forEach((line) => {
            const item = itemById.get(line.itemId);
            const quantityUsed = Number(line.quantityUsed ?? line.quantity_used ?? 0);
            addIngredientUsage({ line, item, month, usage: quantity * quantityUsed });
          });
        });
      });
      return { monthlyGrossProfitBuckets, ingredientConsumptionByMonth };
    };

    const analysisAnalytics = buildMappedRecipeAnalytics(analysisProductSalesByName, analysisMonths);
    const monthlyAnalytics = buildMappedRecipeAnalytics(monthlyProductSalesByName, [selectedReportSerial]);
    const yearlyAnalytics = buildMappedRecipeAnalytics(yearlyProductSalesByName, trendMonths);

    const topGrossProfitRows = [...menuEngineeringRows]
      .map((row) => ({ ...row, grossProfit: Number(row.salesVolume || 0) * Number(row.profitPerServing || 0) }))
      .sort((a, b) => Number(b.grossProfit || 0) - Number(a.grossProfit || 0))
      .slice(0, 8);
    const grossProfitTrendSeries = [{
      id: "gross-profit",
      label: "Gross Profit",
      values: trendMonths.map((month) => {
        const bucket = yearlyAnalytics.monthlyGrossProfitBuckets.get(month) || {};
        return {
          month,
          value: Number(bucket.grossProfit || 0),
          tooltip: `Qty ${Number(bucket.quantity || 0).toLocaleString()} · Revenue ${formatRestaurantRecipeCurrency(bucket.revenue || 0)} · Recipe Cost ${formatRestaurantRecipeCurrency(bucket.recipeCost || 0)} · Margin ${formatRecipeMargin(bucket.margin)}`,
        };
      }),
    }];
    const yearlyGrossProfitRows = [...yearlyAnalytics.monthlyGrossProfitBuckets.values()];
    const currentYearGrossProfit = yearlyGrossProfitRows.reduce((sum, row) => sum + Number(row.grossProfit || 0), 0);
    const bestGrossProfitMonth = yearlyGrossProfitRows.reduce((best, row) => !best || Number(row.grossProfit || 0) > Number(best.grossProfit || 0) ? row : best, null);
    const averageMonthlyGrossProfit = currentYearGrossProfit / 12;
    const ingredientConsumptionRows = [...monthlyAnalytics.ingredientConsumptionByMonth.values()]
      .map((row) => {
        const latestBucket = row.monthly.get(selectedReportSerial) || { usage: 0, cost: 0 };
        const periodCost = [...row.monthly.values()].reduce((sum, bucket) => sum + Number(bucket.cost || 0), 0);
        return {
          ...row,
          estimatedUsage: latestBucket.usage,
          totalCost: latestBucket.cost,
          periodCost,
        };
      })
      .filter((row) => Number(row.estimatedUsage || 0) > 0 || Number(row.totalCost || 0) > 0)
      .sort((a, b) => Number(b.totalCost || 0) - Number(a.totalCost || 0));
    const ingredientConsumptionCategories = [...new Set(ingredientConsumptionRows.map((row) => row.category).filter(Boolean))].sort();
    const totalMonthlyIngredientCost = ingredientConsumptionRows.reduce((sum, row) => sum + Number(row.totalCost || 0), 0);
    const ingredientConsumptionRowsWithContribution = ingredientConsumptionRows.map((row) => ({
      ...row,
      costContribution: totalMonthlyIngredientCost > 0 ? (Number(row.totalCost || 0) / totalMonthlyIngredientCost) * 100 : null,
    }));
    const ingredientDemandForecastRows = [...analysisAnalytics.ingredientConsumptionByMonth.values()]
      .map((row) => {
        const monthlyBuckets = analysisMonths.map((month) => row.monthly.get(month) || { usage: 0, cost: 0 });
        const forecastUsage = monthlyBuckets.reduce((sum, bucket) => sum + Number(bucket.usage || 0), 0) / Math.max(selectedPeriod.months, 1);
        const latestUsage = monthlyBuckets[monthlyBuckets.length - 1]?.usage || 0;
        const priorBuckets = monthlyBuckets.slice(0, -1);
        const priorAverage = priorBuckets.length ? priorBuckets.reduce((sum, bucket) => sum + Number(bucket.usage || 0), 0) / priorBuckets.length : null;
        const change = priorAverage && priorAverage > 0 ? ((latestUsage - priorAverage) / priorAverage) * 100 : null;
        return {
          ...row,
          forecastUsage,
          forecastCost: forecastUsage * Number(row.unitCost || 0),
          change,
        };
      })
      .filter((row) => Number(row.forecastUsage || 0) > 0)
      .sort((a, b) => Number(b.forecastCost || 0) - Number(a.forecastCost || 0))
      .slice(0, 8);
    const trendIngredientRows = [...yearlyAnalytics.ingredientConsumptionByMonth.values()]
      .map((row) => {
        const monthlyBuckets = trendMonths.map((month) => row.monthly.get(month) || { month, usage: 0, cost: 0 });
        const nonZeroBuckets = monthlyBuckets.filter((bucket) => Number(bucket.cost || 0) > 0);
        const latest = nonZeroBuckets.at(-1);
        const previous = nonZeroBuckets.slice(0, -1).at(-1);
        const growthPercent = previous && Number(previous.cost || 0) > 0
          ? ((Number(latest?.cost || 0) - Number(previous.cost || 0)) / Number(previous.cost || 0)) * 100
          : latest ? 100 : 0;
        return {
          ...row,
          totalUsage: monthlyBuckets.reduce((sum, bucket) => sum + Number(bucket.usage || 0), 0),
          growthPercent,
        };
      })
      .sort((a, b) => {
        if (ingredientTrendSort === "usage") return Number(b.totalUsage || 0) - Number(a.totalUsage || 0);
        if (ingredientTrendSort === "growth") return Number(b.growthPercent || 0) - Number(a.growthPercent || 0);
        return Number(b.totalCost || 0) - Number(a.totalCost || 0);
      });
    const defaultTrendIngredientIds = trendIngredientRows
      .slice(0, 5)
      .map((row) => row.id);
    const activeTrendIngredientIds = (ingredientTrendSelectedIds.length ? ingredientTrendSelectedIds : defaultTrendIngredientIds)
      .filter((id) => yearlyAnalytics.ingredientConsumptionByMonth.has(id))
      .slice(0, 5);
    const ingredientTrendSeries = activeTrendIngredientIds.map((id) => {
      const row = yearlyAnalytics.ingredientConsumptionByMonth.get(id);
      return {
        id,
        label: row?.ingredient || "Ingredient",
        values: trendMonths.map((month) => {
          const bucket = row?.monthly?.get(month) || { usage: 0, cost: 0 };
          return {
            month,
            value: Number(bucket.cost || 0),
            meta: [
              { label: "Ingredient", value: row?.ingredient || "Ingredient" },
              { label: "Estimated Usage", value: Number(bucket.usage || 0).toLocaleString("en-MY", { maximumFractionDigits: 2 }) },
              { label: "UOM", value: row?.uom || "—" },
              { label: "Estimated Cost", value: formatRestaurantRecipeCurrency(bucket.cost || 0) },
            ],
          };
        }),
      };
    });
    const highestIngredientCostPoint = trendIngredientRows.reduce((best, row) => {
      const peak = [...row.monthly.values()].reduce((monthBest, bucket) => !monthBest || Number(bucket.cost || 0) > Number(monthBest.cost || 0) ? bucket : monthBest, null);
      if (!peak) return best;
      const candidate = { ...row, peak };
      return !best || Number(candidate.peak.cost || 0) > Number(best.peak.cost || 0) ? candidate : best;
    }, null);

  return {...shared, menuEngineeringRows, mappedRecipeCount, mappedProductCount, pendingProductCount, ignoredProductCount, mappingCoverage, reliableMenuEngineeringRows, topGrossProfitRows, grossProfitTrendSeries, currentYearGrossProfit, bestGrossProfitMonth, averageMonthlyGrossProfit, ingredientConsumptionCategories, ingredientConsumptionRowsWithContribution, ingredientDemandForecastRows, trendIngredientRows, activeTrendIngredientIds, ingredientTrendSeries, highestIngredientCostPoint};
}

