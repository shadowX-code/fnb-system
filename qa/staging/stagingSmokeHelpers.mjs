import { expect } from "@playwright/test";

export const CANONICAL_STAGING_HOST = "fnb-system-staging.vercel.app";
const STAGING_URL_ENV = "FEEDX_STAGING_URL";

function requiredEnvironment(names) {
  const missing = names.filter((name) => !String(process.env[name] || "").trim());
  if (missing.length) throw new Error(`Missing required runtime credentials: ${missing.join(", ")}. Use Staging-only end-user QA accounts; do not add credentials to the repository.`);
  return Object.fromEntries(names.map((name) => [name, String(process.env[name]).trim()]));
}

export function assertCanonicalStagingUrl(value = process.env[STAGING_URL_ENV] || `https://${CANONICAL_STAGING_HOST}`) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${STAGING_URL_ENV} must be a valid canonical Staging URL.`); }
  if (url.protocol !== "https:" || url.hostname !== CANONICAL_STAGING_HOST || url.port || url.username || url.password) {
    throw new Error(`Refusing authenticated smoke QA target. Only https://${CANONICAL_STAGING_HOST} is permitted; Production and Preview targets are blocked.`);
  }
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function crewCredentials() {
  const values = requiredEnvironment(["FEEDX_STAGING_CREW_MOBILE", "FEEDX_STAGING_CREW_PASSCODE"]);
  if (!/^\d{4}$/.test(values.FEEDX_STAGING_CREW_PASSCODE)) throw new Error("FEEDX_STAGING_CREW_PASSCODE must be a four-digit Crew passcode.");
  return { mobile: values.FEEDX_STAGING_CREW_MOBILE, passcode: values.FEEDX_STAGING_CREW_PASSCODE };
}

export function adminCredentials() {
  const values = requiredEnvironment(["FEEDX_STAGING_ADMIN_EMAIL", "FEEDX_STAGING_ADMIN_PASSWORD"]);
  return { email: values.FEEDX_STAGING_ADMIN_EMAIL, password: values.FEEDX_STAGING_ADMIN_PASSWORD };
}

export function adminRoute() {
  const route = String(process.env.FEEDX_STAGING_ADMIN_ROUTE || "dashboard").trim().toLowerCase();
  if (!["dashboard", "reports"].includes(route)) throw new Error("FEEDX_STAGING_ADMIN_ROUTE must be 'dashboard' or 'reports'.");
  return route;
}

export function installBrowserErrorCapture(page) {
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  return {
    async assertNoFatalErrors(testInfo) {
      if (consoleErrors.length) await testInfo.attach("console-errors.txt", { body: consoleErrors.join("\n"), contentType: "text/plain" });
      expect(pageErrors, `Fatal browser errors:\n${pageErrors.join("\n")}`).toEqual([]);
    },
  };
}

export async function assertNoPageHorizontalOverflow(page) {
  const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(dimensions.scrollWidth, `Page overflows horizontally: ${dimensions.scrollWidth}px > ${dimensions.clientWidth}px`).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

export async function captureScreenshot(page, testInfo, name) {
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });
}

export async function loginCrew(page, baseURL, credentials) {
  baseURL = assertCanonicalStagingUrl(baseURL);
  await page.goto(`${baseURL}/#crew`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Mobile").fill(credentials.mobile);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  for (const digit of credentials.passcode) await page.getByRole("button", { name: digit, exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Crew navigation" })).toBeVisible();
}

export async function loginAdmin(page, baseURL, credentials) {
  baseURL = assertCanonicalStagingUrl(baseURL);
  await page.goto(`${baseURL}/#dashboard`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email").fill(credentials.email);
  await page.getByLabel("Password").fill(credentials.password);
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page.locator("aside")).toBeVisible();
}
