import { describe, expect, it } from "vitest";
import { fitsPlaybackBudget, MAX_PLAYBACK_PCM_BYTES, MAX_PROVIDER_PCM_BYTES, validatePcmOutput, validateTtsRequest } from "../../../../supabase/functions/guest-ai-tts/contract.ts";
import { OpenAiReplyCompressor } from "../../../../supabase/functions/guest-ai-tts/compressor.ts";
import { OpenAiTtsProvider } from "../../../../supabase/functions/guest-ai-tts/provider.ts";

describe("Guest AI TTS contract", () => {
  it("bounds text and validates K151-target PCM output", () => {
    expect(validateTtsRequest({ turn_id: "turn-1", text: "Hi!" })).toEqual({ turnId: "turn-1", text: "Hi!" });
    try { validateTtsRequest({ turn_id: "turn-1", text: "" }); } catch (error) { expect(error).toMatchObject({ code: "reply_empty" }); }
    expect(validatePcmOutput(new Uint8Array(960))).toHaveLength(960);
    expect(fitsPlaybackBudget(new Uint8Array(MAX_PLAYBACK_PCM_BYTES))).toBe(true);
    expect(fitsPlaybackBudget(new Uint8Array(MAX_PLAYBACK_PCM_BYTES + 2))).toBe(false);
    expect(validatePcmOutput(new Uint8Array(MAX_PLAYBACK_PCM_BYTES + 2))).toHaveLength(MAX_PLAYBACK_PCM_BYTES + 2);
    try { validatePcmOutput(new Uint8Array(MAX_PROVIDER_PCM_BYTES + 2)); } catch (error) { expect(error).toMatchObject({ code: "tts_audio_provider_oversized", status: 502 }); }
  });
  it("uses the server-only speech endpoint and explicitly requests raw PCM", async () => {
    let request;
    const provider = new OpenAiTtsProvider(async (url, init) => { request = { url, init }; return new Response(new Uint8Array(960), { status: 200 }); });
    await expect(provider.synthesize({ text: "Hi!", apiKey: "secret", model: "gpt-4o-mini-tts", voice: "alloy", timeoutMs: 1000 })).resolves.toMatchObject({ pcm: expect.any(Uint8Array) });
    expect(request.url).toBe("https://api.openai.com/v1/audio/speech");
    expect(JSON.parse(request.init.body)).toMatchObject({ model: "gpt-4o-mini-tts", voice: "alloy", input: "Hi!", response_format: "pcm" });
  });
  it("performs one server-side language-preserving concise rewrite without exposing provider credentials", async () => {
    let request;
    const compressor = new OpenAiReplyCompressor(async (url, init) => {
      request = { url, init };
      return new Response(JSON.stringify({ output_text: "Saya di sini untuk bantu anda!" }), { status: 200 });
    });
    await expect(compressor.compress({ text: "Saya di sini untuk membantu menyambut tetamu seperti anda!", apiKey: "server-only", model: "gpt-4o-mini", timeoutMs: 1000 })).resolves.toMatchObject({ text: "Saya di sini untuk bantu anda!" });
    expect(request.url).toBe("https://api.openai.com/v1/responses");
    expect(JSON.parse(request.init.body)).toMatchObject({ model: "gpt-4o-mini", max_output_tokens: 32, store: false });
    expect(request.init.headers.Authorization).toBe("Bearer server-only");
  });
});
