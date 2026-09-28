import { test, expect } from "@playwright/test";
import { assertActionReachable, assertMobileLayout } from "./layoutAssertions.mjs";

for (const theme of ["light", "dark"]) test(`submitted Cash Checkout stays read-only in ${theme} mode`, async ({ page }, info) => {
  await page.clock.setFixedTime(new Date("2026-08-31T04:00:00Z"));
  await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort("blockedbyclient"));
  await page.addInitScript(selectedTheme => localStorage.setItem("feedx.crew.theme", selectedTheme), theme);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(`/qa/crew/?language=${info.project.metadata.language}&cash=submitted#crew/me/cash-checkout`);
  await expect(page.locator("html")).toHaveAttribute("data-fixture-pending", "0");
  await expect(page.locator("html")).toHaveAttribute("data-crew-theme", theme);
  await expect(page.locator(".crew-cash-summary-status .crew-ui-status.is-warning")).toHaveCount(1);
  await assertMobileLayout(page);
  await page.locator(".crew-cash-today-summary > button.crew-mobile-primary").click();
  await expect(page.locator(".crew-cash-detail-status .crew-ui-status.is-warning")).toBeVisible();
  await expect(page.locator(".crew-cash-details .crew-mobile-detail-header button")).toHaveCount(0);
  await expect(page.locator(".crew-cash-details input, .crew-cash-details textarea")).toHaveCount(0);
  await assertMobileLayout(page);
  const done = page.locator(".crew-cash-submitted-actions button");
  await assertActionReachable(page, done);
  await done.click();
  await expect(page.locator(".crew-cash-summary-status .crew-ui-status.is-warning")).toHaveCount(1);
  expect(errors).toEqual([]);
  await expect(page.locator("html")).not.toHaveAttribute("data-fixture-refused", /.+/);
});
