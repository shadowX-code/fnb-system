import { describe, expect, it } from "vitest";
import { getSidebarSections, moduleRegistry } from "../../../config/modules.ts";
import { canonicalRouteId } from "../routeOwnership.js";
import { routeDetails, salesPurchaseRoutes } from "../routes.jsx";

describe("Crew Performance navigation ownership", () => {
  it("shows one Performance workspace plus Customer Feedback", () => {
    const performance = getSidebarSections("crew").flatMap((section) => section.items).filter((item) => item.id?.startsWith("crew_performance") || item.id === "crew_customer_feedback");
    expect(performance.map((item) => item.id)).toEqual(["crew_performance", "crew_customer_feedback"]);
    expect(moduleRegistry.find((item) => item.id === "crew_performance_reviews")?.sidebar).toBe(false);
  });

  it("redirects the legacy Reviews route to Performance Overview", () => {
    expect(canonicalRouteId("crew_performance_reviews")).toBe("crew_performance");
    expect(salesPurchaseRoutes.find((route) => route.id === "crew_performance_reviews")?.permission).toBe("crew_performance.review");
    expect(routeDetails.crew_performance_reviews.props).toEqual({ initialTab: "overview" });
  });
});
