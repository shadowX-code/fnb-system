import React from "react";
import { createRoot } from "react-dom/client";
import App from "./app/App.jsx";
import "./styles/workspaceStyles.js";

try {
  const isCrewRoute = window.location.hash === "#crew" || window.location.hash.startsWith("#crew/");
  const crewThemeChoice = localStorage.getItem("feedx.crew.theme");
  const themeChoice = localStorage.getItem("fnb.theme") || "system";
  const systemTheme = window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
  document.documentElement.dataset.theme = themeChoice;
  document.documentElement.dataset.resolvedTheme = themeChoice === "system" ? systemTheme : themeChoice;
  document.documentElement.dataset.crewTheme = isCrewRoute && (crewThemeChoice === "light" || crewThemeChoice === "dark") ? crewThemeChoice : systemTheme;
} catch {
  document.documentElement.dataset.theme = "system";
  document.documentElement.dataset.resolvedTheme = "light";
  document.documentElement.dataset.crewTheme = "light";
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
