import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), rpc: vi.fn() }));

vi.mock("../../lib/supabase", () => ({ supabase: { functions: { invoke: mocks.invoke }, rpc: mocks.rpc } }));
vi.mock("../auditLogService", () => ({ auditLogService: {} }));
vi.mock("../../utils/imageUpload.js", () => ({ uploadOptimizedImage: vi.fn() }));

import { factoryService } from "../factoryService.js";

const edgeFailure = (code, message, retryable) => ({
  context: { clone: () => ({ json: async () => ({ error: { code, message, retryable, request_id: "request-1" } }) }) },
});

beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.rpc.mockReset();
});

describe("Factory Product Feedback translation service", () => {
  it("returns a normal translation response through one Edge Function invocation", async () => {
    mocks.invoke.mockResolvedValue({ data: { translations: [{ id: "question:label", language: "zh", text: "问题" }] }, error: null });
    await expect(factoryService.translateProductFeedbackContent({ sourceLanguage: "en", units: [{ id: "question:label", source: "Question", targets: ["zh"] }] })).resolves.toEqual([{ id: "question:label", language: "zh", text: "问题" }]);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["provider_timeout", "Translation timed out. Please retry.", true],
    ["provider_rate_limited", "Translation is busy right now. Please retry in a moment.", true],
    ["provider_unavailable", "Translation is temporarily unavailable. Please retry.", true],
    ["provider_response_invalid", "Translation returned an invalid response. Please retry.", true],
  ])("preserves structured safe %s failures", async (code, message, retryable) => {
    mocks.invoke.mockResolvedValue({ data: null, error: edgeFailure(code, message, retryable) });
    await expect(factoryService.translateProductFeedbackContent({ sourceLanguage: "en", units: [{ id: "question:label", source: "Question", targets: ["zh"] }] })).rejects.toMatchObject({ message, code, retryable, requestId: "request-1" });
  });

  it("never exposes an unstructured relay error as Admin copy", async () => {
    mocks.invoke.mockResolvedValue({ data: { error: "Edge Function returned a non-2xx status code" }, error: null });
    await expect(factoryService.translateProductFeedbackContent({ sourceLanguage: "en", units: [{ id: "question:label", source: "Question", targets: ["zh"] }] })).rejects.toMatchObject({
      code: "translation_unavailable",
      message: "AI translation is temporarily unavailable. Please retry.",
      retryable: true,
    });
  });

  it("reads the structured payload from a real response context", async () => {
    mocks.invoke.mockResolvedValue({ data: null, error: { context: new Response(JSON.stringify({ error: { code: "provider_timeout", message: "Translation timed out. Please retry.", retryable: true, request_id: "request-response" } }), { status: 504, headers: { "Content-Type": "application/json" } }) } });
    await expect(factoryService.translateProductFeedbackContent({ sourceLanguage: "en", units: [{ id: "question:label", source: "Question", targets: ["zh"] }] })).rejects.toMatchObject({ message: "Translation timed out. Please retry.", code: "provider_timeout", retryable: true, requestId: "request-response" });
  });
});
