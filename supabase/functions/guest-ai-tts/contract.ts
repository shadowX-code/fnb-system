export const PCM_S16LE = "pcm_s16le";
export const SAMPLE_RATE_HZ = 24_000;
export const CHANNELS = 1;
export const MAX_REPLY_CHARS = 500;
// K151's actual bounded prebuffer capability: six seconds of 24 kHz S16LE mono.
export const MAX_PLAYBACK_PCM_BYTES = 288_000;
// The provider response is still bounded in memory while the server decides
// whether one concise rewrite is needed. It is never returned to the browser
// unless it meets MAX_PLAYBACK_PCM_BYTES.
export const MAX_PROVIDER_PCM_BYTES = 576_000;

export class TtsRequestError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) { super(message); }
}

export function validateTtsRequest(value: unknown) {
  const request = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const turnId = typeof request.turn_id === "string" ? request.turn_id.trim() : "";
  const text = typeof request.text === "string" ? request.text.trim() : "";
  if (!turnId || turnId.length > 128) throw new TtsRequestError("invalid_turn_id", "A valid turn ID is required.");
  if (!text) throw new TtsRequestError("reply_empty", "A non-empty AI reply is required for speech synthesis.");
  if (text.length > MAX_REPLY_CHARS) throw new TtsRequestError("reply_too_long", "AI reply exceeds the bounded speech limit.");
  return { turnId, text };
}

export function validatePcmOutput(pcm: Uint8Array) {
  if (!pcm.byteLength) throw new TtsRequestError("tts_audio_empty", "Synthesized PCM contained no samples.", 502);
  if (pcm.byteLength % 2) throw new TtsRequestError("tts_audio_invalid_byte_alignment", "Synthesized PCM is not aligned to 16-bit samples.", 502);
  if (pcm.byteLength > MAX_PROVIDER_PCM_BYTES) throw new TtsRequestError("tts_audio_provider_oversized", "Synthesized PCM exceeds the bounded Voice Runtime limit.", 502);
  return pcm;
}

export const pcmDurationMs = (bytes: number) => bytes / 48;
export const fitsPlaybackBudget = (pcm: Uint8Array) => pcm.byteLength <= MAX_PLAYBACK_PCM_BYTES;
