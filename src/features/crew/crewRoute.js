const CREW_ROOT = "crew";

const routeByPath = {
  home: { screen: "home" },
  learn: { screen: "learn" },
  reward: { screen: "reward" },
  growth: { screen: "growth", growthInitialView: "overview" },
  "growth/performance": { screen: "growth", growthInitialView: "performance" },
  me: { screen: "me", meView: "main" },
  "me/attendance": { screen: "attendance" },
  "me/cash-checkout": { screen: "cash-checkout" },
  "me/leave": { screen: "leave" },
  tasks: { screen: "operations" },
  schedule: { screen: "schedule" },
};

export const crewHomeRoute = Object.freeze({ screen: "home", canonicalHash: "#crew/home" });

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
  const route = routeByPath[path.slice(`${CREW_ROOT}/`.length)];
  return route ? { ...route, canonicalHash: `#${path}` } : { ...crewHomeRoute, needsNormalization: true };
}

export function crewRouteForState({ screen, growthInitialView = "overview" }) {
  if (screen === "learn") return { screen, canonicalHash: "#crew/learn" };
  if (screen === "reward") return { screen, canonicalHash: "#crew/reward" };
  if (screen === "growth") return { screen, growthInitialView, canonicalHash: growthInitialView === "performance" ? "#crew/growth/performance" : "#crew/growth" };
  if (screen === "me") return { screen, canonicalHash: "#crew/me" };
  if (screen === "attendance") return { screen, canonicalHash: "#crew/me/attendance" };
  if (screen === "cash-checkout") return { screen, canonicalHash: "#crew/me/cash-checkout" };
  if (screen === "leave") return { screen, canonicalHash: "#crew/me/leave" };
  if (screen === "operations") return { screen, canonicalHash: "#crew/tasks" };
  if (screen === "schedule") return { screen, canonicalHash: "#crew/schedule" };
  return crewHomeRoute;
}
