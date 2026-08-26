export const MAX_INTERACTION_TURNS = 3;
export const FOLLOW_UP_TIMEOUT_MS = 20_000;

const makeId = () => globalThis.crypto?.randomUUID?.() ?? `interaction-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export function createInteractionSession({ id = makeId(), now = Date.now() } = {}) {
  return { id, turns: [], phase: "IDLE", createdAt: now, expiresAt: null };
}

export function appendInteractionTurn(interaction, { turnId, transcript, reply }) {
  if (!interaction || !turnId || !transcript?.trim() || !reply?.trim()) return interaction;
  if (interaction.turns.some((turn) => turn.turnId === turnId)) return interaction;
  return {
    ...interaction,
    turns: [...interaction.turns, { turnId, transcript: transcript.trim(), reply: reply.trim() }].slice(-MAX_INTERACTION_TURNS),
  };
}

// A turn belongs to the interaction that was active when capture began.  A
// late playback-complete event must never be allowed to populate a newer
// interaction created while the previous turn was settling.
export function appendOwnedInteractionTurn(interaction, interactionId, turn) {
  if (!interaction || interaction.id !== interactionId) return interaction;
  return appendInteractionTurn(interaction, turn);
}

export function interactionContext(interaction) {
  return (interaction?.turns ?? []).flatMap((turn) => [
    { role: "user", content: turn.transcript },
    { role: "assistant", content: turn.reply },
  ]);
}

export function markFollowUpReady(interaction, now = Date.now()) {
  if (!interaction) return null;
  return { ...interaction, phase: "FOLLOW_UP_READY", expiresAt: now + FOLLOW_UP_TIMEOUT_MS };
}

export function followUpExpired(interaction, now = Date.now()) {
  return Boolean(interaction?.expiresAt && now >= interaction.expiresAt);
}
