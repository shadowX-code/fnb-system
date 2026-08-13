import { describe, expect, it } from "vitest";
import { getSidebarSections, getPermissionDefinitions } from "../../../config/modules.ts";
import { canonicalRouteId } from "../routeOwnership.js";
import { routeDetails, salesPurchaseRoutes } from "../routes.jsx";

describe("Crew Duty Roster navigation ownership", () => {
  it("exposes Duty Roster only in Crew Workforce navigation", () => {
    const restaurantIds = getSidebarSections("restaurant").flatMap((section) => section.items.map((item) => item.id));
    const crewSections = getSidebarSections("crew");
    const crewRosterSection = crewSections.find((section) => section.label === "Workforce");

    expect(restaurantIds).not.toContain("duty-roster");
    expect(restaurantIds).not.toContain("outlet_duty_roster");
    expect(crewRosterSection?.items).toContainEqual({ id: "crew_roster", label: "Duty Roster" });
  });

  it("canonicalizes both Restaurant legacy routes to Crew Duty Roster", () => {
    expect(canonicalRouteId("duty-roster")).toBe("crew_roster");
    expect(canonicalRouteId("#outlet_duty_roster")).toBe("crew_roster");
    expect(canonicalRouteId("crew_roster")).toBe("crew_roster");
  });

  it("protects canonical and legacy routes with only crew_roster.view", () => {
    for (const id of ["duty-roster", "outlet_duty_roster", "crew_roster"]) {
      expect(salesPurchaseRoutes.find((route) => route.id === id)?.permission).toBe("crew_roster.view");
      expect(routeDetails[id]?.component).toBe(routeDetails.crew_roster.component);
    }
  });

  it("does not advertise legacy Restaurant roster permissions", () => {
    const codes = getPermissionDefinitions().map((permission) => permission.code);
    expect(codes).not.toEqual(expect.arrayContaining([
      "duty_roster.view",
      "duty_roster.manage",
      "outlet_duty_roster.view",
    ]));
    expect(codes).toEqual(expect.arrayContaining([
      "crew_roster.view",
      "crew_roster.manage",
      "crew_roster.publish",
    ]));
  });
});
