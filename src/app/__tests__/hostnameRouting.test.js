import { expect, it } from "vitest";
import hostnameRoutingMiddleware, { isPublicHostname } from "../../../middleware.js";
import { isPublicHostname as isPublicClientHostname } from "../hostnameRouting.js";

it("recognizes only the canonical public hostname", () => {
  [isPublicHostname, isPublicClientHostname].forEach((recognizes) => {
    expect(recognizes("feedx.my")).toBe(true);
    expect(recognizes("FEEDX.MY")).toBe(true);
    expect(recognizes("os.feedx.my")).toBe(false);
    expect(recognizes("feedx-os.vercel.app")).toBe(false);
    expect(recognizes("fnb-system-staging.vercel.app")).toBe(false);
  });
});

it("redirects every non-root public request to the public root while preserving OS and staging routes", () => {
  const publicResponse = hostnameRoutingMiddleware(new Request("https://feedx.my/login?next=dashboard"));
  expect(publicResponse.status).toBe(308);
  expect(publicResponse.headers.get("location")).toBe("https://feedx.my/");

  expect(hostnameRoutingMiddleware(new Request("https://feedx.my/"))).toBeUndefined();
  expect(hostnameRoutingMiddleware(new Request("https://os.feedx.my/login"))).toBeUndefined();
  expect(hostnameRoutingMiddleware(new Request("https://os.feedx.my/admin/deep-link"))).toBeUndefined();
  expect(hostnameRoutingMiddleware(new Request("https://feedx-os.vercel.app/login"))).toBeUndefined();
  expect(hostnameRoutingMiddleware(new Request("https://fnb-system-staging.vercel.app/login"))).toBeUndefined();
});
