export const PUBLIC_HOSTNAME = "feedx.my";
export const PRODUCT_FEEDBACK_PUBLIC_HOSTNAME = "feedback.feedx.my";
export const INTERVIEW_PUBLIC_HOSTNAME = "interview.feedx.my";
const PREPRODUCTION_INTERVIEW_HOSTNAME = String(import.meta.env?.VITE_INTERVIEW_WEB_APP_HOSTNAME || "fnb-system-staging.vercel.app").trim().toLowerCase();
export const CREW_WEB_APP_HOSTNAME = "crew.feedx.my";
export const CREW_WEB_APP_ORIGIN = `https://${CREW_WEB_APP_HOSTNAME}`;
export const PRODUCT_FEEDBACK_PUBLIC_ORIGIN = `https://${PRODUCT_FEEDBACK_PUBLIC_HOSTNAME}`;
export const PRODUCTION_OPERATIONS_HOSTNAMES = new Set(["os.feedx.my", "feedx-os.vercel.app"]);
const PREPRODUCTION_CREW_WEB_APP_HOSTNAME = String(import.meta.env?.VITE_CREW_WEB_APP_HOSTNAME || "").trim().toLowerCase();
const CREW_WEB_APP_HOSTNAMES = new Set([CREW_WEB_APP_HOSTNAME, PREPRODUCTION_CREW_WEB_APP_HOSTNAME].filter(Boolean));

function normalizeHostname(hostname) {
  return String(hostname || "").toLowerCase();
}

export function isPublicHostname(hostname) {
  return normalizeHostname(hostname) === PUBLIC_HOSTNAME;
}

export function isProductFeedbackPublicHostname(hostname) {
  return normalizeHostname(hostname) === PRODUCT_FEEDBACK_PUBLIC_HOSTNAME;
}

export function isInterviewPublicHostname(hostname) {
  return normalizeHostname(hostname) === INTERVIEW_PUBLIC_HOSTNAME;
}

export function isInterviewPublicSurface() {
  if (typeof window === "undefined") return false;
  return isInterviewPublicHostname(window.location.hostname)
    || (/^\/i\/[^/]+\/?$/.test(window.location.pathname) && [PREPRODUCTION_INTERVIEW_HOSTNAME, "localhost", "127.0.0.1"].includes(window.location.hostname));
}

export function isCrewWebAppHostname(hostname) {
  return CREW_WEB_APP_HOSTNAMES.has(normalizeHostname(hostname));
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

export function isCrewWebAppSurface() {
  return typeof window !== "undefined" && isCrewWebAppHostname(window.location.hostname);
}
