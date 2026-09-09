export const PUBLIC_HOSTNAME = "feedx.my";

export function isPublicHostname(hostname) {
  return String(hostname || "").toLowerCase() === PUBLIC_HOSTNAME;
}

export function isPublicSurface() {
  return typeof window !== "undefined" && isPublicHostname(window.location.hostname);
}
