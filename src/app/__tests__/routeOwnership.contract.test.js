import { describe, expect, it } from "vitest";
import {
  adminRouteDefinitions,
  canonicalPathForRoute,
  getAdminRouteDefinition,
  legacyHashForRoute,
  resolveAdminLocation,
  resolveCanonicalPath,
  resolveLegacyHash,
} from "../routeOwnership.js";

describe("Admin/Factory canonical route contract", () => {
  it("derives Restaurant, People, System and Factory paths from the module registry", () => {
    expect(getAdminRouteDefinition("reports")).toMatchObject({ canonicalPath: "/restaurant/reports", legacyHashAliases: ["#reports"], ownership: { domain: "restaurant", moduleId: "reports" } });
    expect(getAdminRouteDefinition("employees")).toMatchObject({ canonicalPath: "/people/employees", ownership: { domain: "people", moduleId: "employees", permission: "employees.view" } });
    expect(getAdminRouteDefinition("roles")).toMatchObject({ canonicalPath: "/system/roles", ownership: { domain: "system", moduleId: "roles", permission: "roles.view" } });
    expect(getAdminRouteDefinition("factory_job_order_records")).toMatchObject({ canonicalPath: "/factory/job-orders", ownership: { domain: "factory", moduleId: "factory_job_order_records" } });
    const moduleDefinitions = adminRouteDefinitions.filter((route) => route.id === route.routeId);
    expect(new Set(moduleDefinitions.map((route) => route.canonicalPath)).size).toBe(moduleDefinitions.length);
    expect(moduleDefinitions.some((route) => route.ownership.workspace === "crew" || route.ownership.moduleId.startsWith("guest_ai"))).toBe(false);
  });

  it("round-trips a canonical Restaurant route and only retains declared query state", () => {
    const resolved = resolveCanonicalPath("/restaurant/purchases/comparison", "?supplier=Kedai%20A&qa=external");
    expect(resolved).toMatchObject({ routeId: "purchase-comparison", query: { supplier: "Kedai A" }, source: "pathname" });
    expect(canonicalPathForRoute(resolved.definitionId, resolved.params, resolved.query)).toBe("/restaurant/purchases/comparison?supplier=Kedai+A");
    expect(legacyHashForRoute(resolved.definitionId, resolved.params, resolved.query)).toBe("#purchase-comparison?supplier=Kedai+A");
  });

  it("models inventory date ownership and its legacy stockCheckDate alias", () => {
    expect(resolveLegacyHash("#inventory_stock_check?stockCheckDate=2026-09-22&qa=external")).toMatchObject({
      routeId: "inventory_stock_check", query: { date: "2026-09-22" }, source: "legacy-hash",
    });
    expect(canonicalPathForRoute("inventory_stock_check", {}, { date: "2026-09-22" })).toBe("/restaurant/inventory/stock-check?date=2026-09-22");
    expect(resolveAdminLocation({ pathname: "/", search: "?stockCheckDate=2026-09-22&audit=external", hash: "#inventory_stock_check" })).toMatchObject({
      routeId: "inventory_stock_check", query: { date: "2026-09-22" }, source: "legacy-hash",
    });
  });

  it("dual-reads direct Admin and Factory pathnames while a recognized legacy hash remains authoritative", () => {
    expect(resolveAdminLocation({ pathname: "/restaurant/reports", search: "?qa=external", hash: "" })).toMatchObject({ routeId: "reports", source: "pathname", query: {} });
    expect(resolveAdminLocation({ pathname: "/people/employees", hash: "" })).toMatchObject({ routeId: "employees", source: "pathname" });
    expect(resolveAdminLocation({ pathname: "/factory/dashboard", hash: "" })).toMatchObject({ routeId: "factory_dashboard", source: "pathname" });
    expect(resolveAdminLocation({ pathname: "/factory/job-orders", hash: "" })).toMatchObject({ routeId: "factory_job_order_records", source: "pathname" });
    expect(resolveAdminLocation({ pathname: "/restaurant/reports", hash: "#dashboard" })).toMatchObject({ routeId: "dashboard", source: "legacy-hash" });
  });

  it("round-trips the nested Legal Entity Contract Workspace with its route parameter", () => {
    const id = "6120acd0-0be0-4808-bf96-d810841a284a";
    const legacy = resolveLegacyHash(`#legal-entities/${id}/contract-templates`);
    expect(legacy).toMatchObject({ definitionId: "legal-entities-contract-templates", routeId: "legal-entities", params: { legalEntityId: id } });
    expect(legacy.definition.legacyHashAliases).toEqual(["#legal-entities/:legalEntityId/contract-templates"]);
    expect(canonicalPathForRoute("legal-entities-contract-templates", legacy.params)).toBe(`/people/legal-entities/${id}/contract-templates`);
    expect(legacyHashForRoute("legal-entities-contract-templates", legacy.params)).toBe(`#legal-entities/${id}/contract-templates`);
    expect(resolveAdminLocation({ pathname: `/people/legal-entities/${id}/contract-templates`, hash: "" })).toMatchObject({
      definitionId: "legal-entities-contract-templates", routeId: "legal-entities", params: { legalEntityId: id }, source: "pathname",
    });
  });

  it("centralizes existing Roles detail variants without changing their legacy hashes", () => {
    expect(resolveLegacyHash("#roles/new")).toMatchObject({ definitionId: "roles-new", routeId: "roles" });
    expect(resolveLegacyHash("#roles/role-1/edit")).toMatchObject({ definitionId: "roles-edit", params: { roleId: "role-1" } });
    expect(resolveCanonicalPath("/system/roles/role-1")).toMatchObject({ definitionId: "roles-detail", params: { roleId: "role-1" } });
  });

  it("keeps Crew Mobile and public routes outside this authority", () => {
    expect(resolveLegacyHash("#crew/me")).toBeNull();
    expect(resolveLegacyHash("#feedback?outlet=outlet-1")).toBeNull();
    expect(resolveCanonicalPath("/feedback/product/opaque-token")).toBeNull();
    expect(resolveAdminLocation({ pathname: "/", hash: "#crew/home" })).toBeNull();
  });

  it("returns null for unknown routes and does not define external QA/debug parameters", () => {
    expect(resolveCanonicalPath("/restaurant/not-a-route", "?qa=run")).toBeNull();
    expect(resolveLegacyHash("#not-a-route?audit=trace")).toBeNull();
    expect(adminRouteDefinitions.flatMap((route) => route.query.map((entry) => entry.key))).not.toContain("qa");
    expect(adminRouteDefinitions.flatMap((route) => route.query.map((entry) => entry.key))).not.toContain("audit");
  });
});
