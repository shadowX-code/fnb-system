import { TtsRequestError } from "./contract.ts";

function outputText(body: Record<string, unknown>) {
  if (typeof body.output_text === "string") return body.output_text.trim();
  const output = Array.isArray(body.output) ? body.output : [];
  return output.flatMap((item) => item && typeof item === "object" && Array.isArray((item as Record<string, unknown>).content) ? (item as Record<string, unknown>).content as unknown[] : [])
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && item.type === "output_text")
    .map((item) => typeof item.text === "string" ? item.text : "").join("").trim();
}

export class OpenAiReplyCompressor {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async compress({ text, apiKey, model, timeoutMs }: { text: string; apiKey: string; model: string; timeoutMs: number }) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs); const startedAt = performance.now();
    try {
      const response = await this.fetchImpl("https://api.openai.com/v1/responses", {
        method: "POST", signal: controller.signal, headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, store: false, max_output_tokens: 32, instructions: "Rewrite the supplied assistant reply as one much shorter natural spoken sentence. Preserve its language and meaning. Do not translate, add facts, or mention rewriting. Output only the rewritten reply.", input: text }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new TtsRequestError(response.status >= 500 ? "compression_provider_unavailable" : "compression_provider_rejected", "Reply compression provider request failed.", response.status >= 500 ? 503 : 502);
      const compressed = outputText(body);
      if (!compressed) throw new TtsRequestError("compression_empty", "Reply compression returned no spoken reply.", 502);
      return { text: compressed, providerResponseMs: Math.round(performance.now() - startedAt) };
    } catch (cause) {
      if (cause instanceof TtsRequestError) throw cause;
      if (cause instanceof DOMException && cause.name === "AbortError") throw new TtsRequestError("compression_timeout", "Reply compression timed out.", 504);
      throw new TtsRequestError("compression_provider_network_error", "Reply compression provider network request failed.", 503);
    } finally { clearTimeout(timer); }
  }
}
