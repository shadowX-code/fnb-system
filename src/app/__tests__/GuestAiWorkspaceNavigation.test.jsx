import { describe, expect, it } from "vitest";
import { getPermissionDefinitions, getSidebarSections, workspaceSwitcherOptions } from "../../../config/modules.ts";
import { canonicalRouteId } from "../routeOwnership.js";
import { salesPurchaseRoutes } from "../routes.jsx";

describe("Guest AI independent workspace", () => {
  it("registers the independent switcher/navigation surface and explicit permission boundary", () => {
    expect(getSidebarSections("guest_ai").flatMap((section) => section.items.map((item) => item.id))).toEqual([
      "guest_ai_overview", "guest_ai_devices", "guest_ai_interactions", "guest_ai_studio", "guest_ai_developer",
    ]);
    expect(getPermissionDefinitions().map((definition) => definition.code)).toEqual(expect.arrayContaining(["guest_ai.access", "guest_ai.developer"]));
    expect(salesPurchaseRoutes.find((route) => route.id === "guest_ai_overview")?.permission).toBe("guest_ai.access");
    expect(salesPurchaseRoutes.find((route) => route.id === "guest_ai_developer")?.permission).toBe("guest_ai.developer");
  });

  it("redirects the old device-console deep link to the unified Developer page", () => {
    expect(canonicalRouteId("guest_ai_device_console")).toBe("guest_ai_developer");
  });

  it("keeps Guest AI as a fourth workspace with an explicit access boundary", () => {
    const guestAiWorkspace = workspaceSwitcherOptions.find((workspace) => workspace.id === "guest_ai");
    expect(workspaceSwitcherOptions.map((workspace) => workspace.id)).toEqual(["restaurant", "factory", "crew", "guest_ai"]);
    expect(guestAiWorkspace).toMatchObject({ label: "Guest AI", detail: "AI Guest Experience", permission: "guest_ai.access" });
  });
});
