import { test, expect } from "@playwright/test";
import crewEnglish from "../../src/locales/en/crew.js";
import { assertNoPageHorizontalOverflow, captureScreenshot, crewCredentials, installBrowserErrorCapture, loginCrew } from "./stagingSmokeHelpers.mjs";

test("Crew can sign in and navigate without page-level mobile overflow", async ({ page, baseURL }, testInfo) => {
  const errors = installBrowserErrorCapture(page);
  await loginCrew(page, baseURL, crewCredentials());
  await expect(page.locator(".crew-v2-home")).toBeVisible();
  await assertNoPageHorizontalOverflow(page);
  await page.getByRole("navigation", { name: "Crew navigation" }).getByRole("button", { name: "Learn", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Learn" })).toBeVisible();
  await assertNoPageHorizontalOverflow(page);
  // Real account + real contracts only. These routes are read-only; fixture data
  // belongs to qa/crew and is never injected into Staging.
  for (const [route, heading] of [["me/attendance", crewEnglish.attendance.title], ["schedule", crewEnglish.schedule.title], ["tasks", crewEnglish.tasks.title], ["me/cash-checkout", crewEnglish.cash.title], ["growth", crewEnglish.growth.title], ["growth/performance", crewEnglish.performance.title], ["reward", crewEnglish.reward.title], ["me", crewEnglish.me.title]]) {
    await page.goto(`${baseURL}/#crew/${route}`);
    await expect(page.getByRole("heading", { level: 1, name: heading, exact: true })).toBeVisible();
    await assertNoPageHorizontalOverflow(page);
    await expect(page.getByText("Loading Smart Operations Workspace", { exact: false })).toHaveCount(0);
  }
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Me", exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "Reward", exact: true })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole("heading", { level: 1, name: "Me", exact: true })).toBeVisible();
  await errors.assertNoFatalErrors(testInfo);
  await captureScreenshot(page, testInfo, "crew-learn");
});
