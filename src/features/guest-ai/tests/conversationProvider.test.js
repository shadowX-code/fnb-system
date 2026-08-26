import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("../../../lib/supabase.ts", () => ({ supabase: { functions: { invoke } } }));
const { SupabaseConversationProvider } = await import("../voice/ConversationProvider.js");

describe("SupabaseConversationProvider", () => {
  beforeEach(() => invoke.mockReset());

  it("sends transient bounded context with the current transcript to the authenticated server-side conversation function", async () => {
    invoke.mockResolvedValue({ data: { ok: true, stage: "llm", turn_id: "turn-1", reply_text: "Hello!", status: "completed" }, error: null });
    const context = [{ role: "user", content: "Earlier" }, { role: "assistant", content: "Hi" }];
    await expect(new SupabaseConversationProvider().reply({ transcript: "hello", turnId: "turn-1", context })).resolves.toMatchObject({ reply_text: "Hello!" });
    expect(invoke).toHaveBeenCalledWith("guest-ai-reply", expect.objectContaining({ body: { turn_id: "turn-1", transcript: "hello", context }, timeout: 30_000 }));
  });

  it("does not invent a reply for a failed, malformed, or mismatched response", async () => {
    invoke.mockResolvedValue({ data: { ok: true, stage: "llm", turn_id: "other" }, error: null });
    await expect(new SupabaseConversationProvider().reply({ transcript: "hello", turnId: "turn-1" })).rejects.toMatchObject({ code: "llm_turn_mismatch" });
    await expect(new SupabaseConversationProvider().reply({ transcript: " ", turnId: "turn-1" })).rejects.toMatchObject({ code: "transcript_empty" });
  });
});
