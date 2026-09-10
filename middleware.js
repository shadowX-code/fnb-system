import {
  PRODUCT_FEEDBACK_PUBLIC_ORIGIN,
  isProductFeedbackPublicHostname,
  isProductionOperationsHostname,
  isPublicHostname,
} from "./src/app/hostnameRouting.js";

const PUBLIC_ASSET_PATHS = ["/assets/", "/design-homepage/", "/holographic-ring.webp", "/favicon.ico"];

export { isPublicHostname };

function legacyProductFeedbackToken(pathname) {
  return pathname.match(/^\/feedback\/product\/([^/]+)\/?$/)?.[1] || "";
}

function encodeToken(value) {
  try {
    return encodeURIComponent(decodeURIComponent(value));
  } catch {
    return encodeURIComponent(value);
  }
}

export default function hostnameRoutingMiddleware(request) {
  const url = new URL(request.url);
  const isPublicAsset = PUBLIC_ASSET_PATHS.some((path) => url.pathname === path || url.pathname.startsWith(path));
  const legacyToken = legacyProductFeedbackToken(url.pathname);
  if (isProductionOperationsHostname(url.hostname) && legacyToken) {
    const destination = new URL(`/${encodeToken(legacyToken)}`, PRODUCT_FEEDBACK_PUBLIC_ORIGIN);
    destination.search = url.search;
    return Response.redirect(destination, 308);
  }
  if (isPublicHostname(url.hostname) && !isPublicAsset && (url.pathname !== "/" || url.search)) {
    return Response.redirect(new URL("/", url), 308);
  }
  // The public Feedback hostname reaches the SPA, whose host gate renders only
  // the anonymous token-bound surface.
  if (isProductFeedbackPublicHostname(url.hostname)) return undefined;
}
