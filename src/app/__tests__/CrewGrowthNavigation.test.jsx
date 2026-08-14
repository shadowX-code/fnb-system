import { describe, expect, it } from "vitest";
import { getSidebarSections } from "../../../config/modules.ts";
import { canonicalRouteId } from "../routeOwnership.js";
import { routeDetails, salesPurchaseRoutes } from "../routes.jsx";

describe("Crew Growth navigation ownership", () => {
  it("shows only the three canonical Growth destinations", () => {
    const growth = getSidebarSections("crew").find((section) => section.label === "Growth");
    expect(growth?.items).toEqual([
      { id: "crew_growth", label: "Growth Overview" },
      { id: "crew_growth_skills", label: "Skills" },
      { id: "crew_growth_reviews", label: "Certification Review" },
    ]);
  });

  it("redirects the legacy Crew Growth route to Growth Overview", () => {
    expect(canonicalRouteId("crew_growth_people")).toBe("crew_growth");
    expect(routeDetails.crew_growth_people.props).toEqual({ initialTab: "overview" });
    expect(salesPurchaseRoutes.find((route) => route.id === "crew_growth_people")?.permission).toBe("crew_growth.view");
  });
});
