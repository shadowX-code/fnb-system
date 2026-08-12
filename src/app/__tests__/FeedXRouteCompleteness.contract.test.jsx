import { describe, expect, it } from "vitest";
import { routeDetails, salesPurchaseRoutes } from "../routes.jsx";
import { moduleRegistry, viewPermission } from "../../../config/modules.ts";

const routableModules = moduleRegistry.filter((module) => module.routable !== false);
const internalModules = moduleRegistry.filter((module) => module.routable === false);

describe("FeedX route completeness contract", () => {
  it("resolves every routable registry module through an explicit non-placeholder route detail", () => {
    expect(moduleRegistry).toHaveLength(73);
    expect(routableModules).toHaveLength(71);
    expect(internalModules.map((module) => module.id)).toEqual(["inventory_categories", "inventory_uoms"]);

    for (const module of routableModules) {
      const detail = routeDetails[module.id];
      const route = salesPurchaseRoutes.find((candidate) => candidate.id === module.id);

      expect(detail, `${module.id} must have explicit route details`).toBeTruthy();
      expect(detail.component, `${module.id} must resolve to a component`).toEqual(expect.any(Function));
      expect(route, `${module.id} must be registered as a runtime route`).toBeTruthy();
      expect(route.component, `${module.id} must not use the generic placeholder`).toBe(detail.component);
      expect(route.permission, `${module.id} must use route or registry view permission`).toBe(detail.permission ?? viewPermission(module.id));
    }

    for (const module of internalModules) {
      expect(module.sidebar, `${module.id} must remain hidden from sidebar navigation`).toBe(false);
      expect(routeDetails[module.id], `${module.id} must not be exposed as a direct route`).toBeUndefined();
      expect(salesPurchaseRoutes.some((route) => route.id === module.id), `${module.id} must not be a runtime route`).toBe(false);
    }
  });
});
