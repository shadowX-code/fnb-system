import { describe, expect, it } from "vitest";
import { getSidebarSections } from "../../../config/modules.ts";
import { canonicalRouteId } from "../routeOwnership.js";
import { routeDetails, salesPurchaseRoutes } from "../routes.jsx";

describe("Crew Growth navigation ownership", () => {
  it("removes standalone Certification Review from Growth navigation", () => {
    const growth = getSidebarSections("crew").find((section) => section.label === "Growth");
    expect(growth?.items).toEqual([
      { id: "crew_growth", label: "Growth Overview" },
      { id: "crew_growth_skills", label: "Skills" },
    ]);
  });

  it("redirects legacy Growth routes to Growth Overview", () => {
    expect(canonicalRouteId("crew_growth_people")).toBe("crew_growth");
    expect(canonicalRouteId("crew_growth_reviews")).toBe("crew_growth");
    expect(routeDetails.crew_growth_people.props).toEqual({ initialTab: "overview" });
    expect(routeDetails.crew_growth_reviews.props).toEqual({ initialTab: "overview" });
    expect(salesPurchaseRoutes.find((route) => route.id === "crew_growth_people")?.permission).toBe("crew_growth.view");
  });
});
