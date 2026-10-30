import { afterEach, describe, expect, it, vi } from "vitest";
import { beginFactoryRouteTrace, factoryRuntimeThresholds, markFactoryRouteMeaningfulContent, traceFactoryRequest, factoryDiagnosticFetch } from "../factoryRuntimePerformance.js";

describe("Factory runtime performance tracing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete window.__FEEDX_FACTORY_RUNTIME_TRACE__;
    delete window.__feedxFactoryRuntime;
  });

  it("records route and request metadata without retaining a response payload", async () => {
    window.__FEEDX_FACTORY_RUNTIME_TRACE__ = true;
    beginFactoryRouteTrace("finished-goods");
    await traceFactoryRequest("factoryService.listFinishedGoods", async () => ({ rows: [{ id: "sku-1" }] }));
    markFactoryRouteMeaningfulContent("finished-goods");

    const entries = window.__feedxFactoryRuntime.snapshot();
    expect(entries.map((entry) => entry.type)).toEqual(["route-start", "request", "route-ready"]);
    expect(entries[1]).toMatchObject({ route: "finished-goods", name: "factoryService.listFinishedGoods", payloadBytes: expect.any(Number) });
    expect(entries[1]).not.toHaveProperty("payload");
    expect(factoryRuntimeThresholds.slowRouteMs).toBe(2000);
  });

  it("marks closely repeated requests as duplicate candidates", async () => {
    window.__FEEDX_FACTORY_RUNTIME_TRACE__ = true;
    beginFactoryRouteTrace("product-feedback");
    await traceFactoryRequest("factoryService.getProductFeedbackCampaign", async () => ({ id: "campaign-1" }));
    await traceFactoryRequest("factoryService.getProductFeedbackCampaign", async () => ({ id: "campaign-1" }));

    const requests = window.__feedxFactoryRuntime.snapshot().filter((entry) => entry.type === "request");
    expect(requests[1].duplicateCandidate).toBe(true);
  });
});

 it("traces headers and the actual body consumption without retaining secrets or parsing a clone", async () => {
   window.__FEEDX_FACTORY_RUNTIME_TRACE__ = true;
   const response = new Response('{"sensitive":"never logged"}', { headers: { "sb-request-id": "request-1" } });
   const fetch = vi.fn().mockResolvedValue(response);
   vi.stubGlobal("fetch", fetch);
   const actual = await factoryDiagnosticFetch("https://example.supabase.co/rest/v1/factory_production_sops?secret=hidden", { headers: { Authorization: "secret" } });
   expect(actual).toBe(response);
   expect(await actual.text()).toBe('{"sensitive":"never logged"}');
   const entries = window.__feedxFactoryRuntime.snapshot();
   expect(entries.map(e => e.stage)).toEqual(["fetch", "headers", "body-start", "body-ready"]);
   expect(entries.at(-1)).toMatchObject({ requestId: "request-1", payloadBytes: 28 });
   expect(JSON.stringify(entries)).not.toMatch(/never logged|secret|hidden|Authorization/);
 });

 it("pinpoints a response-body failure after successful headers and preserves rejection", async () => {
   window.__FEEDX_FACTORY_RUNTIME_TRACE__ = true;
   let fail;
   const response = new Response(new ReadableStream({ start(controller) { fail = () => controller.error(new Error("body failed")); } }));
   vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
   const received = await factoryDiagnosticFetch("https://example.supabase.co/rest/v1/factory_production_sops");
   const pending = received.text();
   expect(window.__feedxFactoryRuntime.snapshot().at(-1).stage).toBe("body-start");
   const rejected = expect(pending).rejects.toThrow("body failed");
   fail();
   await rejected;
   expect(window.__feedxFactoryRuntime.snapshot().at(-1).stage).toBe("body-failed");
 });

 it("records only safe startup timing metadata, without serializing session contents", async () => {
   window.__FEEDX_FACTORY_RUNTIME_TRACE__ = true;
   const session = { toJSON() { throw new Error("session must not be serialized"); } };
   expect(await traceFactoryRequest("startup.session", async () => session, { kind: "startup" })).toBe(session);
   expect(window.__feedxFactoryRuntime.snapshot().at(-1)).toMatchObject({ name: "startup.session", payloadBytes: null });
 });
