import { useCallback, useEffect, useState } from "react";
import { crewHomeRoute, crewRouteForState, parseCrewRoute } from "../crewRoute.js";

export default function useCrewRoute() {
  const [route, setRoute] = useState(() => ({ ...(parseCrewRoute() || crewHomeRoute), entry: 0 }));
  useEffect(() => {
    const syncRoute = () => {
      const next = parseCrewRoute();
      if (!next) return;
      if (next.needsNormalization) window.history.replaceState(null, "", next.canonicalHash);
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
    if (window.location.hash !== canonical.canonicalHash) {
      window.history[route.needsNormalization ? "replaceState" : "pushState"](null, "", canonical.canonicalHash);
    }
  }, [route]);

  const navigate = useCallback((screen, options = {}) => {
    const next = crewRouteForState({ screen, growthInitialView: "overview", ...options });
    if (window.location.hash !== next.canonicalHash) window.history.pushState(null, "", next.canonicalHash);
    setRoute((current) => ({ screen, growthInitialView: "overview", ...options, entry: current.entry + 1 }));
  }, []);
  return { screen: route.screen, growthInitialView: route.growthInitialView || "overview", entry: route.entry, navigate };
}
