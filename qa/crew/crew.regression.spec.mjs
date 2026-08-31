import { test, expect } from "@playwright/test";
import { createInstance } from "i18next";
import en from "../../src/locales/en/crew.js";
import zh from "../../src/locales/zh-CN/crew.js";
import ms from "../../src/locales/ms/crew.js";
import { assertMobileLayout, assertActionReachable, assertInputSizing } from "./layoutAssertions.mjs";

let t;
test.beforeEach(async ({ page }, info) => {
  const i18n = createInstance();
  await i18n.init({ lng: info.project.metadata.language, fallbackLng: "en", resources: { en: { translation: en }, "zh-CN": { translation: zh }, ms: { translation: ms } } });
  t = i18n.t.bind(i18n);
  await page.clock.setFixedTime(new Date("2026-08-31T04:00:00Z"));
  // Fail closed: a renderer test must never reach Staging, Production or a real
  // service. Unknown fixture operations also throw rather than simulate success.
  await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort("blockedbyclient"));
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.addInitScript(() => { document.addEventListener("DOMContentLoaded", () => { document.documentElement.dataset.qaRenderer = "local-only"; }); });
  page.__crewErrors = errors;
});
test.afterEach(async ({ page }) => {
  expect(page.__crewErrors).toEqual([]);
  await expect(page.locator("html")).not.toHaveAttribute("data-fixture-refused", /.+/);
});

async function open(page, info, route, extra = "") {
  await page.goto(`/qa/crew/?language=${info.project.metadata.language}${extra}#${route}`);
  await expect(page.locator("html")).toHaveAttribute("lang", info.project.metadata.language);
  await expect(page.locator("html")).toHaveAttribute("data-fixture-pending", "0");
  await expect(page.getByText("Loading Smart Operations Workspace", { exact: false })).toHaveCount(0);
}

const screens = [
  ["crew/home", null], ["crew/me/attendance", "attendance.title"], ["crew/schedule", "home.mySchedule"],
  ["crew/tasks", "tasks.title"], ["crew/me/cash-checkout", "cash.title"], ["crew/learn", "learn.title"],
  ["crew/growth", "growth.title"], ["crew/growth/performance", "performance.title"], ["crew/reward", "reward.title"],
  ["crew/me", "me.title"], ["crew/me/leave", "leave.title"],
];
// Exercise the real lazy route renderers and stylesheet requests, not a second
// styled fixture. The production graph guard separately verifies emitted CSS.
for (const [route, title, css, selector, property, expected] of [
  ["crew/me/cash-checkout", "cash.title", "CrewCashCheckoutMobile", ".crew-cash-summary-page", "min-height", "100%"],
  ["crew/growth", "growth.title", "CrewGrowthMobile", ".crew-growth-performance-hero", "display", "grid"],
  ["crew/reward", "reward.title", "CrewRewardMobile", ".crew-reward-final", "display", "grid"],
  ["crew/me/leave", "leave.title", "CrewLeaveMobile", ".crew-leave-page", "min-height", "100%"],
]) test(`lazy CSS first/repeated entry and refresh: ${route}`, async ({ page }, info) => {
  const requestedStyles = [];
  page.on("request", request => { if (request.url().includes(".css")) requestedStyles.push(request.url()); });
  await open(page, info, "crew/home");
  await expect(page.locator(".crew-v2-home")).toBeVisible();
  expect(requestedStyles.some(url => url.includes(`/${css}.css`))).toBe(false);
  // Address-bar hash navigation uses the canonical hash listener/history, not a
  // test-only screen switch or invocation of component event handlers.
  await page.evaluate(hash => { window.location.hash = hash; }, route);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(t(title));
  await expect(page.locator(selector)).toHaveCSS(property, expected);
  expect(requestedStyles.some(url => url.includes(`/${css}.css`))).toBe(true);
  if (css === "CrewGrowthMobile") expect(requestedStyles.some(url => url.includes("/CrewPerformanceComponentModal.css"))).toBe(true);
  const styles = () => page.locator(selector).evaluate(element => {
    const computed = getComputedStyle(element);
    return Object.fromEntries(["display", "color", "font-size", "padding", "gap", "border-radius", "min-height", "background-image", "grid-template-columns"].map(key => [key, computed.getPropertyValue(key)]));
  });
  const first = await styles();
  await assertMobileLayout(page);
  await page.goBack();
  await expect(page.locator(".crew-v2-home")).toBeVisible();
  await page.goForward();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(t(title));
  expect(await styles()).toEqual(first);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(t(title));
  expect(await styles()).toEqual(first);
  await assertMobileLayout(page);
});

