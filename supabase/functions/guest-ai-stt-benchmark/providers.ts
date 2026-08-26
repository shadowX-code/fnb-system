import { SttRequestError } from "../guest-ai-stt/contract.ts";
import { STT_FIDELITY_PROMPT } from "../guest-ai-stt/instructions.ts";
import { OpenAiSttProvider } from "../guest-ai-stt/provider.ts";

export type BenchmarkTranscript = {
  provider: "openai" | "deepgram";
  candidate: "openai_gpt_4o_mini_transcribe" | "openai_gpt_4o_transcribe" | "deepgram_nova_3_multi";
  model: string;
  transcript: string;
  detectedLanguages: string[];
  providerResponseMs: number;
  usage: unknown;
};

export interface SttProvider {
  transcribe(input: { wav: Uint8Array; timeoutMs: number }): Promise<BenchmarkTranscript>;
}

export class OpenAiBenchmarkSttProvider implements SttProvider {
  constructor(
    private readonly candidate: BenchmarkTranscript["candidate"],
    private readonly model: "gpt-4o-mini-transcribe" | "gpt-4o-transcribe",
    private readonly apiKey: string,
    private readonly provider = new OpenAiSttProvider(),
  ) {}

  async transcribe({ wav, timeoutMs }: { wav: Uint8Array; timeoutMs: number }): Promise<BenchmarkTranscript> {
    const result = await this.provider.transcribe({ wav, apiKey: this.apiKey, model: this.model, timeoutMs, prompt: STT_FIDELITY_PROMPT });
    return {
      provider: "openai",
      candidate: this.candidate,
      model: this.model,
      transcript: result.transcript,
      detectedLanguages: result.language ? [result.language] : [],
      providerResponseMs: result.providerResponseMs,
      usage: result.usage,
    };
  }
}

export class DeepgramSttProvider implements SttProvider {
  constructor(private readonly apiKey: string, private readonly fetchImpl: typeof fetch = fetch) {}

  async transcribe({ wav, timeoutMs }: { wav: Uint8Array; timeoutMs: number }): Promise<BenchmarkTranscript> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = performance.now();
    try {
      const response = await this.fetchImpl("https://api.deepgram.com/v1/listen?language=multi&model=nova-3", {
        method: "POST",
        signal: controller.signal,
        headers: { Authorization: `Token ${this.apiKey}`, "Content-Type": "audio/wav" },
        body: wav,
      });
      const providerResponseMs = Math.round(performance.now() - startedAt);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const providerMessage = typeof body?.err_msg === "string" ? body.err_msg : "Deepgram speech transcription request failed.";
        throw new SttRequestError(response.status >= 500 ? "provider_unavailable" : "provider_rejected", providerMessage, response.status >= 500 ? 503 : 502);
      }
      const alternative = body?.results?.channels?.[0]?.alternatives?.[0] ?? {};
      return {
        provider: "deepgram",
        candidate: "deepgram_nova_3_multi",
        model: "nova-3",
        transcript: typeof alternative.transcript === "string" ? alternative.transcript.trim() : "",
        detectedLanguages: Array.isArray(alternative.languages) ? alternative.languages.filter((value: unknown) => typeof value === "string") : [],
        providerResponseMs,
        usage: body?.metadata ? { request_id: body.metadata.request_id ?? null, duration: body.metadata.duration ?? null } : null,
      };
    } catch (cause) {
      if (cause instanceof SttRequestError) throw cause;
      if (cause instanceof DOMException && cause.name === "AbortError") throw new SttRequestError("provider_timeout", "Deepgram speech transcription timed out.", 504);
      throw new SttRequestError("provider_network_error", "Deepgram speech transcription network request failed.", 503);
    } finally {
      clearTimeout(timer);
    }
  }
}
