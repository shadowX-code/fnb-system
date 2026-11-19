// Keep a retry identity across modal close/reload; no credentials are stored here.
export function pendingRequestKey(actorId, jobId) {
  return `feedx.label-request.v1:${actorId}:${jobId}`;
}
export function readPendingRequest(key) {
  try {
    return JSON.parse(sessionStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}
export function writePendingRequest(key, request) {
  if (request) sessionStorage.setItem(key, JSON.stringify(request));
  else sessionStorage.removeItem(key);
}
