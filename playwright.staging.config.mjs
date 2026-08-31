import { defineConfig } from "@playwright/test";
import { assertCanonicalStagingUrl } from "./qa/staging/stagingSmokeHelpers.mjs";

const baseURL = assertCanonicalStagingUrl();

export default defineConfig({
  testDir: "./qa/staging",
  testMatch: "**/*.spec.mjs",
  outputDir: "qa-artifacts/staging/test-results",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: [["line"], ["html", { open: "never", outputFolder: "qa-artifacts/staging/report" }]],
  use: {
    baseURL,
    // Login actions and network traces can contain credentials or session tokens.
    trace: "off",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    { name: "harness", testMatch: "**/*.contract.spec.mjs" },
    { name: "crew-320", testMatch: "**/crew.smoke.spec.mjs", use: { viewport: { width: 320, height: 740 }, deviceScaleFactor: 1 } },
    { name: "crew-360", testMatch: "**/crew.smoke.spec.mjs", use: { viewport: { width: 360, height: 800 }, deviceScaleFactor: 1 } },
    { name: "crew-390", testMatch: "**/crew.smoke.spec.mjs", use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 } },
    { name: "crew-430", testMatch: "**/crew.smoke.spec.mjs", use: { viewport: { width: 430, height: 932 }, deviceScaleFactor: 1 } },
    { name: "admin-desktop", testMatch: "**/admin.smoke.spec.mjs", use: { viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 } },
  ],
});
