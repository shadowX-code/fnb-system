const PUBLIC_HOSTNAME = "feedx.my";

export function isPublicHostname(hostname) {
  return String(hostname || "").toLowerCase() === PUBLIC_HOSTNAME;
}

export default function hostnameRoutingMiddleware(request) {
  const url = new URL(request.url);
  if (isPublicHostname(url.hostname) && (url.pathname !== "/" || url.search)) {
    return Response.redirect(new URL("/", url), 308);
  }
}