for (const [route, title] of screens) test(`long-copy layout: ${route}`, async ({ page }, info) => {
  await open(page, info, route);
  if (title) await expect(page.getByRole("heading", { level: 1 })).toHaveText(t(title));
  else await expect(page.locator(".crew-v2-home")).toBeVisible();
  await expect(page.getByRole("navigation", { name: t("nav.label") })).toBeVisible();
  await assertMobileLayout(page);
  const action = page.locator("main button:not(nav button)").last();
  if (await action.count()) await assertActionReachable(page, action);
  await assertInputSizing(page);
});

test("Home tasks share one dense list without truncating title or status", async ({ page }, info) => {
  await open(page, info, "crew/home");
  const rows = page.locator(".crew-home-task");
  await expect(rows.first()).toBeVisible();
  await expect(page.locator(".crew-home-tasks .crew-home-list")).toHaveCSS("border-top-width", "0px");
  await expect(page.locator(".crew-home-tasks .crew-home-list")).toHaveCSS("border-radius", "0px");
  await expect(page.locator(".crew-home-tasks .crew-home-list")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  for (const row of await rows.all()) {
    await expect(row).toHaveCSS("border-radius", "0px");
    await expect(row).toHaveCSS("box-shadow", "none");
    await expect(row).toHaveCSS("border-top-width", "0px");
    await expect(row).toHaveCSS("border-left-width", "0px");
    await expect(row.locator("strong")).toHaveCSS("font-size", "13px");
    await expect(row.locator("strong")).toHaveCSS("font-weight", "600");
    await expect(row.locator("strong")).toHaveCSS("-webkit-line-clamp", "none");
    if (info.project.metadata.language === "en") {
      expect((await row.locator(".crew-ui-status").boundingBox()).height).toBeLessThanOrEqual(24);
    }
    expect(await row.evaluate(element => {
      const title = element.querySelector("strong");
      const status = element.querySelector(".crew-ui-status");
      return title.getBoundingClientRect().right <= status.getBoundingClientRect().left &&
        title.scrollHeight <= title.clientHeight + 1 && status.scrollWidth <= status.clientWidth + 1;
    })).toBe(true);
    await assertActionReachable(page, row);
  }
  await expect(rows.last()).toHaveCSS("border-bottom-width", "0px");
  if (await rows.count() > 1) await expect(rows.first()).toHaveCSS("border-bottom-width", "1px");
  await assertMobileLayout(page);
  await page.getByRole("navigation").getByRole("button", { name: t("nav.learn"), exact: true }).click();
  const sopTitle = page.locator(".crew-list-dense-primary").first();
  await expect(sopTitle).toHaveCSS("font-size", "13px");
  await expect(sopTitle).toHaveCSS("font-weight", "600");
});

test("Clock exception, SOP status, and Cash session headers preserve their mobile layout boundaries", async ({ page }, info) => {
  await open(page, info, "crew/home");
  const exception = page.locator(".crew-home-location-exception");
  const orb = page.locator(".crew-home-clock-action");
  await expect(orb).toBeVisible();
  if (await exception.count()) {
    expect(await exception.evaluate(element => element.closest(".crew-home-attendance-copy") !== null && element.closest(".crew-home-clock-zone") === null)).toBe(true);
    expect(await exception.evaluate((element, selector) => {
      const exceptionRect = element.getBoundingClientRect();
      const orbRect = document.querySelector(selector).getBoundingClientRect();
      return exceptionRect.right <= orbRect.left || exceptionRect.left >= orbRect.right || exceptionRect.bottom <= orbRect.top || exceptionRect.top >= orbRect.bottom;
    }, ".crew-home-clock-action")).toBe(true);
  }

  await page.getByRole("navigation").getByRole("button", { name: t("nav.learn"), exact: true }).click();
  const sopRow = page.locator(".crew-learn-final-sop").first();
  await expect(sopRow).toBeVisible();
  expect(await sopRow.evaluate(element => {
    const badge = element.querySelector(".crew-learn-final-ack .crew-ui-status").getBoundingClientRect();
    const chevron = element.querySelector(".crew-learn-final-chevron").getBoundingClientRect();
    return chevron.left - badge.right >= 12;
  })).toBe(true);

  await page.evaluate(() => { window.location.hash = "crew/me/cash-checkout"; });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(t("cash.title"));
  await expect(page.getByText(t("cash.todayCheckout"), { exact: true })).toHaveCount(0);
  await expect(page.locator(".crew-cash-today-summary > header small")).toBeVisible();
  await expect(page.locator(".crew-cash-summary-status")).toBeVisible();
  await assertMobileLayout(page);
});

test("shared navigation keeps five line icons and stable active geometry", async ({ page }, info) => {
  await open(page, info, "crew/home");
  const nav = page.getByRole("navigation", { name: t("nav.label") });
  await expect(nav).toBeVisible();
  const initial = await nav.boundingBox();
  for (const destination of ["home", "learn", "reward", "growth", "me", "home"]) {
    const button = nav.getByRole("button", { name: t(`nav.${destination}`), exact: true });
    await button.click();
    await expect(page).toHaveURL(new RegExp(`#crew/${destination}$`));
    await expect(button).toHaveAttribute("aria-current", "page");
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(button).toHaveCSS("color", "rgb(22, 75, 80)");
    await expect(button.locator("span")).toHaveCSS("color", "rgb(22, 75, 80)");
    await expect(button).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    for (const icon of await nav.locator("svg").all()) {
      await expect(icon).toHaveCSS("width", "24px");
      await expect(icon).toHaveCSS("height", "24px");
      await expect(icon).toHaveCSS("stroke-width", "1.75px");
      await expect(icon).toHaveAttribute("aria-hidden", "true");
    }
    await expect(nav.locator('button:not([aria-current])').first()).toHaveCSS("color", "rgb(80, 105, 110)");
    expect(await nav.boundingBox()).toEqual(initial);
    await assertMobileLayout(page);
  }
});

test("language selector stays compact, complete, and tappable across Crew locales", async ({ page }, info) => {
  await open(page, info, "crew/me");
  await page.getByRole("button", { name: t("me.settings"), exact: true }).click();
  await page.getByRole("button", { name: t("me.language"), exact: true }).click();
  const selector = page.locator(".crew-language-segmented");
  await expect(selector).toBeVisible();
  await expect(selector).toHaveCSS("background-color", "rgb(229, 246, 245)");
  await expect(selector.locator("button")).toHaveCount(3);
  await expect(selector.locator("svg")).toHaveCount(0);
  for (const language of ["English", "简体中文", "Bahasa Melayu"]) {
    const option = selector.getByRole("button", { name: language, exact: true });
    await option.click();
    await expect(option).toHaveAttribute("aria-pressed", "true");
    await expect(option).toHaveClass(/is-active/);
    await expect(option).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(option).toHaveCSS("color", "rgb(22, 75, 80)");
    expect(await option.evaluate(element => {
      const size = parseFloat(getComputedStyle(element).fontSize);
      return size >= 11 && size <= 14;
    })).toBe(true);
    expect(await option.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  }
  await assertMobileLayout(page);
});

test("Profile identity preserves hierarchy and only renders canonical employment type", async ({ page }, info) => {
  await open(page, info, "crew/me");
  await page.getByRole("button", { name: t("me.profile"), exact: true }).click();
  const identity = page.locator(".crew-me-profile-summary");
  await expect(identity).toBeVisible();
  await expect(identity.locator("h2")).toBeVisible();
  await expect(identity.locator(".crew-me-profile-position")).toBeVisible();
  await expect(identity.locator(".crew-me-profile-outlet svg")).toHaveCount(1);
  await expect(identity.locator(".crew-ui-status.is-mint")).toHaveText("Full-Time");
  await expect(identity.locator(".crew-ui-status.is-success")).toHaveCount(0);
  expect(await identity.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await assertMobileLayout(page);
});

test("long onboarding journey/module/lesson copy", async ({ page }, info) => {
  await open(page, info, "crew/learn");
  await page.locator(".crew-learn-final-onboarding").click();
  await expect(page.locator(".crew-learning-module")).toHaveCount(3);
  await assertMobileLayout(page);
  await assertActionReachable(page, page.locator(".crew-learning-module button").last());
});

for (const kind of ["sheet", "help", "modal"]) test(`shared ${kind}: long title, portal, focus, backdrop and nested lock`, async ({ page }, info) => {
  await page.goto(`/qa/crew/?language=${info.project.metadata.language}&surfaces=1`);
  const trigger = page.getByRole("button", { name: kind, exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveCount(1);
  expect(await dialog.evaluate(element => !document.getElementById("root").contains(element))).toBe(true);
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
  await assertMobileLayout(page);
  const close = dialog.getByRole("button", { name: t("common.close"), exact: true });
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button").last()).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await dialog.getByRole("button", { name: "last action", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(dialog.getByRole("button", { name: "last action", exact: true })).toBeFocused();
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page.locator("body")).not.toHaveCSS("position", "fixed");
  await trigger.click();
  // Outside the surface but within the real backdrop (no DOM-handler invocation).
  await page.mouse.click(1, 1);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await trigger.click();
  await expect(dialog).toHaveCSS("animation-name", "none");
});

test("Performance detail delegates to one shared sheet", async ({ page }, info) => {
  await open(page, info, "crew/growth/performance");
  const trigger = page.getByRole("button", { name: t("performance.viewEvidence", { label: t("performance.components.service") }), exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveCount(1);
  await expect(dialog).toHaveClass(/crew-ui-bottom-sheet/);
  await expect(dialog.locator(".crew-performance-component-modal")).toHaveCSS("display", "grid");
  await expect(dialog.locator(".crew-performance-component-modal")).toHaveCSS("gap", "18px");
  await assertMobileLayout(page);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("hash compatibility, refresh and real browser history", async ({ page }, info) => {
  await open(page, info, "crew");
  await expect(page).toHaveURL(/#crew\/home$/);
  await page.getByRole("navigation").getByRole("button", { name: t("nav.reward"), exact: true }).click();
  await expect(page).toHaveURL(/#crew\/reward$/);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(t("reward.title"));
  await page.getByRole("navigation").getByRole("button", { name: t("nav.learn"), exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(t("learn.title"));
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(t("reward.title"));
  await page.goForward();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(t("learn.title"));
  await open(page, info, "crew/not-a-route");
  await expect(page).toHaveURL(/#crew\/home$/);
});

test("Cash Count input and short-viewport actions", async ({ page }, info) => {
  await open(page, info, "crew/me/cash-checkout");
  await page.getByRole("button", { name: t("cash.startCheckout"), exact: true }).click();
  await expect(page.getByLabel(t("cash.posExpected"))).toBeVisible();
  await assertInputSizing(page);
  await page.getByLabel(t("cash.posExpected")).fill("1234.50");
  await page.setViewportSize({ width: info.project.use.viewport.width, height: 420 });
  await assertMobileLayout(page);
  await assertActionReachable(page, page.getByRole("button", { name: t("cash.next"), exact: true }));
});

test("Leave date/reason input remains reachable above nav", async ({ page }, info) => {
  await open(page, info, "crew/me/leave");
  await page.getByRole("button", { name: t("leave.apply"), exact: true }).click();
  await page.getByRole("button", { name: t("common.continue"), exact: true }).click();
  await page.getByRole("button", { name: t("leave.startDate"), exact: true }).click();
  await expect(page.getByRole("dialog", { name: t("leave.startDate"), exact: true })).toBeVisible();
  await assertMobileLayout(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await assertInputSizing(page);
  await page.getByRole("button", { name: t("common.continue"), exact: true }).click();
  await page.getByRole("textbox").fill("QA note — long explanation for this test only.");
  await assertInputSizing(page);
  await page.setViewportSize({ width: info.project.use.viewport.width, height: 420 });
  await assertMobileLayout(page);
  await assertActionReachable(page, page.getByRole("button", { name: t("common.continue"), exact: true }));
});

test("Clock exception selection replaces the sheet; reason and action fit a short viewport", async ({ page, context }, info) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 0, longitude: 0 });
  await open(page, info, "crew/home");
  await page.getByRole("button", { name: t("home.clockIn"), exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await page.getByRole("button", { name: t("attendance.selectReason"), exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await page.getByRole("option", { name: t("attendanceReasons.other"), exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await page.getByPlaceholder(t("attendance.briefReason")).fill("QA — GPS reception is unavailable inside the restaurant.");
  await assertInputSizing(page);
  await page.setViewportSize({ width: info.project.use.viewport.width, height: 420 });
  await assertMobileLayout(page);
  await assertActionReachable(page, page.getByRole("button", { name: t("common.confirm"), exact: true }));
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("Task issue form uses the canonical sheet without submitting an operation", async ({ page }, info) => {
  await open(page, info, "crew/tasks");
  await page.locator(".crew-ops-task").first().click();
  await page.getByRole("button", { name: t("tasks.no"), exact: true }).click();
  await page.getByRole("button", { name: t("tasks.reportIssue"), exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await page.getByPlaceholder(t("tasks.explainIssue")).fill("QA — long operational explanation, no mutation is submitted.");
  await assertInputSizing(page);
  await page.setViewportSize({ width: info.project.use.viewport.width, height: 420 });
  await assertMobileLayout(page);
  await assertActionReachable(page, page.getByRole("button", { name: t("tasks.submitException"), exact: true }));
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
