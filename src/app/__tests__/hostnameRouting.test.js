import { expect, it } from "vitest";
import hostnameRoutingMiddleware, { isPublicHostname } from "../../../middleware.js";
import { isProductFeedbackPublicHostname, isPublicHostname as isPublicClientHostname } from "../hostnameRouting.js";

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

it("redirects every non-root public request to the public root while preserving OS and staging routes", () => {
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

it("redirects only legacy Production Product Feedback routes to the dedicated public hostname", () => {
  const response = hostnameRoutingMiddleware(new Request("https://os.feedx.my/feedback/product/opaque-token?utm_source=qr"));
  expect(response.status).toBe(308);
  expect(response.headers.get("location")).toBe("https://feedback.feedx.my/opaque-token?utm_source=qr");

  expect(hostnameRoutingMiddleware(new Request("https://feedx-os.vercel.app/feedback/product/opaque-token"))?.headers.get("location")).toBe("https://feedback.feedx.my/opaque-token");
  expect(hostnameRoutingMiddleware(new Request("https://fnb-system-staging.vercel.app/feedback/product/opaque-token"))).toBeUndefined();
  expect(hostnameRoutingMiddleware(new Request("https://feedback.feedx.my/opaque-token"))).toBeUndefined();
  expect(hostnameRoutingMiddleware(new Request("https://feedback.feedx.my/#factory_dashboard"))).toBeUndefined();
});
