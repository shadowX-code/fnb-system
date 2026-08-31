import { test, expect } from "@playwright/test";
import { adminCredentials, adminRoute, captureScreenshot, installBrowserErrorCapture, loginAdmin } from "./stagingSmokeHelpers.mjs";

test("Admin can sign in and open a read-only canonical route", async ({ page, baseURL }, testInfo) => {
  const errors = installBrowserErrorCapture(page);
  const route = adminRoute();
  await loginAdmin(page, baseURL, adminCredentials());
  await page.goto(`${baseURL}/#${route}`, { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(new RegExp(`#${route}$`));
  await expect(page.locator("aside")).toBeVisible();
  await expect(page.locator("main")).toBeVisible();
  await errors.assertNoFatalErrors(testInfo);
  await captureScreenshot(page, testInfo, `admin-${route}`);
});
