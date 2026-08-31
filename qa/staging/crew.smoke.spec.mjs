import { test, expect } from "@playwright/test";
import { assertNoPageHorizontalOverflow, captureScreenshot, crewCredentials, installBrowserErrorCapture, loginCrew } from "./stagingSmokeHelpers.mjs";

test("Crew can sign in and navigate without page-level mobile overflow", async ({ page, baseURL }, testInfo) => {
  const errors = installBrowserErrorCapture(page);
  await loginCrew(page, baseURL, crewCredentials());
  await expect(page.locator(".crew-v2-home")).toBeVisible();
  await assertNoPageHorizontalOverflow(page);
  await page.getByRole("navigation", { name: "Crew navigation" }).getByRole("button", { name: "Learn", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Learn" })).toBeVisible();
  await assertNoPageHorizontalOverflow(page);
  await errors.assertNoFatalErrors(testInfo);
  await captureScreenshot(page, testInfo, "crew-learn");
});
