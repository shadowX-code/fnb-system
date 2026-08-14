import { describe, expect, it } from "vitest";
import { getSidebarSections } from "../../../config/modules.ts";
import { canonicalRouteId } from "../routeOwnership.js";
import { routeDetails, salesPurchaseRoutes } from "../routes.jsx";

describe("Crew Operations Tasks navigation ownership", () => {
  it("shows one Tasks product entry and hides the legacy Templates concept", () => {
    const operations = getSidebarSections("crew").find((section) => section.label === "Operations");
    expect(operations?.items).toEqual([{ id: "crew_operations", label: "Tasks" }]);
    expect(operations?.items.some((item) => item.id === "crew_operation_templates")).toBe(false);
  });

  it("canonicalizes the old Templates route to the secure Tasks route", () => {
    expect(canonicalRouteId("crew_operation_templates")).toBe("crew_operations");
    expect(routeDetails.crew_operation_templates.component).toBe(routeDetails.crew_operations.component);
    expect(salesPurchaseRoutes.find((route) => route.id === "crew_operation_templates")?.permission).toBe("crew_operations.view");
  });
});
