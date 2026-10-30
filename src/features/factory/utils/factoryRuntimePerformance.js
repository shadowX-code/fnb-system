const MAX_ENTRIES = 240;
const SLOW_ROUTE_MS = 2000;
const SLOW_REQUEST_MS = 1200;

export function isFactoryTraceEnabled() {
  if (typeof window === "undefined") return false;
  if (window.__FEEDX_FACTORY_RUNTIME_TRACE__ === true) return true;
  if (import.meta.env.DEV || import.meta.env.VITE_FACTORY_RUNTIME_TRACE === "true") return true;
  return /(^|\.)fnb-system-staging\.vercel\.app$/i.test(window.location.hostname);
}

function estimatePayloadBytes(value) {
  if (value === undefined) return null;
  try { return new Blob([JSON.stringify(value)]).size; } catch { return null; }
}

function store() {
  if (!isFactoryTraceEnabled()) return null;
  if (!window.__feedxFactoryRuntime) {
    const entries = [];
    window.__feedxFactoryRuntime = {
      entries,
      clear: () => { entries.splice(0, entries.length); },
      snapshot: () => entries.map((entry) => ({ ...entry })),
    };
  }
  return window.__feedxFactoryRuntime;
}

export function recordFactoryPerformance(entry) {
  const runtime = store();
  if (!runtime) return;
  runtime.entries.push(entry);
  if (runtime.entries.length > MAX_ENTRIES) runtime.entries.splice(0, runtime.entries.length - MAX_ENTRIES);
  window.dispatchEvent(new CustomEvent("feedx:factory-runtime", { detail: entry }));
}

function timestamp() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

let activeRoute = "";
let activeRouteStartedAt = 0;

export function beginFactoryRouteTrace(route) {
  if (!isFactoryTraceEnabled()) return;
  activeRoute = String(route || "dashboard");
  activeRouteStartedAt = timestamp();
  recordFactoryPerformance({ type: "route-start", route: activeRoute, at: Date.now() });
}

export function markFactoryRouteMeaningfulContent(route, source = "route-content") {
  if (!isFactoryTraceEnabled()) return;
  const routeName = String(route || activeRoute || "dashboard");
  const durationMs = Math.round(timestamp() - activeRouteStartedAt);
  recordFactoryPerformance({ type: "route-ready", route: routeName, source, durationMs, slow: durationMs > SLOW_ROUTE_MS, at: Date.now() });
}

export async function traceFactoryRequest(name, execute, { kind = "service" } = {}) {
  if (!isFactoryTraceEnabled()) return execute();
  const startedAt = timestamp();
  const route = activeRoute || "unknown";
  const prior = [...(store()?.entries || [])].reverse().find((entry) => entry.type === "request" && entry.route === route && entry.name === name && entry.kind === kind);
  try {
    const result = await execute();
    const durationMs = Math.round(timestamp() - startedAt);
    const payloadBytes = estimatePayloadBytes(result);
    recordFactoryPerformance({
      type: "request",
      route,
      name,
      kind,
      durationMs,
      payloadBytes,
      slow: durationMs > SLOW_REQUEST_MS,
      duplicateCandidate: Boolean(prior && (Date.now() - prior.at) < 1000),
      at: Date.now(),
    });
    return result;
  } catch (error) {
    const durationMs = Math.round(timestamp() - startedAt);
    recordFactoryPerformance({ type: "request", route, name, kind, durationMs, failed: true, slow: durationMs > SLOW_REQUEST_MS, duplicateCandidate: Boolean(prior && (Date.now() - prior.at) < 1000), at: Date.now() });
    throw error;
  }
}

export function instrumentFactoryService(service) {
  if (!isFactoryTraceEnabled()) return service;
  return Object.fromEntries(Object.entries(service).map(([name, value]) => [name, typeof value === "function"
    ? (...args) => traceFactoryRequest(`factoryService.${name}`, () => value(...args))
    : value]));
}

export const factoryRuntimeThresholds = { slowRouteMs: SLOW_ROUTE_MS, slowRequestMs: SLOW_REQUEST_MS };

// Opt-in diagnostic display reads only metadata; no response contents or query parameters.
export function factoryPerformanceSnapshot() { return store()?.snapshot() || []; }

export function traceFactoryCommit(id, phase, actualDuration) {
  if (isFactoryTraceEnabled()) recordFactoryPerformance({ type: "react-commit", route: activeRoute, phase, durationMs: Math.round(actualDuration * 100) / 100, at: Date.now() });
}

let transportSequence = 0;
const pendingTransports = new Set();
export async function factoryDiagnosticFetch(input, init) {
  const execute = () => fetch(input, init);
  if (!isFactoryTraceEnabled()) return execute();
  const url = new URL(typeof input === "string" ? input : input.url);
  const endpoint = url.pathname.match(/^\/rest\/v1\/(?:rpc\/)?(factory_[a-z0-9_]+)$/)?.[1];
  if (!endpoint) return execute();
  const id = ++transportSequence;
  const started = timestamp();
  const route = activeRoute;
  const add = (stage, extra = {}) => recordFactoryPerformance({ type: "transport", id, route, endpoint, stage, elapsedMs: Math.round(timestamp() - started), at: Date.now(), ...extra });
  const fingerprint = `${init?.method || "GET"}:${url.href}:${init?.body || ""}`;
  const duplicateInFlight = pendingTransports.has(fingerprint);
  pendingTransports.add(fingerprint);
  add("fetch", { duplicateInFlight });
  try {
    const response = await execute();
    const requestId = response.headers.get("sb-request-id") || response.headers.get("x-request-id");
    add("headers", { status: response.status, requestId });
    // PostgREST consumes text then parses JSON internally. Never clone/parse a second copy.
    const text = response.text.bind(response);
    response.text = async () => {
      try {
        add("body-start");
        const body = await text();
        add("body-ready", { payloadBytes: new Blob([body]).size, requestId });
        pendingTransports.delete(fingerprint);
        return body;
      } catch (error) { pendingTransports.delete(fingerprint); add("body-failed", { cancelled: init?.signal?.aborted || false }); throw error; }
    };
    return response;
  } catch (error) { pendingTransports.delete(fingerprint); add("fetch-failed", { cancelled: init?.signal?.aborted || false }); throw error; }
}
