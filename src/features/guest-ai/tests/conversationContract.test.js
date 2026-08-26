import { describe, expect, it } from "vitest";
import { ConversationRequestError, estimateCostUsd, validateConversationRequest } from "../../../../supabase/functions/guest-ai-reply/contract.ts";
import { OpenAiConversationProvider } from "../../../../supabase/functions/guest-ai-reply/provider.ts";
import { GUEST_AI_CONVERSATION_INSTRUCTIONS, MAX_SHORT_CONTEXT_TURNS } from "../../../../supabase/functions/guest-ai-reply/instructions.ts";

describe("Guest AI server-side conversation contract", () => {
  it.each([
    "Welcome! How can I help you today?",
    "你好！很高兴见到你，请问有什么可以帮您？",
    "Hai! Apa yang boleh saya bantu hari ini?",
    "Hi，欢迎来到餐厅！有什么我可以帮忙吗？",
  ])("accepts bounded English, Chinese, Bahasa Malaysia, and mixed-language replies", async (replyText) => {
    const provider = new OpenAiConversationProvider(async () => new Response(JSON.stringify({ output: [{ type: "message", content: [{ type: "output_text", text: replyText }] }], usage: { input_tokens: 20, output_tokens: 12 } }), { status: 200 }));
    await expect(provider.reply({ transcript: "hello", apiKey: "server-only", model: "gpt-4o-mini", timeoutMs: 20_000, maxOutputTokens: 120, instructions: "bounded" })).resolves.toMatchObject({ replyText });
  });

  it("rejects empty, oversized, and malformed requests before a provider call", () => {
    expect(() => validateConversationRequest({ turn_id: "turn-1", transcript: "" })).toThrow(ConversationRequestError);
    expect(() => validateConversationRequest({ turn_id: "turn-1", transcript: "x".repeat(1_201) })).toThrow("limit");
    expect(() => validateConversationRequest(null)).toThrow("object");
    expect(() => validateConversationRequest({ turn_id: "turn-1", transcript: "hello", context: [{}] })).toThrow("context");
    expect(() => validateConversationRequest({ turn_id: "turn-1", transcript: "hello", context: Array.from({ length: 7 }, () => ({ role: "user", content: "hello" })) })).toThrow("context");
    expect(MAX_SHORT_CONTEXT_TURNS).toBe(3);
  });

  it("maps provider rejection, timeout, and oversized reply safely", async () => {
    const rejected = new OpenAiConversationProvider(async () => new Response(JSON.stringify({ error: { message: "blocked" } }), { status: 400 }));
    await expect(rejected.reply({ transcript: "hello", apiKey: "server-only", model: "gpt-4o-mini", timeoutMs: 20_000, maxOutputTokens: 120, instructions: "bounded" })).rejects.toMatchObject({ code: "provider_rejected" });
    const timedOut = new OpenAiConversationProvider(async () => { throw new DOMException("aborted", "AbortError"); });
    await expect(timedOut.reply({ transcript: "hello", apiKey: "server-only", model: "gpt-4o-mini", timeoutMs: 20_000, maxOutputTokens: 120, instructions: "bounded" })).rejects.toMatchObject({ code: "provider_timeout" });
    const oversized = new OpenAiConversationProvider(async () => new Response(JSON.stringify({ output_text: "x".repeat(501) }), { status: 200 }));
    await expect(oversized.reply({ transcript: "hello", apiKey: "server-only", model: "gpt-4o-mini", timeoutMs: 20_000, maxOutputTokens: 120, instructions: "bounded" })).rejects.toMatchObject({ code: "reply_oversized" });
  });

  it("passes the raw STT transcript through unchanged; it never performs an STT correction step", async () => {
    let body;
    const rawTranscript = "今天很 busy hor, ramai orang tak?";
    const provider = new OpenAiConversationProvider(async (_url, init) => { body = JSON.parse(init.body); return new Response(JSON.stringify({ output_text: "I only received the transcript." }), { status: 200 }); });
    await provider.reply({ transcript: rawTranscript, context: [{ role: "user", content: "Earlier words" }, { role: "assistant", content: "Earlier reply" }], apiKey: "server-only", model: "gpt-4o-mini", timeoutMs: 20_000, maxOutputTokens: 120, instructions: "bounded" });
    expect(body.input).toContain(rawTranscript);
    expect(body.input).toContain("Earlier words");
    expect(body.input).toContain("verbatim STT");
  });

  it("derives cost only from actual provider usage and configured token rates", () => {
    expect(estimateCostUsd({ input_tokens: 1000, output_tokens: 500 }, 0.15, 0.60)).toBeCloseTo(0.00045);
    expect(estimateCostUsd({ input_tokens: 1000 }, 0.15, 0.60)).toBeNull();
  });

  it("keeps restaurant facts outside the bounded system behavior", () => {
    expect(GUEST_AI_CONVERSATION_INSTRUCTIONS).toContain("Never invent or imply menus, dishes, prices, promotions, opening hours, memberships, availability, or outlet facts");
    expect(GUEST_AI_CONVERSATION_INSTRUCTIONS).toContain("Follow the guest's language");
  });
});
