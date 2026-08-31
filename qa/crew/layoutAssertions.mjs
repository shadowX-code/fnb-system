import { expect } from "@playwright/test";

// Geometry/interaction contracts, not screenshot snapshots or exact DOM trees.
export async function assertMobileLayout(page) {
  const violations = await page.evaluate(() => {
    const issues = [];
    const width = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > width + 1) issues.push("page horizontal overflow");
    const scrollingAncestor = element => {
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const css = getComputedStyle(parent);
        if (["auto", "scroll"].includes(css.overflowX) && parent.scrollWidth > parent.clientWidth + 1) return true;
      }
      return false;
    };
    // A modal intentionally obscures the page and may freeze it at an earlier
    // scroll position. Inspect the active surface, not its inert underlay.
    const dialogs = [...document.querySelectorAll('[role="dialog"]')];
    const surface = dialogs.at(-1) || document;
    for (const element of surface.querySelectorAll("h1,h2,h3,button,input,select,textarea,.crew-ui-status")) {
      if (!element.getClientRects().length) continue;
      const rect = element.getBoundingClientRect();
      const css = getComputedStyle(element);
      if (css.visibility === "hidden" || scrollingAncestor(element)) continue;
      const label = `${element.tagName}: ${(element.getAttribute("aria-label") || element.textContent || element.getAttribute("name") || "").slice(0,70)}`;
      if (rect.left < -1 || rect.right > width + 1) issues.push(`outside viewport ${label}`);
      // Intentional text ellipsis/line clamp and horizontal category carousels
      // are approved patterns, unlike clipped controls or hidden actions.
      const clamp = parseInt(css.webkitLineClamp, 10) > 0 || css.textOverflow === "ellipsis";
      // Icon-only help triggers intentionally extend their invisible touch area
      // using a pseudo-element. That is not clipped text.
      if (!clamp && element.textContent.trim() && !["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName) && element.scrollWidth > element.clientWidth + 2) issues.push(`content clipped ${label}`);
    }
    return issues;
  });
  expect(violations).toEqual([]);
}

export async function assertActionReachable(page, action) {
  await action.evaluate(element => element.scrollIntoView({ block: "center", behavior: "instant" }));
  await expect(action).toBeVisible();
  // Wait for the real shared surface entrance/resize animation to settle, using
  // Playwright actionability without invoking the business action.
  await action.click({ trial: true });
  const geometry = await action.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const nav = document.querySelector(".crew-v2-nav");
    const navRect = nav?.getBoundingClientRect();
    const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    const target = document.elementFromPoint(x, y);
    return { covered: !target || !element.contains(target), overlap: Boolean(navRect && navRect.height && !element.closest("[role=dialog]") && rect.bottom > navRect.top + 1 && rect.top < navRect.bottom), bottom: rect.bottom, viewport: innerHeight };
  });
  expect(geometry.covered, "action must receive pointer input, not an overlay/nav").toBe(false);
  expect(geometry.overlap, "action must not overlap bottom navigation").toBe(false);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewport + 1);
}

export async function assertInputSizing(page) {
  const small = await page.locator("input:not([type=hidden]), textarea, select").evaluateAll(elements => elements.filter(element => element.getClientRects().length && !element.disabled && parseFloat(getComputedStyle(element).fontSize) < 16).map(element => ({ field: element.getAttribute("aria-label") || element.getAttribute("placeholder") || element.type, size: getComputedStyle(element).fontSize })));
  expect(small, "editable mobile fields must be >=16px to avoid iOS focus zoom").toEqual([]);
}
