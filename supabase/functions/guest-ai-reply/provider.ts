import { ConversationRequestError, type ConversationContextMessage, validateReplyText } from "./contract.ts";

function conversationInput(transcript: string, context: ConversationContextMessage[]) {
  if (!context.length) return transcript;
  const prior = context.map((message) => `${message.role === "user" ? "Guest" : "Assistant"}: ${message.content}`).join("\n");
  return `Recent conversation context (use only when relevant; do not restate or correct it):\n${prior}\n\nCurrent guest transcript (verbatim STT; do not correct or translate it):\n${transcript}`;
}

function outputText(body: Record<string, unknown>) {
  if (typeof body.output_text === "string") return body.output_text;
  const output = Array.isArray(body.output) ? body.output : [];
  return output
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .flatMap((item) => Array.isArray(item.content) ? item.content : [])
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && item.type === "output_text")
    .map((item) => typeof item.text === "string" ? item.text : "")
    .join("");
}

export class OpenAiConversationProvider {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async reply({ transcript, context = [], apiKey, model, timeoutMs, maxOutputTokens, instructions }: { transcript: string; context?: ConversationContextMessage[]; apiKey: string; model: string; timeoutMs: number; maxOutputTokens: number; instructions: string }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = performance.now();
    try {
      const response = await this.fetchImpl("https://api.openai.com/v1/responses", {
        method: "POST",
        signal: controller.signal,
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, instructions, input: conversationInput(transcript, context), max_output_tokens: maxOutputTokens, store: false }),
      });
      const providerResponseMs = Math.round(performance.now() - startedAt);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const providerMessage = typeof body?.error?.message === "string" ? body.error.message : "Conversation provider request failed.";
        throw new ConversationRequestError(response.status >= 500 ? "provider_unavailable" : "provider_rejected", providerMessage, response.status >= 500 ? 503 : 502);
      }
      return { replyText: validateReplyText(outputText(body)), usage: body.usage && typeof body.usage === "object" ? body.usage as Record<string, unknown> : null, providerResponseMs };
    } catch (cause) {
      if (cause instanceof ConversationRequestError) throw cause;
      if (cause instanceof DOMException && cause.name === "AbortError") throw new ConversationRequestError("provider_timeout", "Conversation provider timed out.", 504);
      throw new ConversationRequestError("provider_network_error", "Conversation provider network request failed.", 503);
    } finally {
      clearTimeout(timer);
    }
  }
}
