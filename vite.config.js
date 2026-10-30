import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export function factoryProfilingEnabled(env) {
  return env.VITE_SUPABASE_URL === "https://ujkzdaaadnvcfayuldmh.supabase.co" && env.VERCEL_GIT_COMMIT_REF === "dev";
}

export default defineConfig(({ mode }) => ({
  // Profiling is restricted to the explicit Staging data environment and dev Git build.
  resolve: { alias: factoryProfilingEnabled({ ...loadEnv(mode, process.cwd(), ""), ...process.env }) ? { "react-dom/client": "react-dom/profiling" } : {} },
  // Exact Staging data environment only; Production builds eliminate preview imports.
  define: { __FINANCE_STAGING_PREVIEW__: JSON.stringify(loadEnv(mode, process.cwd(), "").VITE_SUPABASE_URL === "https://ujkzdaaadnvcfayuldmh.supabase.co") },
  plugins: [react()],
  test: { environment: "jsdom" },
}));
