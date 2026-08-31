import { describe, expect, it } from "vitest";
import { crewHomeRoute, crewRouteForState, isCrewHash, parseCrewRoute } from "../crewRoute.js";

describe("Crew hash routes", () => {
  it("keeps legacy #crew compatible and normalizes it to Home", () => {
    expect(parseCrewRoute("#crew")).toMatchObject({ ...crewHomeRoute, needsNormalization: true });
  });

  it("maps canonical primary and operational routes to screen identity", () => {
    expect(parseCrewRoute("#crew/learn")).toMatchObject({ screen: "learn" });
    expect(parseCrewRoute("#crew/growth/performance")).toMatchObject({ screen: "growth", growthInitialView: "performance" });
    expect(parseCrewRoute("#crew/me/attendance")).toMatchObject({ screen: "attendance" });
    expect(parseCrewRoute("#crew/tasks")).toMatchObject({ screen: "operations" });
    expect(parseCrewRoute("#crew/schedule")).toMatchObject({ screen: "schedule" });
  });

  it("fails invalid Crew routes closed to canonical Home without claiming Admin routes", () => {
    expect(parseCrewRoute("#crew/not-a-screen")).toMatchObject({ ...crewHomeRoute, needsNormalization: true });
    expect(parseCrewRoute("#dashboard")).toBeNull();
    expect(isCrewHash("#crew/reward")).toBe(true);
    expect(isCrewHash("#dashboard")).toBe(false);
  });

  it("maps application state back to one canonical hash", () => {
    expect(crewRouteForState({ screen: "home" }).canonicalHash).toBe("#crew/home");
    expect(crewRouteForState({ screen: "growth", growthInitialView: "performance" }).canonicalHash).toBe("#crew/growth/performance");
    expect(crewRouteForState({ screen: "cash-checkout" }).canonicalHash).toBe("#crew/me/cash-checkout");
  });
});
