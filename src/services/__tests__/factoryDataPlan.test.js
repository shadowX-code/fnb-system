import { describe, expect, it } from "vitest";
import { factoryDataPlan } from "../factoryService.js";

const can = () => true;

describe("Factory Job Orders scoped data plan", () => {
  it("keeps Job Orders listing and audit data out of the Workspace scope while retaining modal support data", () => {
    const plan = factoryDataPlan("job-orders", can);

    expect(plan.jobOrders).toBe(false);
    expect(plan.auditLogs).toBe(false);
    expect(plan.finishedGoods).toBe(true);
    expect(plan.productFamilies).toBe(true);
    expect(plan.rawMaterials).toBe(true);
    expect(plan.recipes).toBe(true);
    expect(plan.sops).toBe(true);
    expect(plan.storageLocations).toBe(true);
  });

  it("preserves Production Overview scoped support and Job Order data planning", () => {
    const plan = factoryDataPlan("production-overview", can);

    expect(plan.jobOrders).toBe(true);
    expect(plan.finishedGoods).toBe(true);
    expect(plan.productFamilies).toBe(true);
    expect(plan.rawMaterials).toBe(true);
    expect(plan.recipes).toBe(true);
    expect(plan.sops).toBe(true);
    expect(plan.storageLocations).toBe(true);
  });
});
