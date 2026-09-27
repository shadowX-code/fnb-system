import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({sources:vi.fn(), rows:vi.fn(), reports:vi.fn(), items:vi.fn()}));
vi.mock("../../recipes/inventoryRecipeService.js",()=>({loadRecipeSources:mocks.sources}));
vi.mock("../../../../../services/inventoryCompleteRead.js",()=>({readCompleteInventoryRows:mocks.rows}));
vi.mock("../../../../../services/productAnalyticsService.js",()=>({productAnalyticsService:{listCompleteReports:mocks.reports,listCompleteItemsByReportIds:mocks.items}}));
import useRecipeIntelligenceRead, {loadRecipeIntelligence} from "../useRecipeIntelligenceRead.js";
import {createRecipeIntelligenceProjection} from "../inventoryRecipeIntelligenceModel.js";
import {invalidateInventoryReads} from "../../../../../services/inventoryRevalidation.js";
const scope={outletId:"a",scopeKey:"user",enabled:true,recipeAnalysisPeriod:"last3",recipeReportMonth:9,recipeReportYear:2026,recipeTrendYear:2026};
const recipe={id:"r",outletId:"a",recipeCode:"R",recipeNameEn:"Rice",status:"active",sellingPrice:10,ingredients:[{itemId:"i",quantityUsed:2,wastagePercent:10}]};
beforeEach(()=>{
  vi.useFakeTimers({toFake:["Date"]}); vi.setSystemTime(new Date("2026-09-28T00:00:00Z"));
  mocks.sources.mockReset().mockResolvedValue([recipe]);
  mocks.rows.mockReset().mockImplementation(async table=>({data:table==="inventory_items" ? [{id:"i",item_name:"Rice",unit:"kg",cost:2,status:"inactive",category_id:"c"}] : table==="inventory_categories" ? [{id:"c",name:"Food",sort_order:1}] : [],completeness:"complete"}));
  mocks.reports.mockReset().mockResolvedValue([{id:"s",outlet_id:"a",report_month:9,report_year:2026},{id:"old",report_month:1,report_year:2025}]);
  mocks.items.mockReset().mockResolvedValue([]);
});
afterEach(()=>{cleanup();vi.useRealTimers();});
describe("Intelligence ownership",()=>{
  it("reads only outlet recipes, required ingredient context, mapping and applicable reports",async()=>{
    const data=await loadRecipeIntelligence(scope);
    expect(mocks.sources).toHaveBeenCalledWith(["a"]);
    expect(mocks.reports).toHaveBeenCalledWith({outletIds:["a"]});
    expect(mocks.items).toHaveBeenCalledWith(["s"]);
    expect(mocks.rows.mock.calls.map(([table])=>table).sort()).toEqual(["inventory_categories","inventory_menu_categories","inventory_items","product_recipe_mappings"].sort());
    expect(mocks.rows).toHaveBeenCalledWith("inventory_items",{in:{id:["i"]}});
    expect(data.items[0].cost).toBe(2); // Existing inactive ingredient costing is preserved.
    expect(data.completeness).toBe("complete");
  });
  it.each(["error","incomplete"])("never displays an %s analytics read as an empty complete result",async readState=>{
    mocks.items.mockRejectedValue(Object.assign(new Error("Analytics unavailable"),{readState}));
    const {result}=renderHook(()=>useRecipeIntelligenceRead(scope));
    await waitFor(()=>expect(result.current.state).toBe(readState));
    expect(result.current.data).toBeNull();expect(result.current.error).toBe("Analytics unavailable");
  });
  it("distinguishes verified empty analytics from failure",async()=>{
    mocks.sources.mockResolvedValue([]);mocks.reports.mockResolvedValue([]);
    const {result}=renderHook(()=>useRecipeIntelligenceRead(scope));
    await waitFor(()=>expect(result.current.state).toBe("complete"));
    expect(result.current.data.recipeProductReports).toEqual([]);expect(result.current.error).toBe("");
  });
  it("rejects late outlet/period responses and obsolete refresh, and revalidates only relevant scope",async()=>{
    let resolveOld;
    mocks.reports.mockImplementation(({outletIds})=>outletIds[0]==="a" ? new Promise(resolve=>{resolveOld=resolve;}) : Promise.resolve([]));
    const {result,rerender}=renderHook(props=>useRecipeIntelligenceRead(props),{initialProps:scope});
    const oldRefresh=result.current.refresh;
    rerender({...scope,outletId:"b",recipeReportMonth:8});
    await waitFor(()=>expect(result.current.state).toBe("complete"));
    await act(async()=>resolveOld([{id:"s",report_month:9,report_year:2026}]));
    expect(result.current.data.recipeProductReports).toEqual([]);
    const calls=mocks.reports.mock.calls.length;
    await act(async()=>{await oldRefresh();invalidateInventoryReads({outletId:"a"});});
    expect(mocks.reports).toHaveBeenCalledTimes(calls);
    await act(async()=>invalidateInventoryReads({outletId:"b"}));
    await waitFor(()=>expect(mocks.reports).toHaveBeenCalledTimes(calls+1));
  });
  it("preserves mapped profit, consumption, forecast and trends; pending/ignored products do not contribute",()=>{
    const data={recipes:[recipe],items:[{id:"i",name:"Rice",cost:2,unit:"kg",categoryId:"c"}],categories:[{id:"c",name:"Food"}],menuCategories:[]};
    const projection=createRecipeIntelligenceProjection({data,outletById:new Map(),activeRecipeOutletId:"a",...scope,recipeProductReports:[{id:"s",report_month:9,report_year:2026}],recipeProductItems:[{report_id:"s",product_name:"Rice",quantity:3,nett_sales:30},{report_id:"s",product_name:"Pending",quantity:100,nett_sales:1000},{report_id:"s",product_name:"Ignored",quantity:100,nett_sales:1000}],recipeProductMappings:[{product_name:"Rice",recipe_id:"r",status:"mapped"},{product_name:"Ignored",status:"ignored"}]});
    expect(projection.currentYearGrossProfit).toBeCloseTo(16.8);
    expect(projection.mappedProductCount).toBe(1);expect(projection.pendingProductCount).toBe(1);expect(projection.ignoredProductCount).toBe(1);
    expect(projection.ingredientConsumptionRowsWithContribution[0]).toMatchObject({estimatedUsage:6,totalCost:12,costContribution:100});
    expect(projection.ingredientDemandForecastRows[0]).toMatchObject({forecastUsage:2,forecastCost:4});
    expect(projection.ingredientTrendSeries[0].values[8].value).toBe(12);
    expect(projection.mappedRecipeCount).toBe(1);expect(projection.reliableMenuEngineeringRows).toEqual([]);
  });
});
