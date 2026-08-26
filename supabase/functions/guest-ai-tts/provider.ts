import { TtsRequestError, validatePcmOutput } from "./contract.ts";

export class OpenAiTtsProvider {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async synthesize({ text, apiKey, model, voice, timeoutMs }: { text: string; apiKey: string; model: string; voice: string; timeoutMs: number }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = performance.now();
    try {
      const response = await this.fetchImpl("https://api.openai.com/v1/audio/speech", {
        method: "POST", signal: controller.signal,
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, voice, input: text, response_format: "pcm" }),
      });
      const providerResponseMs = Math.round(performance.now() - startedAt);
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const message = typeof body?.error?.message === "string" ? body.error.message : "Speech synthesis provider request failed.";
        throw new TtsRequestError(response.status >= 500 ? "provider_unavailable" : "provider_rejected", message, response.status >= 500 ? 503 : 502);
      }
      return { pcm: validatePcmOutput(new Uint8Array(await response.arrayBuffer())), providerResponseMs };
    } catch (cause) {
      if (cause instanceof TtsRequestError) throw cause;
      if (cause instanceof DOMException && cause.name === "AbortError") throw new TtsRequestError("provider_timeout", "Speech synthesis provider timed out.", 504);
      throw new TtsRequestError("provider_network_error", "Speech synthesis provider network request failed.", 503);
    } finally { clearTimeout(timer); }
  }
}
