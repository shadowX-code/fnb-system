import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  // Exact Staging data environment only; Production builds eliminate preview imports.
  define: { __FINANCE_STAGING_PREVIEW__: JSON.stringify(loadEnv(mode, process.cwd(), "").VITE_SUPABASE_URL === "https://ujkzdaaadnvcfayuldmh.supabase.co") },
  plugins: [react()],
  test: { environment: "jsdom" },
}));
