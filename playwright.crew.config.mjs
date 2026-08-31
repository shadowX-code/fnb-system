import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./qa/crew", testMatch: "**/*.spec.mjs", fullyParallel: true, workers: 2,
  forbidOnly: true, retries: 0, timeout: 45_000,
  outputDir: "qa-artifacts/crew/test-results",
  reporter: [["line"], ["json", { outputFile: "qa-artifacts/crew/results.json" }]],
  use: { baseURL: "http://127.0.0.1:4177", browserName: "chromium", timezoneId: "Asia/Kuala_Lumpur", deviceScaleFactor: 1, trace: "off", video: "off", screenshot: "only-on-failure" },
  webServer: { command: "node node_modules/vite/bin/vite.js --config qa/crew/vite.config.mjs", url: "http://127.0.0.1:4177/qa/crew/", reuseExistingServer: false },
  projects: [320, 360, 390, 430].flatMap(width => ["en", "zh-CN", "ms"].map(language => ({
    name: `${language}-${width}`, metadata: { language }, use: { viewport: { width, height: 844 } },
  }))),
});
