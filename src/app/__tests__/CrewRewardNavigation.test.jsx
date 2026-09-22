import { describe, expect, it } from "vitest";
import { getSidebarSections } from "../../../config/modules.ts";
import { canonicalRouteId } from "../routeOwnership.js";
import { routeDetails, salesPurchaseRoutes } from "../routes.jsx";

describe("Crew Reward navigation ownership", () => {
  it("shows only Reward Overview in the Reward section", () => {
    const reward = getSidebarSections("crew").find((section) => section.label === "Reward");
    expect(reward?.items).toEqual([{ id: "crew_reward", label: "Reward Overview" }]);
  });

  it("redirects the legacy Reward Cycles route to Reward Overview", () => {
    expect(canonicalRouteId("crew_reward_cycles")).toBe("crew_reward");
    expect(salesPurchaseRoutes.find((route) => route.id === "crew_reward_cycles")?.permission).toBe("crew_reward.view");
    expect(routeDetails.crew_reward_cycles.props).toEqual({});
  });
});
