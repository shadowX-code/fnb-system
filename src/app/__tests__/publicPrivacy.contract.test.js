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


it("limits the public rewrite to feedx.my and preserves other hosts' SPA entry", () => {
  const privacy = config.routes.find(route => route.src === "/privacy/?");
  expect(privacy.has).toEqual([{ type: "host", value: "feedx.my" }]);
  const alias = config.routes.find(route => route.src === "/privacy.html");
  expect(alias.missing).toEqual([{ type: "host", value: "feedx.my" }]);
  expect(alias.dest).toBe("/index.html");
});

it("publishes a bounded version without implying Production Marketing or completed legal decisions", () => {
  expect(document.querySelector('meta[name="robots"]')).toBeNull();
  expect(document.querySelector('aside.review')).toBeNull();
  expect(document.body.textContent).toContain("Version 1.0");
  expect(document.body.textContent).toContain("Effective upon first public publication");
  expect(document.body.textContent).toContain("currently verified on the Staging environment");
  expect(document.body.textContent).toContain("No Data Protection Officer has been formally appointed");
  expect(document.body.textContent).toContain("do not promise automatic deletion after a fixed number of days");
  expect(document.body.textContent).toContain("Berkuat kuasa apabila pertama kali diterbitkan kepada umum");
});
