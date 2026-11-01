// Transient metadata only. Successful reads are discarded; one redacted failure stays in tab memory.
export const RECIPE_DIAGNOSTIC_TTL_MS = 30 * 60 * 1000;
const LIMIT = 24;
const scopes = new Map();
const listeners = new Set();
const stages = new Set(["ID snapshot", "recipe_items snapshot", "Recipe headers", "Recipe items"]);
let latest = null;
let expiry;
let identity;
let failureSequence = 0, latestOrder = 0, clearedThrough = 0;
const now = () => performance.now();
const safely = (fn) => { try { return fn(); } catch { return undefined; } };
const emit = () => listeners.forEach(fn => safely(fn));
const id = () => globalThis.crypto?.randomUUID?.() || `recipe-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const number = value => Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : null;

export function clearRecipeFailure() {
  clearTimeout(expiry);
  latest = null;
  clearedThrough = failureSequence;
  emit();
}
export const subscribeRecipeFailure = fn => { listeners.add(fn); return () => listeners.delete(fn); };
export const getLatestRecipeFailure = () => latest;

// A private matching key, never exported. No identifiers, URLs or query strings enter reports.
export function recipeQueryKey(values) {
  let a = 2166136261, b = 5381;
  for (const char of values.join(",")) { a = Math.imul(a ^ char.charCodeAt(0), 16777619); b = Math.imul(b, 33) ^ char.charCodeAt(0); }
  return `${values.length}:${a >>> 0}:${b >>> 0}`;
}

function resourceTiming(url, start) {
  return safely(() => {
    const entry = performance.getEntriesByName(url, "resource").find(e => e.startTime >= start - 1);
    if (!entry) return { available: false, reason: "pending_or_not_exposed" };
    const detailed = entry.responseStart > 0;
    const result = { available: true, visibility: detailed ? "detailed" : "cross_origin_restricted", startTime: number(entry.startTime), duration: number(entry.duration), responseEnd: number(entry.responseEnd) };
    for (const key of ["fetchStart", "domainLookupStart", "domainLookupEnd", "connectStart", "secureConnectionStart", "connectEnd", "requestStart", "responseStart", "transferSize", "encodedBodySize", "decodedBodySize"]) result[key] = detailed ? number(entry[key]) : null;
    result.protocol = detailed && /^(h2|h3|http\/1\.1)$/.test(entry.nextHopProtocol) ? entry.nextHopProtocol : null;
    return result;
  }) || { available: false, reason: "unsupported" };
}

function snapshot(scope) {
  return {
    schemaVersion: 1, diagnosticId: scope.id, failedAt: scope.failedAt, capturedAt: new Date().toISOString(), reason: scope.reason,
    elapsedMs: scope.failedElapsed, aborted: scope.signal.aborted,
    abortElapsedMs: scope.abortAt ?? null, attempt: scope.attempt,
    counts: { ...scope.counts }, authSignals: scope.auth.map(e => ({ ...e })),
    droppedEntries: scope.dropped,
    requests: scope.queries.map(q => ({
      requestId: q.id, stage: q.stage, attempt: q.attempt, startedElapsedMs: number(q.start - scope.start), elapsedMs: number((q.end ?? now()) - q.start),
      settled: q.end !== undefined, expectedCount: q.expected, receivedCount: q.received,
      bodyCompletion: q.body, aborted: Boolean(q.cancelled),
      transports: q.transports.map(t => ({
        correlationId: t.id, existingTraceCorrelationId: t.traceId ?? null, serverCorrelationId: t.serverId, httpStatus: t.status, startedElapsedMs: number(t.start - scope.start),
        headersElapsedMs: t.headersAt === undefined ? null : number(t.headersAt - t.start),
        fetchState: t.state, responseBodyState: t.bodyState || "not_observed", decodedBodyBytes: t.bodyBytes ?? null, aborted: t.aborted, resourceTiming: resourceTiming(t.url, t.start),
      })),
    })),
    observability: "Server correlation headers and detailed Resource Timing may be hidden by CORS. Body completion means SDK query processing settled; no body is read by diagnostics.",
  };
}

function publish(scope) {
  if (scope.disposed || !scope.reason || scope.failureOrder <= clearedThrough) return;
  const remaining = Date.parse(scope.failedAt) + RECIPE_DIAGNOSTIC_TTL_MS - Date.now();
  if (remaining <= 0) return;
  // Late completions may enrich this incident, but can never overwrite a newer incident.
  if (latest && scope.failureOrder < latestOrder) return;
  latestOrder = scope.failureOrder;
  latest = snapshot(scope);
  clearTimeout(expiry);
  expiry = setTimeout(clearRecipeFailure, remaining);
  emit();
}

export function beginRecipeDiagnostic(signal) {
  if (!signal || typeof window === "undefined") return null;
  return safely(() => {
    if (scopes.size >= 4) { const oldest = scopes.values().next().value; oldest.disposed = true; scopes.delete(oldest.signal); }
    const scope = { id: id(), signal, start: now(), queries: [], auth: [], counts: {}, attempt: 0, dropped: 0, transports: 0 };
    scopes.set(signal, scope);
    const onAbort = () => { scope.abortAt = number(now() - scope.start); scope.queries.forEach(q => { if (q.end === undefined) q.cancelled = true; }); if (scopes.get(signal) === scope) scopes.delete(signal); safely(() => publish(scope)); };
    signal.addEventListener("abort", onAbort, { once: true });
    scope.nextAttempt = () => { scope.attempt++; scope.counts = { expectedRecipes: null, receivedRecipes: 0, expectedItems: null, receivedItems: 0 }; };
    scope.expect = (key, count) => { if (["expectedRecipes", "expectedItems"].includes(key)) scope.counts[key] = Number.isSafeInteger(count) && count >= 0 ? count : null; };
    scope.begin = (stage, meta = {}) => safely(() => {
      if (!stages.has(stage)) return;
      if (scope.queries.length >= LIMIT) { scope.queries.shift(); scope.dropped++; }
      const q = { id: id(), stage, attempt: scope.attempt, start: now(), expected: meta.expectedCount ?? null, received: null, body: "not_observed", match: meta.matchKey, transports: [] };
      scope.queries.push(q);
      return (result) => safely(() => {
        q.end = now(); q.received = Array.isArray(result?.data) ? result.data.length : null;
        q.body = result?.status > 0 ? "processed" : result?.error ? "failed_or_unobservable" : "not_observed";
        if (q.attempt === scope.attempt) {
          if (stage === "Recipe items") scope.counts.receivedItems += q.received || 0;
          if (stage === "Recipe headers") scope.counts.receivedRecipes += q.received || 0;
        }
        safely(() => publish(scope));
      });
    });
    scope.fail = reason => { if (!["timeout", "read_failure"].includes(reason)) return; if (!scope.reason) { scope.reason = reason; scope.failureOrder = ++failureSequence; scope.failedAt = new Date().toISOString(); scope.failedElapsed = number(now() - scope.start); } safely(() => publish(scope)); };
    scope.end = () => { if (scopes.get(signal) === scope) scopes.delete(signal); signal.removeEventListener("abort", onAbort); if (!scope.reason) scope.disposed = true; };
    return scope;
  }) || null;
}

export function recipeDiagnosticTimeout(signal) {
  safely(() => scopes.get(signal)?.fail("timeout"));
}

export function recordRecipeAuthEvent(event, userId) {
  safely(() => {
    if (event === "SIGNED_OUT" || (identity && userId && identity !== userId)) {
      scopes.forEach(s => { s.disposed = true; }); scopes.clear(); clearRecipeFailure();
    }
    identity = userId || null;
    if (["TOKEN_REFRESHED", "SIGNED_IN", "SIGNED_OUT", "INITIAL_SESSION"].includes(event)) authSignal(event);
  });
}
function authSignal(event, status = null) {
  scopes.forEach(s => { if (s.auth.length < 12) s.auth.push({ event, elapsedMs: number(now() - s.start), httpStatus: status }); });
}

function matchRequest(url, init) {
  if (init.method === "GET") {
    const stage = url.pathname === "/rest/v1/factory_product_recipes" ? "Recipe headers" : url.pathname === "/rest/v1/factory_product_recipe_items" ? "Recipe items" : null;
    const filter = url.searchParams.get("id");
    if (stage && filter?.startsWith("in.(")) return { stage, key: recipeQueryKey(filter.slice(4, -1).split(",")) };
  }
  if (init.method === "POST" && ["/rest/v1/rpc/factory_get_master_id_snapshot", "/rest/v1/rpc/factory_get_master_child_snapshot"].includes(url.pathname)) {
    const args = JSON.parse(init.body);
    if (["product_recipes", "active_product_recipes"].includes(args.p_entity)) return { stage: "ID snapshot", key: args.p_entity };
    if (args.p_entity === "recipe_items") return { stage: "recipe_items snapshot", key: recipeQueryKey(args.p_parent_ids) };
  }
  return null;
}

// Reuse the existing opt-in performance tracer's body/trace-ID observations when available.
export function noteRecipePerformanceStage(input, init, stage, clientRequestId, bytes) {
  if (!scopes.size) return;
  safely(() => {
    const scope = scopes.get(init?.signal);
    if (!scope) return;
    const match = matchRequest(new URL(typeof input === "string" ? input : input.url), init);
    const query = match && scope.queries.findLast(q => q.stage === match.stage && q.match === match.key && q.end === undefined);
    const transport = query?.transports.at(-1);
    if (!transport) return;
    if (/^ft-[0-9a-f-]{36}$/i.test(clientRequestId)) transport.traceId = clientRequestId;
    const state = { "body-start": "reading", "body-ready": "complete", "body-failed": "failed" }[stage];
    if (state) transport.bodyState = state;
    if (stage === "body-ready") transport.bodyBytes = number(bytes);
    publish(scope);
  });
}

// The original arguments, Response and errors pass through unchanged. Never clone/consume a body.
export function withRecipeDiagnostics(fetcher) {
  return (input, init) => {
    if (!scopes.size) return fetcher(input, init);
    const start = now();
    const url = safely(() => new URL(typeof input === "string" ? input : input.url || String(input)));
    const refresh = url?.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "refresh_token";
    if (refresh) safely(() => authSignal("refresh_request_started"));
    const scope = scopes.get(init?.signal);
    const match = scope && safely(() => matchRequest(url, init));
    const q = match && scope.queries.findLast(q => q.stage === match.stage && q.match === match.key && q.end === undefined);
    let t;
    safely(() => {
      if (!q || scope.transports >= LIMIT) { if (q) scope.dropped++; return; }
      scope.transports++;
      t = { id: id(), url: url.href, start, serverId: null, status: null, state: "awaiting_headers", aborted: false };
      q.transports.push(t);
    });
    const result = fetcher(input, init);
    if (!t && !refresh) return result;
    return result.then(response => {
      safely(() => {
        if (refresh) authSignal("refresh_response_received", response.status);
        if (t) {
          t.status = response.status; t.headersAt = now(); t.state = "headers_received";
          const correlation = response.headers.get("sb-request-id");
          if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(correlation)) t.serverId = correlation;
          publish(scope);
        }
      });
      return response;
    }, error => {
      safely(() => {
        if (refresh) authSignal("refresh_request_failed");
        if (t) { t.state = "fetch_rejected"; t.aborted = Boolean(init.signal?.aborted || error?.name === "AbortError"); publish(scope); }
      });
      throw error;
    });
  };
}
