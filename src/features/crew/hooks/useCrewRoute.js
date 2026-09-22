import { useCallback, useEffect, useState } from "react";
import { crewHomeRoute, crewRouteForState, isCrewWebAppLocation, parseCrewRoute } from "../crewRoute.js";

function destinationFor(route) {
  return isCrewWebAppLocation() ? route.canonicalPath : route.canonicalHash;
}

function currentDestination() {
  return isCrewWebAppLocation() ? window.location.pathname : window.location.hash;
}

function writeRoute(route, { replace = false } = {}) {
  const destination = destinationFor(route);
  if (currentDestination() === destination) return;
  window.history[replace ? "replaceState" : "pushState"](null, "", destination);
}

export default function useCrewRoute() {
  const [route, setRoute] = useState(() => ({ ...(parseCrewRoute() || crewHomeRoute), entry: 0 }));
  useEffect(() => {
    const syncRoute = () => {
      const next = parseCrewRoute();
      if (!next) return;
      if (next.needsNormalization) writeRoute(next, { replace: true });
      setRoute((current) => ({ ...next, entry: current.entry + 1 }));
    };
    window.addEventListener("popstate", syncRoute);
    window.addEventListener("hashchange", syncRoute);
    return () => {
      window.removeEventListener("popstate", syncRoute);
      window.removeEventListener("hashchange", syncRoute);
    };
  }, []);

  useEffect(() => {
    const canonical = crewRouteForState(route);
    writeRoute(canonical, { replace: route.needsNormalization });
  }, [route]);

  const navigate = useCallback((screen, options = {}) => {
    const next = crewRouteForState({ screen, growthInitialView: "overview", ...options });
    writeRoute(next);
    setRoute((current) => ({ ...next, entry: current.entry + 1 }));
  }, []);
  return { screen: route.screen, growthInitialView: route.growthInitialView || "overview", entry: route.entry, navigate };
}
