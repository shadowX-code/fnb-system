import { describe, expect, it } from "vitest";
import { appendInteractionTurn, appendOwnedInteractionTurn, createInteractionSession, FOLLOW_UP_TIMEOUT_MS, followUpExpired, interactionContext, markFollowUpReady, MAX_INTERACTION_TURNS } from "../voice/InteractionSession.js";

describe("InteractionSession", () => {
  it("keeps only the three most recent transient transcript/reply turns", () => {
    let interaction = createInteractionSession({ id: "interaction-1", now: 1 });
    for (let index = 1; index <= 4; index += 1) interaction = appendInteractionTurn(interaction, { turnId: `turn-${index}`, transcript: `guest-${index}`, reply: `assistant-${index}` });
    expect(interaction.turns).toHaveLength(MAX_INTERACTION_TURNS);
    expect(interaction.turns.map((turn) => turn.turnId)).toEqual(["turn-2", "turn-3", "turn-4"]);
    expect(interactionContext(interaction)).toEqual([
      { role: "user", content: "guest-2" }, { role: "assistant", content: "assistant-2" },
      { role: "user", content: "guest-3" }, { role: "assistant", content: "assistant-3" },
      { role: "user", content: "guest-4" }, { role: "assistant", content: "assistant-4" },
    ]);
  });

  it("deduplicates playback completion and expires follow-up context without persistence", () => {
    let interaction = createInteractionSession({ id: "interaction-1", now: 10 });
    interaction = appendInteractionTurn(interaction, { turnId: "turn-1", transcript: "hello", reply: "Hello!" });
    expect(appendInteractionTurn(interaction, { turnId: "turn-1", transcript: "changed", reply: "changed" })).toEqual(interaction);
    const ready = markFollowUpReady(interaction, 100);
    expect(ready.phase).toBe("FOLLOW_UP_READY");
    expect(followUpExpired(ready, 100 + FOLLOW_UP_TIMEOUT_MS - 1)).toBe(false);
    expect(followUpExpired(ready, 100 + FOLLOW_UP_TIMEOUT_MS)).toBe(true);
  });

  it("discards a late turn completion after a new interaction has replaced its owner", () => {
    const previous = createInteractionSession({ id: "interaction-old", now: 1 });
    const current = createInteractionSession({ id: "interaction-new", now: 2 });
    const late = { turnId: "turn-old", transcript: "old transcript", reply: "old reply" };

    expect(appendOwnedInteractionTurn(current, previous.id, late)).toEqual(current);
    expect(appendOwnedInteractionTurn(previous, previous.id, late).turns).toEqual([late]);
  });
});
