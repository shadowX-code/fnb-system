import { normalizeSttResponse, SttRequestError } from "./contract.ts";

export class OpenAiSttProvider {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async transcribe({ wav, apiKey, model, timeoutMs, prompt }: { wav: Uint8Array; apiKey: string; model: string; timeoutMs: number; prompt: string }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const form = new FormData();
    form.set("model", model);
    form.set("response_format", "json");
    form.set("prompt", prompt);
    form.set("file", new File([wav], "capture.wav", { type: "audio/wav" }));
    const startedAt = performance.now();
    try {
      const response = await this.fetchImpl("https://api.openai.com/v1/audio/transcriptions", { method: "POST", signal: controller.signal, headers: { Authorization: `Bearer ${apiKey}` }, body: form });
      const providerResponseMs = Math.round(performance.now() - startedAt);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const providerMessage = typeof body?.error?.message === "string" ? body.error.message : "Speech transcription provider request failed.";
        throw new SttRequestError(response.status >= 500 ? "provider_unavailable" : "provider_rejected", providerMessage, response.status >= 500 ? 503 : 502);
      }
      return { ...normalizeSttResponse(body), providerResponseMs };
    } catch (cause) {
      if (cause instanceof SttRequestError) throw cause;
      if (cause instanceof DOMException && cause.name === "AbortError") throw new SttRequestError("provider_timeout", "Speech transcription timed out.", 504);
      throw new SttRequestError("provider_network_error", "Speech transcription network request failed.", 503);
    } finally { clearTimeout(timer); }
  }
}
