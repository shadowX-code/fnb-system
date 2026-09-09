const PUBLIC_HOSTNAME = "feedx.my";
const PUBLIC_ASSET_PATHS = ["/assets/", "/design-homepage/", "/holographic-ring.webp", "/favicon.ico"];

export function isPublicHostname(hostname) {
  return String(hostname || "").toLowerCase() === PUBLIC_HOSTNAME;
}

export default function hostnameRoutingMiddleware(request) {
  const url = new URL(request.url);
  const isPublicAsset = PUBLIC_ASSET_PATHS.some((path) => url.pathname === path || url.pathname.startsWith(path));
  if (isPublicHostname(url.hostname) && !isPublicAsset && (url.pathname !== "/" || url.search)) {
    return Response.redirect(new URL("/", url), 308);
  }
}
