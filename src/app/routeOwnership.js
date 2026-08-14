export const legacyRouteRedirects = Object.freeze({
  "duty-roster": "crew_roster",
  outlet_duty_roster: "crew_roster",
  crew_operation_templates: "crew_operations",
  crew_growth_people: "crew_growth",
  crew_performance_reviews: "crew_performance",
  crew_reward_cycles: "crew_reward",
});

export function canonicalRouteId(routeId = "") {
  const normalized = String(routeId).replace(/^#/, "").split("/")[0];
  return legacyRouteRedirects[normalized] ?? normalized;
}
