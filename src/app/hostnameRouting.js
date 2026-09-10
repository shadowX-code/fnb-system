export const PUBLIC_HOSTNAME = "feedx.my";
export const PRODUCT_FEEDBACK_PUBLIC_HOSTNAME = "feedback.feedx.my";
export const PRODUCT_FEEDBACK_PUBLIC_ORIGIN = `https://${PRODUCT_FEEDBACK_PUBLIC_HOSTNAME}`;
export const PRODUCTION_OPERATIONS_HOSTNAMES = new Set(["os.feedx.my", "feedx-os.vercel.app"]);

function normalizeHostname(hostname) {
  return String(hostname || "").toLowerCase();
}

export function isPublicHostname(hostname) {
  return normalizeHostname(hostname) === PUBLIC_HOSTNAME;
}

export function isProductFeedbackPublicHostname(hostname) {
  return normalizeHostname(hostname) === PRODUCT_FEEDBACK_PUBLIC_HOSTNAME;
}

export function isProductionOperationsHostname(hostname) {
  return PRODUCTION_OPERATIONS_HOSTNAMES.has(normalizeHostname(hostname));
}

export function isPublicSurface() {
  return typeof window !== "undefined" && isPublicHostname(window.location.hostname);
}

export function isProductFeedbackPublicSurface() {
  return typeof window !== "undefined" && isProductFeedbackPublicHostname(window.location.hostname);
}
