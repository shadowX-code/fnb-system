import { expect, it } from "vitest";
import { factoryProfilingEnabled } from "../../../../../vite.config.js";
it("enables React profiling only for the exact Staging database and dev build", () => {
  expect(factoryProfilingEnabled({ VITE_SUPABASE_URL: "https://ujkzdaaadnvcfayuldmh.supabase.co", VERCEL_GIT_COMMIT_REF: "dev" })).toBe(true);
  expect(factoryProfilingEnabled({ VITE_SUPABASE_URL: "https://oyfobxdoyfuzsodogpgs.supabase.co", VERCEL_GIT_COMMIT_REF: "dev" })).toBe(false);
  expect(factoryProfilingEnabled({ VITE_SUPABASE_URL: "https://ujkzdaaadnvcfayuldmh.supabase.co", VERCEL_GIT_COMMIT_REF: "main" })).toBe(false);
  expect(factoryProfilingEnabled({ VITE_SUPABASE_URL: "https://ujkzdaaadnvcfayuldmh.supabase.co" })).toBe(false);
});
