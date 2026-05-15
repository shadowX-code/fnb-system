import React from "react";
import { createRoot } from "react-dom/client";
import App from "./app/App.jsx";
import { AuthProvider } from "./auth/AuthContext.jsx";
import "./styles/index.css";

try {
  const themeChoice = localStorage.getItem("fnb.theme") || "system";
  const systemTheme = window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
  document.documentElement.dataset.theme = themeChoice;
  document.documentElement.dataset.resolvedTheme = themeChoice === "system" ? systemTheme : themeChoice;
} catch {
  document.documentElement.dataset.theme = "system";
  document.documentElement.dataset.resolvedTheme = "light";
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>,
);
