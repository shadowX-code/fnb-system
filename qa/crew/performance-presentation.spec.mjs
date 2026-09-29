import { test, expect } from "@playwright/test";
import { assertMobileLayout } from "./layoutAssertions.mjs";

test("Growth and My Performance keep partial scores clear at mobile widths and themes", async ({ page }, info) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.route("**/*", (route) => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort("blockedbyclient"));

  for (const theme of ["light", "dark"]) {
    await page.goto(`/qa/crew/?language=${info.project.metadata.language}&performance=partial#crew/growth`);
    await page.evaluate((value) => localStorage.setItem("feedx.crew.theme", value), theme);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-crew-theme", theme);
    await expect(page.locator("html")).toHaveAttribute("data-fixture-pending", "0");
    const growth = page.locator(".crew-growth-performance-hero");
    await expect(growth.locator("h2")).toBeVisible();
    await expect(growth.locator(".crew-growth-performance-score-readout strong")).toHaveText("29");
    await expect(growth.getByText(/points assessed|components scored|Pending:/i)).toHaveCount(0);
    await assertMobileLayout(page);
    if (info.project.name === "en-320" || info.project.name === "en-390") await page.screenshot({ path: `qa-artifacts/crew/performance-growth-${info.project.name}-${theme}.png` });

    await growth.getByRole("button").click();
    await expect(page.locator(".crew-performance-final-hero")).toBeVisible();
    await expect(page.locator(".crew-performance-final-total strong")).toHaveText("29");
    await expect(page.locator(".crew-performance-final-total span")).toHaveCount(0);
    await expect(page.locator(".crew-performance-final-breakdown-card button.is-pending")).toHaveCount(3);
    await expect(page.locator(".crew-performance-final-breakdown-card .crew-performance-final-meter")).toHaveCount(2);
    await expect(page.locator(".crew-performance-final-breakdown-head strong")).toHaveCount(0);
    await expect(page.getByText(/Weight \d+%|components scored|points assessed|Pending:/i)).toHaveCount(0);
    await assertMobileLayout(page);
    if (info.project.name === "en-320" || info.project.name === "en-390") await page.screenshot({ path: `qa-artifacts/crew/performance-detail-${info.project.name}-${theme}.png` });
  }

  expect(errors).toEqual([]);
  await expect(page.locator("html")).not.toHaveAttribute("data-fixture-refused", /.+/);
});
