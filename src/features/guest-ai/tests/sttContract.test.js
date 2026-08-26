import { describe, expect, it } from "vitest";
import { MAX_PCM_BYTES, metadataFromHeaders, pcmS16LeToWav, SttRequestError, validatePcmRequest } from "../../../../supabase/functions/guest-ai-stt/contract.ts";
import { OpenAiSttProvider } from "../../../../supabase/functions/guest-ai-stt/provider.ts";
import { STT_FIDELITY_PROMPT } from "../../../../supabase/functions/guest-ai-stt/instructions.ts";
import { DeepgramSttProvider } from "../../../../supabase/functions/guest-ai-stt-benchmark/providers.ts";

const metadata = { turnId: "turn-1", format: "pcm_s16le", sampleRateHz: 24000, channels: 1, byteCount: 960 };

describe("Guest AI server-side STT contract", () => {
  it("validates bounded 24 kHz mono PCM and wraps it as canonical WAV in memory", () => {
    expect(validatePcmRequest(metadata, 960)).toMatchObject({ durationMs: 20 });
    const wav = pcmS16LeToWav(new Uint8Array([1, 2, 3, 4]));
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(wav.slice(8, 12))).toBe("WAVE");
    expect(new DataView(wav.buffer).getUint32(40, true)).toBe(4);
    expect([...wav.slice(44)]).toEqual([1, 2, 3, 4]);
  });

  it("rejects unsupported format, declared-size mismatch, and capture limits", () => {
    expect(() => validatePcmRequest({ ...metadata, format: "wav" }, 960)).toThrow(SttRequestError);
    expect(() => validatePcmRequest(metadata, 959)).toThrow("Declared audio byte count");
    expect(() => validatePcmRequest({ ...metadata, byteCount: MAX_PCM_BYTES + 1 }, MAX_PCM_BYTES + 1)).toThrow("six-second");
  });

  it("reads only explicit transport metadata headers", () => {
    const headers = new Headers({ "X-Guest-AI-Turn-ID": "turn-2", "X-Guest-AI-Format": "pcm_s16le", "X-Guest-AI-Sample-Rate": "24000", "X-Guest-AI-Channels": "1", "X-Guest-AI-Byte-Count": "960" });
    expect(metadataFromHeaders(headers)).toEqual({ ...metadata, turnId: "turn-2" });
  });

  it("maps provider success, rejection, and timeout without exposing PCM", async () => {
    let submittedForm;
    const success = new OpenAiSttProvider(async (_url, init) => { submittedForm = init.body; return new Response(JSON.stringify({ text: "你好 hello", language: "zh", usage: { input_tokens: 1 } }), { status: 200 }); });
    await expect(success.transcribe({ wav: new Uint8Array([1, 2]), apiKey: "server-only", model: "gpt-4o-mini-transcribe", timeoutMs: 20_000, prompt: STT_FIDELITY_PROMPT })).resolves.toMatchObject({ transcript: "你好 hello", language: "zh" });
    expect(submittedForm.get("prompt")).toBe(STT_FIDELITY_PROMPT);
    expect(submittedForm.get("language")).toBeNull();
    const rejected = new OpenAiSttProvider(async () => new Response(JSON.stringify({ error: { message: "invalid audio" } }), { status: 400 }));
    await expect(rejected.transcribe({ wav: new Uint8Array([1, 2]), apiKey: "server-only", model: "gpt-4o-mini-transcribe", timeoutMs: 20_000, prompt: STT_FIDELITY_PROMPT })).rejects.toMatchObject({ code: "provider_rejected" });
    const timedOut = new OpenAiSttProvider(async () => { throw new DOMException("aborted", "AbortError"); });
    await expect(timedOut.transcribe({ wav: new Uint8Array([1, 2]), apiKey: "server-only", model: "gpt-4o-mini-transcribe", timeoutMs: 20_000, prompt: STT_FIDELITY_PROMPT })).rejects.toMatchObject({ code: "provider_timeout" });
  });

  it("uses Deepgram Nova-3 multilingual pre-recorded transcription with the same transient WAV bytes", async () => {
    let requestedUrl;
    let request;
    const provider = new DeepgramSttProvider("server-only", async (url, init) => {
      requestedUrl = url;
      request = init;
      return new Response(JSON.stringify({ metadata: { request_id: "request-1", duration: 2 }, results: { channels: [{ alternatives: [{ transcript: "今天很 busy hor, ramai orang tak?", languages: ["zh", "en", "ms"] }] }] } }), { status: 200 });
    });
    const wav = new Uint8Array([82, 73, 70, 70]);
    await expect(provider.transcribe({ wav, timeoutMs: 20_000 })).resolves.toMatchObject({ candidate: "deepgram_nova_3_multi", transcript: "今天很 busy hor, ramai orang tak?", detectedLanguages: ["zh", "en", "ms"] });
    expect(requestedUrl).toBe("https://api.deepgram.com/v1/listen?language=multi&model=nova-3");
    expect(request.headers).toMatchObject({ Authorization: "Token server-only", "Content-Type": "audio/wav" });
    expect(request.body).toBe(wav);
  });
});
