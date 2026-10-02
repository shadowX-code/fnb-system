import { describe, expect, it } from "vitest";
import { moduleRegistry } from "../../../config/modules.ts";
import { salesPurchaseRoutes } from "../routes.jsx";
import { resolveLegacyHash, resolveCanonicalPath } from "../routeOwnership.js";

describe("canonical SOP access and retired Journeys", () => {
  it("uses View Library for the shared route/sidebar visibility predicate", () => {
    const route = salesPurchaseRoutes.find((row) => row.id === "crew_sop_library");
    expect(route.permission).toBe("crew_sop_library.view");
    const allows = (codes) => route.permission.split(" OR ").some((code) => codes.includes(code));
    expect(allows(["crew_sop_library.view"])).toBe(true);
    expect(allows(["crew_sop_library.create", "crew_sop_library.edit", "crew_sop.manage"])).toBe(false);
  });
  it("retires the independent Journeys catalog while preserving Onboarding links", () => {
    expect(moduleRegistry.some((row) => row.id === "crew_journeys")).toBe(false);
    expect(salesPurchaseRoutes.some((row) => row.id === "crew_journeys")).toBe(false);
    expect(resolveLegacyHash("#crew_journeys").definition.routeId).toBe("crew_learning");
    for (const path of ["/crew/journeys", "/crew/learning/journeys"]) {
      expect(resolveCanonicalPath(path).definition.routeId).toBe("crew_learning");
    }
  });
});
