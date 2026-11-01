import { afterEach, expect, it, vi } from "vitest";
import { factoryService } from "../factoryService.js";
import { factoryBootstrap } from "../../features/factory/utils/factoryBootstrap.js";
import { clearRecipeFailure, getLatestRecipeFailure } from "../factoryRecipeDiagnostics.js";

let controller;
afterEach(() => { controller?.abort(); clearRecipeFailure(); vi.unstubAllGlobals(); vi.useRealTimers(); });

function setup(missing = false) {
  clearRecipeFailure(); controller = new AbortController();
  const itemIds = Array.from({ length: 350 }, (_, i) => `item-${i}`);
  vi.stubGlobal("fetch", vi.fn(async (input, init) => {
    const url = new URL(input); let data;
    if (url.pathname.endsWith("factory_get_master_id_snapshot")) data = ["recipe-private"];
    else if (url.pathname.endsWith("factory_get_master_child_snapshot")) data = itemIds.map(id => ({ id, parent_id: "recipe-private" }));
    else if (url.pathname.endsWith("factory_product_recipes")) data = [{ id: "recipe-private", status: "active", product_name: "SECRET_RECIPE", yield_quantity: 1 }];
    else {
      const ids = url.searchParams.get("id").slice(4, -1).split(",");
      data = ids.filter(id => !missing || id !== "item-0").map(id => ({ id, recipe_id: "recipe-private", raw_material_id: "material-private", quantity_used: 1 }));
    }
    return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json", "sb-request-id": "01a1947c-aa27-7617-96b9-065333d82e98" } });
  }));
}

it("retains complete real SDK/service reads and discards success diagnostics", async () => {
  setup();
  const result = await factoryService.listFactoryData({ action: "completed-job-result", hasPermission: () => true, signal: controller.signal });
  expect(result.accessIssues).toEqual([]); expect(result.recipes[0].items).toHaveLength(350);
  expect(getLatestRecipeFailure()).toBeNull();
});

it("reports actual partial counts after the unchanged reconciliation retry, and returns no partial tree", async () => {
  setup(true);
  const result = await factoryService.listFactoryData({ action: "completed-job-result", hasPermission: () => true, signal: controller.signal });
  expect(result.recipes).toEqual([]);
  expect(result.accessIssues).toContainEqual(expect.objectContaining({ key: "recipes", kind: "load" }));
  const report = getLatestRecipeFailure();
  expect(report).toMatchObject({ reason: "read_failure", attempt: 2, counts: { expectedRecipes: 1, receivedRecipes: 1, expectedItems: 350, receivedItems: 349 } });
  const itemReads = report.requests.filter(q => q.stage === "Recipe items");
  expect(itemReads).toHaveLength(4);
  expect(itemReads[0]).toMatchObject({ expectedCount: 300, receivedCount: 299, bodyCompletion: "processed", transports: [{ httpStatus: 200, serverCorrelationId: "01a1947c-aa27-7617-96b9-065333d82e98", responseBodyState: "not_observed", existingTraceCorrelationId: null }] });
  expect(JSON.stringify(report)).not.toMatch(/SECRET_RECIPE|recipe-private|material-private|item-0|localhost|Authorization/);
});

it("observes successful headers followed by an interrupted body without changing the 30-second deadline", async () => {
  setup();
  const ordinaryFetch = globalThis.fetch; let itemRequests = 0;
  vi.stubGlobal("fetch", vi.fn((input, init) => {
    if (!new URL(input).pathname.endsWith("factory_product_recipe_items")) return ordinaryFetch(input, init);
    itemRequests++;
    return Promise.resolve(new Response(new ReadableStream({ start(stream) {
      init.signal.addEventListener("abort", () => stream.error(new DOMException("cancelled", "AbortError")), { once: true });
    } }), { headers: { "Content-Type": "application/json", "sb-request-id": "01a1947c-aa27-7617-96b9-065333d82e98" } }));
  }));
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const promise = factoryBootstrap(() => factoryService.listFactoryData({ action: "completed-job-result", hasPermission: () => true, signal: controller.signal }), controller);
  const rejected = expect(promise).rejects.toMatchObject({ name: "TimeoutError" });
  await vi.waitFor(() => expect(itemRequests).toBe(2));
  await vi.advanceTimersByTimeAsync(30000); await rejected;
  const report = getLatestRecipeFailure();
  expect(report).toMatchObject({ reason: "timeout", aborted: true, counts: { expectedItems: 350, receivedItems: 0 } });
  const item = report.requests.find(q => q.stage === "Recipe items");
  expect(item).toMatchObject({ expectedCount: 300, aborted: true, transports: [{ httpStatus: 200, fetchState: "headers_received" }] });
});
