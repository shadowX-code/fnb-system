import { useEffect, useLayoutEffect, useMemo, useState } from "react";

export const CREW_THEME_STORAGE_KEY = "feedx.crew.theme";

function systemTheme() {
  return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
}

export function readCrewThemePreference() {
  try {
    const value = localStorage.getItem(CREW_THEME_STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

export function resolveCrewTheme(preference = readCrewThemePreference()) {
  return preference || systemTheme();
}

function applyCrewTheme(theme) {
  document.documentElement.dataset.crewTheme = theme;
}

export default function useCrewTheme() {
  const [preference, setPreference] = useState(readCrewThemePreference);
  const [system, setSystem] = useState(systemTheme);
  const resolvedTheme = useMemo(() => preference || system, [preference, system]);

  useLayoutEffect(() => {
    applyCrewTheme(resolvedTheme);
  }, [resolvedTheme]);

  useEffect(() => {
    const query = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!query || preference) return undefined;
    const onChange = (event) => setSystem(event.matches ? "dark" : "light");
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [preference]);

  function toggleTheme() {
    const next = resolvedTheme === "dark" ? "light" : "dark";
    setPreference(next);
    try {
      localStorage.setItem(CREW_THEME_STORAGE_KEY, next);
    } catch {
      // The chosen appearance remains active for this browser session.
    }
  }

  return { theme: resolvedTheme, toggleTheme };
}
