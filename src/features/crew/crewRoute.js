import { CREW_WEB_APP_ORIGIN, isCrewWebAppHostname, isProductionOperationsHostname } from "../../app/hostnameRouting.js";
import { crewMobileRouteForState, legacyHashForRoute, resolveCrewMobileHash, resolveCrewMobilePath } from "../../app/routeOwnership.js";

const CREW_ROOT = "crew";

function routeState(definition) {
  return {
    ...definition.crewState,
    canonicalHash: legacyHashForRoute(definition.id),
    canonicalPath: definition.canonicalPath,
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

export function isCrewWebAppLocation(location = window.location) {
  return isCrewWebAppHostname(location?.hostname);
}

export function crewWorkspaceForLocation(location = window.location) {
  if (isCrewWebAppLocation(location)) return "crew";
  if (isCrewHash(location?.hash)) return isProductionOperationsHostname(location?.hostname) ? "legacy-crew-redirect" : "crew";
  return "admin";
}

export function crewRouteUrlForLegacyHash(hash = window.location.hash) {
  const route = resolveCrewMobileHash(hash);
  if (!route) return null;
  return new URL(route.definition.canonicalPath, CREW_WEB_APP_ORIGIN).toString();
}

export function parseCrewRoute(location = window.location) {
  const currentLocation = typeof location === "string" ? { hash: location } : location;
  if (isCrewWebAppLocation(currentLocation)) {
    const route = resolveCrewMobilePath(currentLocation.pathname);
    if (!route) return { ...crewHomeRoute, needsNormalization: true };
    return { ...routeState(route.definition), needsNormalization: currentLocation.pathname !== route.definition.canonicalPath };
  }

  const hash = currentLocation.hash;
  const path = hashPath(hash);
  if (path === CREW_ROOT) return { ...crewHomeRoute, needsNormalization: true };
  if (!path.startsWith(`${CREW_ROOT}/`)) return null;
  const route = resolveCrewMobileHash(hash);
  return route ? routeState(route.definition) : { ...crewHomeRoute, needsNormalization: true };
}

export function crewRouteForState({ screen, growthInitialView = "overview" } = {}) {
  return routeState(crewMobileRouteForState({ screen, growthInitialView }));
}
