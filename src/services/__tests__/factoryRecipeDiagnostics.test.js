import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { beginRecipeDiagnostic, clearRecipeFailure, getLatestRecipeFailure, recipeQueryKey, recordRecipeAuthEvent, RECIPE_DIAGNOSTIC_TTL_MS, withRecipeDiagnostics } from "../factoryRecipeDiagnostics.js";
import { factoryBootstrap } from "../../features/factory/utils/factoryBootstrap.js";

const privateId = "private-recipe-item";
const url = `https://private.example/rest/v1/factory_product_recipe_items?select=SECRET_CONTENT&id=in.(${privateId})`;
let controller, scope;
beforeEach(() => {
  clearRecipeFailure(); controller = new AbortController(); scope = beginRecipeDiagnostic(controller.signal); scope.nextAttempt();
});
afterEach(() => { controller.abort(); scope.end(); clearRecipeFailure(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const beginItem = () => scope.begin("Recipe items", { expectedCount: 1, matchKey: recipeQueryKey([privateId]) });

it("passes through original arguments/response and retains no successful report or body", async () => {
  const response = new Response("SECRET_BODY");
  const text = vi.spyOn(response, "text"); const clone = vi.spyOn(response, "clone");
  const fetcher = vi.fn().mockResolvedValue(response); const init = { method: "GET", signal: controller.signal, headers: { Authorization: "SECRET_TOKEN" } };
  const finish = beginItem();
  expect(await withRecipeDiagnostics(fetcher)(url, init)).toBe(response);
  finish({ data: [{ id: privateId }], status: 200 }); scope.end();
  expect(fetcher).toHaveBeenCalledExactlyOnceWith(url, init);
  expect(text).not.toHaveBeenCalled(); expect(clone).not.toHaveBeenCalled();
  expect(getLatestRecipeFailure()).toBeNull();
});

it("exports only failure metadata, server ID/status and browser timing, without content or URLs", async () => {
  const finish = beginItem(); scope.expect("expectedItems", 1);
  const serverId = "01a1947c-aa27-7617-96b9-065333d82e98";
  const response = new Response("SECRET_BODY", { status: 503, headers: { "sb-request-id": serverId } });
  const timing = { startTime: performance.now(), duration: 120, responseStart: 100, responseEnd: 120, requestStart: 1, nextHopProtocol: "h3", name: url, secret: "SECRET_TOKEN" };
  vi.spyOn(performance, "getEntriesByName").mockReturnValue([timing]);
  await withRecipeDiagnostics(vi.fn().mockResolvedValue(response))(url, { method: "GET", signal: controller.signal });
  finish({ data: null, status: 503, error: { message: "SECRET_ERROR" } }); scope.fail("read_failure"); scope.end();
  const report = getLatestRecipeFailure();
  expect(report.requests[0]).toMatchObject({ stage: "Recipe items", expectedCount: 1, receivedCount: null, bodyCompletion: "processed", transports: [{ httpStatus: 503, serverCorrelationId: serverId, fetchState: "headers_received", resourceTiming: { visibility: "detailed", protocol: "h3" } }] });
  expect(JSON.stringify(report)).not.toMatch(/SECRET|private-recipe|private.example|Authorization|select=|secret/);
});

it("captures the real deadline, partial counts and auth timing without changing cancellation", async () => {
  vi.useFakeTimers();
  scope.expect("expectedItems", 350);
  const finish = scope.begin("Recipe items", { expectedCount: 50 }); finish({ data: Array(50).fill({}), status: 200 });
  scope.begin("Recipe items", { expectedCount: 300 });
  const fetcher = withRecipeDiagnostics(vi.fn().mockResolvedValue(new Response("SECRET_REFRESH")));
  await fetcher("https://private.example/auth/v1/token?grant_type=refresh_token", { method: "POST", body: "SECRET_TOKEN" });
  recordRecipeAuthEvent("TOKEN_REFRESHED", "SECRET_USER");
  const load = factoryBootstrap(() => new Promise(() => {}), controller);
  const rejected = expect(load).rejects.toMatchObject({ name: "TimeoutError" });
  await vi.advanceTimersByTimeAsync(30000); await rejected;
  const report = getLatestRecipeFailure();
  expect(report).toMatchObject({ reason: "timeout", aborted: true, counts: { expectedItems: 350, receivedItems: 50 } });
  expect(report.requests[1]).toMatchObject({ aborted: true, settled: false, receivedCount: null });
  expect(report.authSignals.map(e => e.event)).toEqual(["refresh_request_started", "refresh_response_received", "TOKEN_REFRESHED"]);
  expect(JSON.stringify(report)).not.toContain("SECRET");
});

it("does not report ordinary route cancellations or unrelated requests", async () => {
  const response = new Response("ok"); const fetcher = vi.fn().mockResolvedValue(response);
  expect(await withRecipeDiagnostics(fetcher)("https://private.example/rest/v1/other", { method: "GET", signal: controller.signal })).toBe(response);
  beginItem(); controller.abort(); scope.end();
  expect(getLatestRecipeFailure()).toBeNull();
});

it("preserves fetch rejection identity and labels unavailable cross-origin observations", async () => {
  const finish = beginItem(); const error = new Error("SECRET_NETWORK_ERROR");
  await expect(withRecipeDiagnostics(vi.fn().mockRejectedValue(error))(url, { method: "GET", signal: controller.signal })).rejects.toBe(error);
  finish({ error, status: 0 }); scope.fail("read_failure");
  expect(getLatestRecipeFailure().requests[0].transports[0]).toMatchObject({ httpStatus: null, serverCorrelationId: null, fetchState: "fetch_rejected", resourceTiming: { available: false } });
  expect(JSON.stringify(getLatestRecipeFailure())).not.toContain("SECRET");
});

it("bounds records, keeps an incident after successful Retry and expires it", async () => {
  vi.useFakeTimers();
  for (let i = 0; i < 40; i++) beginItem()({ data: [], status: 200 });
  scope.fail("read_failure"); scope.end();
  const report = getLatestRecipeFailure(); expect(report.requests).toHaveLength(24); expect(report.droppedEntries).toBe(16);
  const retry = beginRecipeDiagnostic(new AbortController().signal); retry.nextAttempt(); retry.end();
  expect(getLatestRecipeFailure()).toBe(report);
  await vi.advanceTimersByTimeAsync(RECIPE_DIAGNOSTIC_TTL_MS);
  expect(getLatestRecipeFailure()).toBeNull();
});

it("prevents stale/cleared completions from overwriting newer incidents and clears identity changes", () => {
  const late = beginItem(); scope.fail("read_failure");
  const next = beginRecipeDiagnostic(new AbortController().signal); next.nextAttempt(); next.fail("read_failure");
  const newer = getLatestRecipeFailure(); late({ status: 200, data: [] });
  expect(getLatestRecipeFailure()).toBe(newer);
  clearRecipeFailure(); late({ status: 200, data: [] }); expect(getLatestRecipeFailure()).toBeNull();
  next.fail("read_failure"); next.end();
  recordRecipeAuthEvent("SIGNED_OUT"); expect(getLatestRecipeFailure()).toBeNull();
});

it("marks cross-origin timing phases unavailable rather than inventing zero timings", async () => {
  const finish = beginItem();
  vi.spyOn(performance, "getEntriesByName").mockReturnValue([{ startTime: performance.now(), duration: 20, responseStart: 0, responseEnd: 20, requestStart: 0, transferSize: 0 }]);
  await withRecipeDiagnostics(vi.fn().mockResolvedValue(new Response("", { status: 503 })))(url, { method: "GET", signal: controller.signal });
  finish({ error: {}, status: 503 }); scope.fail("read_failure"); scope.end();
  expect(getLatestRecipeFailure().requests[0].transports[0].resourceTiming).toMatchObject({ available: true, visibility: "cross_origin_restricted", duration: 20, requestStart: null, transferSize: null });
});
