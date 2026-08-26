export const MAX_TRANSCRIPT_CHARS = 1_200;
export const MAX_REPLY_CHARS = 500;
export const MAX_REPLY_WORDS = 60;
// Mandarin speech may take materially longer than English at the same visual
// length. Keep the reply comfortably below the six-second PCM prebuffer cap.
export const MAX_SHORT_CONTEXT_TURNS = 3;
export const MAX_SHORT_CONTEXT_MESSAGES = MAX_SHORT_CONTEXT_TURNS * 2;

export type ConversationContextMessage = { role: "user" | "assistant"; content: string };

export class ConversationRequestError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) {
    super(message);
  }
}

export type ConversationRequest = {
  turnId: string;
  transcript: string;
  context: ConversationContextMessage[];
};

function validateContext(value: unknown): ConversationContextMessage[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_SHORT_CONTEXT_MESSAGES) {
    throw new ConversationRequestError("context_invalid", "Short conversation context is invalid or exceeds the bounded limit.", 400);
  }
  return value.map((entry) => {
    if (!entry || typeof entry !== "object") throw new ConversationRequestError("context_invalid", "Each context message must be valid.", 400);
    const candidate = entry as Record<string, unknown>;
    const role = candidate.role;
    const content = typeof candidate.content === "string" ? candidate.content.trim() : "";
    if ((role !== "user" && role !== "assistant") || !content || content.length > MAX_TRANSCRIPT_CHARS) {
      throw new ConversationRequestError("context_invalid", "Each bounded context message needs a role and content.", 400);
    }
    return { role, content };
  });
}

export function validateConversationRequest(value: unknown): ConversationRequest {
  if (!value || typeof value !== "object") throw new ConversationRequestError("request_invalid", "Conversation request must be an object.", 400);
  const candidate = value as Record<string, unknown>;
  const turnId = typeof candidate.turn_id === "string" ? candidate.turn_id.trim() : "";
  const transcript = typeof candidate.transcript === "string" ? candidate.transcript.trim() : "";
  if (!turnId || turnId.length > 128) throw new ConversationRequestError("turn_id_invalid", "A bounded turn_id is required.", 400);
  if (!transcript) throw new ConversationRequestError("transcript_empty", "No speech was available for a reply.", 422);
  if (transcript.length > MAX_TRANSCRIPT_CHARS) throw new ConversationRequestError("transcript_oversized", "Transcript exceeds the Phase 1C limit.", 413);
  return { turnId, transcript, context: validateContext(candidate.context) };
}

export function validateReplyText(value: unknown) {
  const reply = typeof value === "string" ? value.trim() : "";
  if (!reply) throw new ConversationRequestError("reply_empty", "Conversation provider returned no reply.", 502);
  const words = reply.split(/\s+/u).filter(Boolean);
  if (reply.length > MAX_REPLY_CHARS || words.length > MAX_REPLY_WORDS) {
    throw new ConversationRequestError("reply_oversized", "Conversation provider reply exceeded the Phase 1C bound.", 502);
  }
  return reply;
}

export function estimateCostUsd(usage: Record<string, unknown> | null, inputUsdPerMillion: number | null, outputUsdPerMillion: number | null) {
  if (!usage || inputUsdPerMillion == null || outputUsdPerMillion == null) return null;
  const inputTokens = Number(usage.input_tokens);
  const outputTokens = Number(usage.output_tokens);
  if (!Number.isFinite(inputTokens) || !Number.isFinite(outputTokens)) return null;
  return (inputTokens * inputUsdPerMillion + outputTokens * outputUsdPerMillion) / 1_000_000;
}
