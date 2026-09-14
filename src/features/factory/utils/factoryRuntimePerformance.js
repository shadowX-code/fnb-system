const MAX_ENTRIES = 240;
const SLOW_ROUTE_MS = 2000;
const SLOW_REQUEST_MS = 1200;

function isEnabled() {
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
  if (!isEnabled()) return null;
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

function record(entry) {
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
  if (!isEnabled()) return;
  activeRoute = String(route || "dashboard");
  activeRouteStartedAt = timestamp();
  record({ type: "route-start", route: activeRoute, at: Date.now() });
}

export function markFactoryRouteMeaningfulContent(route, source = "route-content") {
  if (!isEnabled()) return;
  const routeName = String(route || activeRoute || "dashboard");
  const durationMs = Math.round(timestamp() - activeRouteStartedAt);
  record({ type: "route-ready", route: routeName, source, durationMs, slow: durationMs > SLOW_ROUTE_MS, at: Date.now() });
}

export async function traceFactoryRequest(name, execute, { kind = "service" } = {}) {
  if (!isEnabled()) return execute();
  const startedAt = timestamp();
  const route = activeRoute || "unknown";
  const prior = [...(store()?.entries || [])].reverse().find((entry) => entry.type === "request" && entry.route === route && entry.name === name && entry.kind === kind);
  try {
    const result = await execute();
    const durationMs = Math.round(timestamp() - startedAt);
    const payloadBytes = estimatePayloadBytes(result);
    record({
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
    record({ type: "request", route, name, kind, durationMs, failed: true, slow: durationMs > SLOW_REQUEST_MS, duplicateCandidate: Boolean(prior && (Date.now() - prior.at) < 1000), at: Date.now() });
    throw error;
  }
}

export function instrumentFactoryService(service) {
  if (!isEnabled()) return service;
  return Object.fromEntries(Object.entries(service).map(([name, value]) => [name, typeof value === "function"
    ? (...args) => traceFactoryRequest(`factoryService.${name}`, () => value(...args))
    : value]));
}

export const factoryRuntimeThresholds = { slowRouteMs: SLOW_ROUTE_MS, slowRequestMs: SLOW_REQUEST_MS };
