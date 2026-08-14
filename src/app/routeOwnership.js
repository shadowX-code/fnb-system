export const legacyRouteRedirects = Object.freeze({
  "duty-roster": "crew_roster",
  outlet_duty_roster: "crew_roster",
  crew_operation_templates: "crew_operations",
});

export function canonicalRouteId(routeId = "") {
  const normalized = String(routeId).replace(/^#/, "").split("/")[0];
  return legacyRouteRedirects[normalized] ?? normalized;
}
