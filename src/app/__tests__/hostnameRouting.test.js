import { expect, it } from "vitest";
import hostnameRoutingMiddleware, { config, isPublicHostname } from "../../../middleware.js";
import { isCrewWebAppHostname, isInterviewPublicHostname, isProductFeedbackPublicHostname, isPublicHostname as isPublicClientHostname } from "../hostnameRouting.js";

const matches = (url) => new RegExp(`^${config.matcher}$`).test(new URL(url).pathname);

it("bypasses only existing no-op asset exemptions on every host", () => {
  const hosts = ["feedx.my", "os.feedx.my", "feedx-os.vercel.app", "interview.feedx.my", "crew.feedx.my", "feedback.feedx.my", "fnb-system-staging.vercel.app"];
  const paths = ["/assets/index-abcdefgh.js", "/assets/chunk.css?v=1", "/assets/missing.js", "/design-homepage/logo.png", "/favicon.ico?x=1", "/holographic-ring.webp"];
  for (const host of hosts) for (const path of paths) {
    const url = `https://${host}${path}`;
    expect(matches(url), url).toBe(false);
    expect(hostnameRoutingMiddleware(new Request(url)), url).toBeUndefined();
  }
});

it("retains document, API, public denial and encoded-lookalike routing", () => {
  for (const path of ["/", "/login", "/system/operations-network", "/api/marketing-creator-inspect", "/privacy", "/privacy.html", "/feedback/product/token", "/assets", "/assets-other/app.js", "/faviconXico", "/favicon.ico/extra", "/holographic-ring.webp.exe", "/private/file.js", "/%61ssets/app.js"]) {
    expect(matches(`https://fnb-system-staging.vercel.app${path}`), path).toBe(true);
  }
  const publicUrl = "https://feedx.my/private/file.js";
  expect(matches(publicUrl)).toBe(true);
  expect(hostnameRoutingMiddleware(new Request(publicUrl))?.status).toBe(308);
  for (const path of ["/api/marketing-creator-inspect", "/people/recruitment", "/private/file.js", "/i/invalid"]) {
    const url = `https://interview.feedx.my${path}`;
    expect(matches(url), url).toBe(true);
    expect(hostnameRoutingMiddleware(new Request(url))?.status, url).toBe(404);
  }
});

it("recognizes only the canonical public hostname", () => {
  [isPublicHostname, isPublicClientHostname].forEach((recognizes) => {
    expect(recognizes("feedx.my")).toBe(true);
    expect(recognizes("FEEDX.MY")).toBe(true);
    expect(recognizes("os.feedx.my")).toBe(false);
    expect(recognizes("feedx-os.vercel.app")).toBe(false);
    expect(recognizes("fnb-system-staging.vercel.app")).toBe(false);
  });
});

it("recognizes the dedicated Product Feedback hostname without treating it as the corporate homepage", () => {
  expect(isProductFeedbackPublicHostname("feedback.feedx.my")).toBe(true);
  expect(isProductFeedbackPublicHostname("FEEDBACK.FEEDX.MY")).toBe(true);
  expect(isProductFeedbackPublicHostname("feedx.my")).toBe(false);
  expect(isProductFeedbackPublicHostname("fnb-system-staging.vercel.app")).toBe(false);
});

it("recognizes the dedicated Crew web app host without changing Admin host ownership", () => {
  expect(isCrewWebAppHostname("crew.feedx.my")).toBe(true);
  expect(isCrewWebAppHostname("CREW.FEEDX.MY")).toBe(true);
  expect(isCrewWebAppHostname("os.feedx.my")).toBe(false);
  expect(isCrewWebAppHostname("fnb-system-staging.vercel.app")).toBe(false);
});

it("isolates candidate interview paths on the dedicated host", () => {
  const token = "a".repeat(64);
  expect(isInterviewPublicHostname("interview.feedx.my")).toBe(true);
  expect(isInterviewPublicHostname("os.feedx.my")).toBe(false);
  expect(hostnameRoutingMiddleware(new Request(`https://interview.feedx.my/i/${token}`))).toBeUndefined();
  expect(hostnameRoutingMiddleware(new Request("https://interview.feedx.my/people/recruitment"))?.status).toBe(404);
  expect(hostnameRoutingMiddleware(new Request("https://interview.feedx.my/i/an-id"))?.status).toBe(404);
});

it("redirects unowned public paths to the public root while preserving OS and staging routes", () => {
  const publicResponse = hostnameRoutingMiddleware(new Request("https://feedx.my/login?next=dashboard"));
  expect(publicResponse.status).toBe(308);
  expect(publicResponse.headers.get("location")).toBe("https://feedx.my/");

  expect(hostnameRoutingMiddleware(new Request("https://feedx.my/"))).toBeUndefined();
  expect(hostnameRoutingMiddleware(new Request("https://feedx.my/assets/index.js"))).toBeUndefined();
  expect(hostnameRoutingMiddleware(new Request("https://feedx.my/design-homepage/logo.png"))).toBeUndefined();
  expect(hostnameRoutingMiddleware(new Request("https://feedx.my/holographic-ring.webp"))).toBeUndefined();
  expect(hostnameRoutingMiddleware(new Request("https://os.feedx.my/login"))).toBeUndefined();
  expect(hostnameRoutingMiddleware(new Request("https://os.feedx.my/admin/deep-link"))).toBeUndefined();
  expect(hostnameRoutingMiddleware(new Request("https://feedx-os.vercel.app/login"))).toBeUndefined();
  expect(hostnameRoutingMiddleware(new Request("https://fnb-system-staging.vercel.app/login"))).toBeUndefined();
});

it("permits only the exact public privacy path and canonicalizes its static-file alias", () => {
  expect(hostnameRoutingMiddleware(new Request("https://feedx.my/privacy"))).toBeUndefined();
  expect(hostnameRoutingMiddleware(new Request("https://feedx.my/privacy/?lang=ms"))).toBeUndefined();
  expect(hostnameRoutingMiddleware(new Request("https://feedx.my/privacy/admin"))?.headers.get("location")).toBe("https://feedx.my/");
  expect(hostnameRoutingMiddleware(new Request("https://feedx.my/privacy.html"))?.headers.get("location")).toBe("https://feedx.my/privacy");
});

it("redirects only legacy Production Product Feedback routes to the dedicated public hostname", () => {
  const response = hostnameRoutingMiddleware(new Request("https://os.feedx.my/feedback/product/opaque-token?utm_source=qr"));
  expect(response.status).toBe(308);
  expect(response.headers.get("location")).toBe("https://feedback.feedx.my/opaque-token?utm_source=qr");

  expect(hostnameRoutingMiddleware(new Request("https://feedx-os.vercel.app/feedback/product/opaque-token"))?.headers.get("location")).toBe("https://feedback.feedx.my/opaque-token");
  expect(hostnameRoutingMiddleware(new Request("https://fnb-system-staging.vercel.app/feedback/product/opaque-token"))).toBeUndefined();
  expect(hostnameRoutingMiddleware(new Request("https://feedback.feedx.my/opaque-token"))).toBeUndefined();
  expect(hostnameRoutingMiddleware(new Request("https://feedback.feedx.my/#factory_dashboard"))).toBeUndefined();
});
