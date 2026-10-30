import { describe, expect, it } from "vitest";
import { factoryDataPlan } from "../factoryService.js";

const can = () => true;

describe("Factory Job Orders scoped data plan", () => {
  it.each(["job-orders", "production-overview", "product-feedback", "petty-cash", "audit-logs"])("does not block %s on unrelated workspace datasets", (scope) => {
    expect(Object.values(factoryDataPlan(scope, can)).some(Boolean)).toBe(false);
  });
  it("retains full action-specific support behind the production action boundary", () => {
    const job = factoryDataPlan("production-overview", can, "job");
    expect(Object.keys(job).filter((key) => job[key])).toEqual(["rawMaterials", "finishedGoods", "recipes"]);
    const filters = factoryDataPlan("job-orders", can, "job-filters");
    expect(Object.keys(filters).filter((key) => filters[key])).toEqual(["finishedGoods", "productFamilies"]);
    const completion = factoryDataPlan("production-overview", can, "production");
    for (const key of ["rawMaterials", "recipes", "sops", "storageLocations", "equipment", "finishedGoods"]) expect(completion[key]).toBe(true);
    expect(completion.jobOrders).toBe(false);
    expect(completion.productions).toBe(false);
    expect(Object.values(factoryDataPlan("production-overview", () => false, "production")).some(Boolean)).toBe(false);
  });

  it("loads MeSTI Cleaning setup support without production or stock datasets", () => {
    const plan = factoryDataPlan("mesti-cleaning", can);

    expect(plan.storageLocations).toBe(true);
    expect(plan.mestiCleaningRequirements).toBe(true);
    expect(plan.factoryRoles).toBeUndefined();
    expect(plan.mestiCleaningSettings).toBeUndefined();
    expect(plan.jobOrders).toBe(false);
    expect(plan.rawMaterials).toBe(false);
    expect(plan.finishedGoods).toBe(false);
  });
});

it("keeps Finished Good catalog complete without reading history until detail opens", () => {
  const list = factoryDataPlan("finished-goods", can);
  expect(list.finishedGoods).toBe(true);
  expect(list.productFamilies).toBe(true);
  expect(list.recipes).toBe(true);
  expect(list.storageLocations).toBe(true);
  expect(list.productions).toBe(false);
  expect(list.productMovements).toBe(false);
  const history = factoryDataPlan("finished-goods", can, "finished-good-history");
  expect(Object.keys(history).filter(key => history[key])).toEqual(["productions", "productMovements"]);
  expect(Object.values(factoryDataPlan("finished-goods", () => false, "finished-good-history")).some(Boolean)).toBe(false);
});
