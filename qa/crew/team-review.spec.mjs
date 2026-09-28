import { test, expect } from "@playwright/test";
import { assertMobileLayout, assertActionReachable } from "./layoutAssertions.mjs";

test.beforeEach(async ({ page }, info) => {
  await page.clock.setFixedTime(new Date("2026-08-31T04:00:00Z"));
  await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort("blockedbyclient"));
  await page.goto(`/qa/crew/?language=${info.project.metadata.language}#crew/home`);
  await expect(page.locator("html")).toHaveAttribute("data-fixture-pending", "0");
});

test("Team Review introduction, compact card and form fit mobile widths", async ({ page }) => {
  await expect(page.getByRole("dialog")).toBeVisible();
  await assertMobileLayout(page);
  const dialog = page.getByRole("dialog");
  await assertActionReachable(page, dialog.getByRole("button", { name: /later|稍后|nanti/i }));
  await dialog.getByRole("button", { name: /later|稍后|nanti/i }).click();
  const entry = page.locator(".crew-team-home-entry");
  await expect(entry).toBeVisible();
  await assertMobileLayout(page);
  await entry.click();
  await expect(page.locator(".crew-team-list button")).toHaveCount(1);
  await assertMobileLayout(page);
  await page.locator(".crew-team-list button").click();
  await expect(page.locator(".crew-team-form fieldset")).toHaveCount(4);
  await expect(page.getByRole("button", { name: /submit|提交|hantar/i })).toBeDisabled();
  await assertMobileLayout(page);
  expect(await page.locator(".crew-team-form").evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
});
