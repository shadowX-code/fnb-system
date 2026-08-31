import { test, expect } from "@playwright/test";
import { assertCanonicalStagingUrl } from "./stagingSmokeHelpers.mjs";

test("rejects noncanonical targets without reflecting credential-bearing input", () => {
  for (const url of ["http://fnb-system-staging.vercel.app", "https://fnb-system-staging.vercel.app:8443", "https://fnb-system-staging.vercel.app.evil.test", "https://qa:private-test-value@fnb-system-staging.vercel.app", "not a URL"]) {
    expect(() => assertCanonicalStagingUrl(url)).toThrow();
    try { assertCanonicalStagingUrl(url); } catch (error) { expect(error.message).not.toContain("private-test-value"); }
  }
  expect(assertCanonicalStagingUrl("https://fnb-system-staging.vercel.app/?qa=test#crew/home")).toBe("https://fnb-system-staging.vercel.app");
});

test("accepts only the canonical Staging hostname and can launch the configured browser", async ({ page }) => {
  expect(assertCanonicalStagingUrl("https://fnb-system-staging.vercel.app/#crew")).toBe("https://fnb-system-staging.vercel.app");
  expect(() => assertCanonicalStagingUrl("https://fnb-system.vercel.app")).toThrow(/Production and Preview targets are blocked/);
  expect(() => assertCanonicalStagingUrl("https://preview.example.test")).toThrow(/Only https:\/\/fnb-system-staging\.vercel\.app is permitted/);
  await page.setContent("<main>Staging smoke harness</main>");
  await expect(page.getByRole("main")).toHaveText("Staging smoke harness");
});
