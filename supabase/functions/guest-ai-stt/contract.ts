export const PCM_S16LE = "pcm_s16le";
export const SAMPLE_RATE_HZ = 24_000;
export const CHANNELS = 1;
export const BYTES_PER_SAMPLE = 2;
export const MAX_DURATION_MS = 6_000;
export const MAX_PCM_BYTES = 288_000;

export type SttAudioMetadata = {
  turnId: string;
  format: string;
  sampleRateHz: number;
  channels: number;
  byteCount: number;
};

export class SttRequestError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) { super(message); }
}

function headerNumber(value: string | null) {
  if (!value || !/^\d+$/.test(value)) return Number.NaN;
  return Number(value);
}

export function metadataFromHeaders(headers: Headers): SttAudioMetadata {
  return {
    turnId: headers.get("x-guest-ai-turn-id") || "",
    format: headers.get("x-guest-ai-format") || "",
    sampleRateHz: headerNumber(headers.get("x-guest-ai-sample-rate")),
    channels: headerNumber(headers.get("x-guest-ai-channels")),
    byteCount: headerNumber(headers.get("x-guest-ai-byte-count")),
  };
}

export function validatePcmRequest(metadata: SttAudioMetadata, actualByteCount: number) {
  if (!metadata.turnId || metadata.turnId.length > 128) throw new SttRequestError("invalid_turn_id", "A valid turn ID is required.");
  if (metadata.format !== PCM_S16LE) throw new SttRequestError("unsupported_format", "Only pcm_s16le audio is supported.");
  if (metadata.sampleRateHz !== SAMPLE_RATE_HZ || metadata.channels !== CHANNELS) throw new SttRequestError("unsupported_audio_format", "Only 24 kHz mono PCM audio is supported.");
  if (!Number.isInteger(metadata.byteCount) || metadata.byteCount <= 0 || metadata.byteCount > MAX_PCM_BYTES) throw new SttRequestError("audio_size_invalid", "Audio byte count is invalid or exceeds the six-second limit.");
  if (actualByteCount !== metadata.byteCount) throw new SttRequestError("audio_size_mismatch", "Declared audio byte count does not match the request body.");
  if (actualByteCount % (CHANNELS * BYTES_PER_SAMPLE) !== 0) throw new SttRequestError("audio_alignment_invalid", "PCM audio is not sample aligned.");
  const durationMs = Math.round((actualByteCount / (metadata.sampleRateHz * metadata.channels * BYTES_PER_SAMPLE)) * 1_000);
  if (durationMs > MAX_DURATION_MS) throw new SttRequestError("audio_duration_exceeded", "Audio exceeds the six-second capture limit.");
  return { ...metadata, durationMs };
}

export function pcmS16LeToWav(pcm: Uint8Array, sampleRateHz = SAMPLE_RATE_HZ, channels = CHANNELS) {
  const dataLength = pcm.byteLength;
  const wav = new Uint8Array(44 + dataLength);
  const view = new DataView(wav.buffer);
  const writeAscii = (offset: number, value: string) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  const byteRate = sampleRateHz * channels * BYTES_PER_SAMPLE;
  const blockAlign = channels * BYTES_PER_SAMPLE;
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRateHz, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, dataLength, true);
  wav.set(pcm, 44);
  return wav;
}

export function normalizeSttResponse(body: unknown) {
  const value = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const transcript = typeof value.text === "string" ? value.text.trim() : "";
  const language = typeof value.language === "string" && value.language.trim() ? value.language.trim() : null;
  const usage = value.usage && typeof value.usage === "object" ? value.usage : null;
  return { transcript, language, usage };
}
