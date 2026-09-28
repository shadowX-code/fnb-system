import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({load: vi.fn()}));
vi.mock("../inventoryRecipeService.js", () => ({loadInventoryRecipes: mocks.load}));
import useInventoryRecipesRead from "../useInventoryRecipesRead.js";
import { createRecipeWorkspaceProjection } from "../inventoryRecipeReadModel.js";
afterEach(cleanup);
beforeEach(() => { mocks.load.mockReset(); });
const complete = id => ({recipes: [{id}], items: [], categories: [], menuCategories: [], completeness: "complete"});
describe("Recipes scoped atomic read", () => {
  it("preserves the existing analysis period labels for the shared Intelligence consumer", () => {
    const projection = createRecipeWorkspaceProjection({data:{recipes:[],items:[],menuCategories:[]},outletById:new Map(),activeRecipeOutletId:"a",recipeFilters:{category:"all",status:"active",search:""},recipeAnalysisPeriod:"last3",recipeReportYear:2026,recipeReportMonth:9,recipeTrendYear:2026,recipeProductReports:[],recipeProductItems:[],recipeProductMappings:[]});
    expect(projection.selectedPeriod).toEqual({value:"last3",label:"Last 3 Months",months:3});
  });
  it("rejects an old outlet response and immediately hides the previous outlet projection", async () => {
    let resolveA;
    mocks.load.mockImplementation(id => id === "a" ? new Promise(resolve => {resolveA = resolve;}) : Promise.resolve(complete("b")));
    const {result, rerender} = renderHook(({outletId}) => useInventoryRecipesRead({outletId, scopeKey:"user", enabled:true}), {initialProps:{outletId:"a"}});
    rerender({outletId:"b"});
    await waitFor(() => expect(result.current.data?.recipes[0].id).toBe("b"));
    await act(async () => resolveA(complete("a")));
    expect(result.current.data.recipes[0].id).toBe("b");
  });
  it.each(["error", "incomplete"])("never publishes an %s read as empty authoritative data", async readState => {
    mocks.load.mockRejectedValue(Object.assign(new Error("Unverified recipe read"), {readState}));
    const {result} = renderHook(() => useInventoryRecipesRead({outletId:"a",scopeKey:"user",enabled:true}));
    await waitFor(() => expect(result.current.state).toBe(readState));
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe("Unverified recipe read");
  });
  it("cannot refresh an obsolete scope after outlet switching", async () => {
    mocks.load.mockImplementation(id => Promise.resolve(complete(id)));
    const {result,rerender} = renderHook(({outletId}) => useInventoryRecipesRead({outletId,scopeKey:"user",enabled:true}), {initialProps:{outletId:"a"}});
    await waitFor(() => expect(result.current.data?.recipes[0].id).toBe("a"));
    const obsoleteRefresh = result.current.refresh;
    rerender({outletId:"b"});
    await waitFor(() => expect(result.current.data?.recipes[0].id).toBe("b"));
    await act(async () => obsoleteRefresh());
    expect(result.current.data.recipes[0].id).toBe("b");
    expect(mocks.load.mock.calls.map(([id]) => id)).toEqual(["a","b"]);
  });
});
