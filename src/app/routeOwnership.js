export const legacyRouteRedirects = Object.freeze({
  "duty-roster": "crew_roster",
  outlet_duty_roster: "crew_roster",
  // Pre-reset Learning navigation used this name. Keep old saved links on the
  // canonical Onboarding page rather than falling through to another route.
  crew_onboarding: "crew_learning",
  crew_operation_templates: "crew_operations",
  crew_growth_people: "crew_growth",
  crew_performance_reviews: "crew_performance",
  crew_reward_cycles: "crew_reward",
});

export function canonicalRouteId(routeId = "") {
  const normalized = String(routeId).replace(/^#/, "").split("/")[0];
  return legacyRouteRedirects[normalized] ?? normalized;
}
