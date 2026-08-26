export const MAX_AUDIO_CAPTURE_BYTES = 288000;

function decodeBase64(value) {
  const binary = atob(value); const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export class AudioCaptureAssembler {
  constructor() { this.reset(); }
  reset() { this.turnId = null; this.nextSequence = 0; this.bytes = []; this.byteCount = 0; this.format = null; }
  start(payload) { this.reset(); this.turnId = payload.turn_id; this.format = { format: payload.format, sampleRateHz: payload.sample_rate_hz, channels: payload.channels }; }
  append(payload) {
    if (!this.turnId || payload.turn_id !== this.turnId) throw new Error("audio_turn_mismatch");
    if (!Number.isInteger(payload.sequence) || payload.sequence !== this.nextSequence) throw new Error("audio_sequence_out_of_order");
    if (payload.encoding !== "base64" || typeof payload.pcm !== "string") throw new Error("malformed_audio_frame");
    const decoded = decodeBase64(payload.pcm);
    if (decoded.byteLength !== payload.byte_count || this.byteCount + decoded.byteLength > MAX_AUDIO_CAPTURE_BYTES) throw new Error("audio_capture_size_invalid");
    this.bytes.push(decoded); this.byteCount += decoded.byteLength; this.nextSequence += 1;
  }
  complete(payload) {
    if (!this.turnId || payload.turn_id !== this.turnId || payload.byte_count !== this.byteCount) throw new Error("audio_capture_completion_invalid");
    const pcm = new Uint8Array(this.byteCount); let offset = 0;
    this.bytes.forEach((chunk) => { pcm.set(chunk, offset); offset += chunk.byteLength; });
    return { turnId: this.turnId, pcm, byteCount: this.byteCount, chunks: this.nextSequence, durationMs: payload.duration_ms, completion: payload.completion, ...this.format };
  }
}
