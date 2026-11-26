import { afterEach, expect, it, vi } from "vitest";
import handler from "../../../../../api/factory-print-bridge-config.mjs";

function getConfiguration(host) {
  const res = {};
  res.setHeader = vi.fn();
  res.status = vi.fn(() => res);
  res.end = vi.fn();
  res.json = vi.fn();
  handler({ method: "GET", headers: { host } }, res);
  return res;
}

vi.mock("../../../../lib/supabase", () => ({ supabase: { rpc: vi.fn() } }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it("serves Production configuration only when enabled on the canonical host and project", () => {
  vi.stubEnv("VITE_SUPABASE_URL", "https://oyfobxdoyfuzsodogpgs.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "sb_publishable_test");
  vi.stubEnv("FACTORY_LABEL_PRINTING_ENABLED", "false");
  expect(getConfiguration("os.feedx.my").status).toHaveBeenCalledWith(404);

  vi.stubEnv("FACTORY_LABEL_PRINTING_ENABLED", "true");
  expect(getConfiguration("fnb-system-staging.vercel.app").status).toHaveBeenCalledWith(404);
  expect(getConfiguration("os.feedx.my").json).toHaveBeenCalledWith({ publishableKey: "sb_publishable_test" });

  vi.stubEnv("VITE_SUPABASE_URL", "https://ujkzdaaadnvcfayuldmh.supabase.co");
  expect(getConfiguration("os.feedx.my").status).toHaveBeenCalledWith(404);
  vi.stubEnv("VITE_SUPABASE_URL", "https://oyfobxdoyfuzsodogpgs.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "sb_secret_test");
  expect(getConfiguration("os.feedx.my").status).toHaveBeenCalledWith(404);
});

it("keeps the web feature off unless explicitly enabled against the Production project", async () => {
  async function serviceFor(url, enabled) {
    vi.resetModules();
    vi.stubEnv("VITE_SUPABASE_URL", url);
    vi.stubEnv("VITE_FACTORY_LABEL_PRINTING_ENABLED", enabled);
    return import("../../../../services/factoryLabelService.js");
  }
  const production = "https://oyfobxdoyfuzsodogpgs.supabase.co";
  const disabled = await serviceFor(production, "false");
  expect(disabled.factoryLabelsEnabled).toBe(false);
  await expect(disabled.factoryLabelService.management("printers")).rejects.toThrow("currently unavailable");
  expect((await serviceFor("https://ujkzdaaadnvcfayuldmh.supabase.co", "true")).factoryLabelsEnabled).toBe(false);
  expect((await serviceFor(production, "true")).factoryLabelsEnabled).toBe(true);
});
