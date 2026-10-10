import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { expect, it } from "vitest";

const config = JSON.parse(readFileSync(resolve(process.cwd(), "vercel.json"), "utf8"));
const html = readFileSync(resolve(process.cwd(), "public/privacy.html"), "utf8");
const document = new JSDOM(html).window.document;

it("serves the complete static policy before the SPA fallback without authentication or scripts", () => {
  const privacyIndex = config.routes.findIndex(route => route.src === "/privacy/?" && route.dest === "/privacy.html");
  const spaIndex = config.routes.findIndex(route => route.dest === "/index.html");
  expect(privacyIndex).toBeGreaterThanOrEqual(0);
  expect(privacyIndex).toBeLessThan(spaIndex);
  expect(document.querySelector("script, iframe, form")).toBeNull();
  expect(document.title).toBe("Privacy Policy | FeedX FNB OS");
  for (const language of ["english", "bahasa-malaysia"]) {
    const section = document.getElementById(language);
    expect(section.querySelectorAll("h3")).toHaveLength(11);
    expect(section.textContent).toContain("The Y Advisory Sdn Bhd");
    expect(section.textContent).toContain("1259068-W");
    expect(section.querySelector('a[href="mailto:theyadvisory@gmail.com"]')).toBeTruthy();
  }
  for (const link of document.querySelectorAll('a[href^="#"]')) {
    expect(document.getElementById(link.getAttribute("href").slice(1))).toBeTruthy();
  }
});


it("preserves the released policy and explicit public/Staging host boundary", () => {
  expect(document.body.textContent).toContain("Version 1.0");
  expect(document.body.textContent).toContain("currently verified on the Staging environment");
  expect(document.querySelector('meta[name="robots"]')).toBeNull();
  const route = config.routes.find(route => route.src === "/privacy/?");
  const host = new RegExp(`^${route.has[0].value}$`);
  expect(host.test("feedx.my")).toBe(true);
  expect(host.test("fnb-system-staging.vercel.app")).toBe(true);
  expect(host.test("os.feedx.my")).toBe(false);
  expect(host.test("crew.feedx.my")).toBe(false);
  expect(config.routes.find(route => route.src === "/privacy.html").dest).toBe("/index.html");
});
