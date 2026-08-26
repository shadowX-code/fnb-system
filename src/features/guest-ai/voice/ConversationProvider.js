import { supabase } from "../../../lib/supabase.ts";

export class ConversationProviderError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export class SupabaseConversationProvider {
  async reply({ transcript, turnId, context = [], signal }) {
    if (!String(transcript ?? "").trim()) throw new ConversationProviderError("transcript_empty", "No speech was available for a reply.");
    if (signal?.aborted) throw new ConversationProviderError("request_aborted", "Conversation reply was cancelled.");
    const { data, error } = await supabase.functions.invoke("guest-ai-reply", { body: { turn_id: turnId, transcript, context }, signal, timeout: 30_000 });
    if (error) {
      const failure = await error.context?.json?.().catch(() => null);
      throw new ConversationProviderError(failure?.error?.code || "llm_request_failed", failure?.error?.message || error.message || "Conversation reply failed.");
    }
    if (!data?.ok || data.stage !== "llm") throw new ConversationProviderError(data?.error?.code || "llm_response_invalid", data?.error?.message || "Conversation response is invalid.");
    if (data.turn_id !== turnId) throw new ConversationProviderError("llm_turn_mismatch", "Conversation response did not match the active turn.");
    return data;
  }
}
