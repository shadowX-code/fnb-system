import { PRODUCT_FEEDBACK_PUBLIC_ORIGIN, isProductionOperationsHostname, isProductFeedbackPublicHostname } from "../../app/hostnameRouting.js";

function normalizedOrigin(origin) {
  return String(origin || "").replace(/\/$/, "");
}

function locationOrigin(location) {
  if (location?.origin) return location.origin;
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}

function locationHostname(location, origin) {
  if (location?.hostname) return location.hostname;
  if (origin) return new URL(origin).hostname;
  return typeof window !== "undefined" ? window.location.hostname : "";
}

function encodeToken(value) {
  try {
    return encodeURIComponent(decodeURIComponent(value));
  } catch {
    return encodeURIComponent(value);
  }
}

export function productFeedbackPublicUrl(token, location = typeof window !== "undefined" ? window.location : undefined) {
  const value = String(token || "").trim();
  if (!value) return "";

  const origin = normalizedOrigin(locationOrigin(location));
  const hostname = locationHostname(location, origin);
  const encodedToken = encodeToken(value);
  if (isProductionOperationsHostname(hostname) || isProductFeedbackPublicHostname(hostname)) {
    return `${PRODUCT_FEEDBACK_PUBLIC_ORIGIN}/${encodedToken}`;
  }
  return `${origin}/feedback/product/${encodedToken}`;
}
