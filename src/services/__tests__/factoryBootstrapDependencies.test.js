import { beforeEach, describe, expect, it, vi } from "vitest";
const transport = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ supabase: transport }));
vi.mock("../../lib/supabase.ts", () => ({ supabase: transport }));
import { factoryService } from "../factoryService.js";

beforeEach(() => vi.clearAllMocks());
describe("Factory bootstrap dataset ownership", () => {
  it.each(["production-overview", "job-orders", "product-feedback", "petty-cash", "mesti-waste-disposal", "mesti-operator-hygiene"])("%s never issues unrelated Recipe/SOP/master requests", async (scope) => {
    const result = await factoryService.listFactoryData({ scope, hasPermission: () => true });
    expect(result.accessIssues).toEqual([]);
    expect(transport.rpc).not.toHaveBeenCalled();
    expect(transport.from).not.toHaveBeenCalled();
  });
  it("does not multiply SDK transport retries by restarting the entire snapshot load", async () => {
    transport.rpc.mockImplementation(() => ({ then(resolve) { return Promise.resolve({ data: null, error: { message: "Network unavailable" } }).then(resolve); } }));
    const result = await factoryService.listFactoryData({ scope: "production-overview", action: "completed-job-result", hasPermission: () => true });
    expect(transport.rpc).toHaveBeenCalledTimes(1);
    expect(result.accessIssues).toMatchObject([{ key: "recipes", kind: "load" }]);
    expect(result.recipes).toEqual([]);
  });
  it("still retries a changing snapshot and never accepts an incomplete master tree", async () => {
    transport.rpc.mockImplementation((name) => ({ then(resolve) { return Promise.resolve({ data: name === "factory_get_master_id_snapshot" ? ["recipe"] : [], error: null }).then(resolve); } }));
    let detailCalls = 0;
    transport.from.mockImplementation(() => ({ select() { return this; }, in() { return this; }, then(resolve) {
      detailCalls += 1;
      return Promise.resolve({ data: detailCalls === 1 ? [] : [{ id: "recipe", status: "active", yield_quantity: 1, uom: "kg" }], error: null }).then(resolve);
    } }));
    const result = await factoryService.listFactoryData({ scope: "production-overview", action: "completed-job-result", hasPermission: () => true });
    expect(detailCalls).toBe(2);
    expect(result.accessIssues).toEqual([]);
    expect(result.recipes).toHaveLength(1);
  });
  it("loads every Recipe item across bounded snapshot batches and reports safe dependency timing", async () => {
    const ids = Array.from({ length: 350 }, (_, index) => `item-${index}`);
    const item = (id) => ({ id, recipe_id: "recipe", raw_material_id: "material", quantity_used: 1, uom: "kg", raw_material: { id: "material", name: "Material", uom: "kg" } });
    transport.rpc.mockImplementation((name, args) => {
      const data = name === "factory_get_master_child_snapshot" ? ids.map((id) => ({ id, parent_id: "recipe" })) : args.p_entity === "product_recipes" ? ["recipe"] : [];
      return { abortSignal() { return this; }, then(resolve) { return Promise.resolve({ data, error: null }).then(resolve); } };
    });
    const batches = [];
    transport.from.mockImplementation((table) => ({ select() { return this; }, in(_key, selected) {
      if (table === "factory_product_recipe_items") batches.push([...selected]);
      this.data = table === "factory_product_recipes" ? [{ id: "recipe", version: "v1", status: "active", yield_quantity: 1, uom: "kg" }] : selected.map(item);
      return this;
    }, abortSignal() { return this; }, then(resolve) { return Promise.resolve({ data: this.data, error: null }).then(resolve); } }));
    const onDependency = vi.fn();
    const result = await factoryService.listFactoryData({ scope: "production-overview", action: "completed-job-result", hasPermission: () => true, onDependency });
    expect(result.accessIssues).toEqual([]);
    expect(result.recipes[0].items).toHaveLength(350);
    expect(batches.map((batch) => batch.length)).toEqual([300, 50]);
    expect(batches.flat()).toEqual(ids);
    expect(onDependency.mock.calls.map(([event]) => event.status)).toEqual(["pending", "ready"]);
    expect(Object.keys(onDependency.mock.calls[1][0]).sort()).toEqual(["elapsedMs", "key", "label", "status"]);
  });
});
