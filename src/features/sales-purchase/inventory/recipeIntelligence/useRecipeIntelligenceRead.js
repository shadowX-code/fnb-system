import { useCallback, useEffect, useRef, useState } from "react";
import { productAnalyticsService } from "../../../../services/productAnalyticsService.js";
import { readCompleteInventoryRows } from "../../../../services/inventoryCompleteRead.js";
import { subscribeInventoryRevalidation } from "../../../../services/inventoryRevalidation.js";
import { loadRecipeSources } from "../recipes/inventoryRecipeService.js";
import { mapRemoteInventoryItem, mapRemoteCategory } from "../inventoryItemModel.js";
import { recipeAnalysisPeriodOptions, mapRemoteMenuCategory, monthSerial, businessMonthSerial } from "../recipes/inventoryRecipeReadModel.js";

export async function loadRecipeIntelligence({outletId, recipeAnalysisPeriod, recipeReportMonth, recipeReportYear, recipeTrendYear}) {
  const period = recipeAnalysisPeriodOptions.find(row => row.value === recipeAnalysisPeriod) || recipeAnalysisPeriodOptions[1];
  const start = Math.min(businessMonthSerial(-(period.months - 1)), monthSerial(recipeReportYear,recipeReportMonth), monthSerial(recipeTrendYear,1));
  const end = Math.max(businessMonthSerial(0), monthSerial(recipeReportYear,recipeReportMonth), monthSerial(recipeTrendYear,12));
  const [recipes, categories, menuCategories, reports, mappings] = await Promise.all([
    loadRecipeSources([outletId]),
    readCompleteInventoryRows("inventory_categories",{order:"sort_order"}),
    readCompleteInventoryRows("inventory_menu_categories",{order:"sort_order"}),
    productAnalyticsService.listCompleteReports({outletIds:[outletId]}),
    readCompleteInventoryRows("product_recipe_mappings",{eq:{outlet_id:outletId}}),
  ]);
  const itemIds = [...new Set(recipes.flatMap(recipe => (recipe.ingredients || []).map(line => line.itemId)).filter(Boolean))];
  const categoryRows = categories.data.map(mapRemoteCategory);
  const categoryById = new Map(categoryRows.map(row => [row.id,row]));
  const periodReports = reports.filter(report => { const serial = monthSerial(report.report_year,report.report_month); return serial >= start && serial <= end; });
  const [items, productItems] = await Promise.all([
    itemIds.length ? readCompleteInventoryRows("inventory_items",{in:{id:itemIds}}) : Promise.resolve({data:[]}),
    productAnalyticsService.listCompleteItemsByReportIds(periodReports.map(report => report.id)),
  ]);
  // Inactive ingredients remain costing context for existing recipes, as before.
  // Keep scoped report metadata for year selection; item payloads stay window-scoped.
  return {recipes,items:items.data.map(row => mapRemoteInventoryItem(row,[],categoryById)),categories:categoryRows,menuCategories:menuCategories.data.map(mapRemoteMenuCategory),recipeProductReports:reports,recipeProductItems:productItems,recipeProductMappings:mappings.data,completeness:"complete"};
}

export default function useRecipeIntelligenceRead({outletId, scopeKey, enabled, recipeAnalysisPeriod, recipeReportMonth, recipeReportYear, recipeTrendYear}) {
  const key = [outletId,scopeKey,enabled,recipeAnalysisPeriod,recipeReportMonth,recipeReportYear,recipeTrendYear].join("|");
  const liveKey = useRef(key); liveKey.current = key;
  const request = useRef(0);
  const [read,setRead] = useState({state:"loading",data:null,error:""});
  const refresh = useCallback(async () => {
    if (liveKey.current !== key) return;
    const id = ++request.current;
    if (!enabled || !outletId) { setRead({state:"empty",data:null,error:"",key}); return; }
    setRead(current => ({...current,state:current.key === key && current.data ? "refreshing" : "loading",error:"",key}));
    try {
      const data = await loadRecipeIntelligence({outletId,recipeAnalysisPeriod,recipeReportMonth,recipeReportYear,recipeTrendYear});
      if (id === request.current && liveKey.current === key) setRead({state:"complete",data,error:"",key});
    } catch(error) {
      if (id === request.current && liveKey.current === key) setRead({state:error.readState || "error",data:null,error:error.message,key});
    }
  },[key,outletId,enabled,recipeAnalysisPeriod,recipeReportMonth,recipeReportYear,recipeTrendYear]);
  useEffect(() => { refresh(); return () => { request.current += 1; }; },[refresh]);
  useEffect(() => subscribeInventoryRevalidation(context => { if (!context?.outletId || context.outletId === outletId) refresh(); }),[refresh,outletId]);
  return {...(read.key === key ? read : {state:"loading",data:null,error:""}),refresh};
}
