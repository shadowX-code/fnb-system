import { crewMobileRouteForState, legacyHashForRoute, resolveCrewMobileHash } from "../../app/routeOwnership.js";

const CREW_ROOT = "crew";

function routeState(definition) {
  return {
    ...definition.crewState,
    canonicalHash: legacyHashForRoute(definition.id),
  };
}

export const crewHomeRoute = Object.freeze(routeState(crewMobileRouteForState({ screen: "home" })));

function hashPath(hash = window.location.hash) {
  return String(hash || "").replace(/^#/, "").split(/[?#]/)[0].replace(/^\/+|\/+$/g, "");
}

export function isCrewHash(hash = window.location.hash) {
  const path = hashPath(hash);
  return path === CREW_ROOT || path.startsWith(`${CREW_ROOT}/`);
}

export function parseCrewRoute(hash = window.location.hash) {
  const path = hashPath(hash);
  if (path === CREW_ROOT) return { ...crewHomeRoute, needsNormalization: true };
  if (!path.startsWith(`${CREW_ROOT}/`)) return null;
  const route = resolveCrewMobileHash(hash);
  return route ? routeState(route.definition) : { ...crewHomeRoute, needsNormalization: true };
}

export function crewRouteForState({ screen, growthInitialView = "overview" }) {
  return routeState(crewMobileRouteForState({ screen, growthInitialView }));
}
