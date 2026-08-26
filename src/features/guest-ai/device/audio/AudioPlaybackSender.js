export const PLAYBACK_SAMPLE_RATE_HZ = 24_000;
export const PLAYBACK_CHANNELS = 1;
// 1,024 raw PCM bytes serializes below the device's 2 KiB JSON-lines limit
// with canonical UUID metadata, while reducing upload command overhead.
export const PLAYBACK_CHUNK_BYTES = 1_024;
export const MAX_AUDIO_PLAYBACK_BYTES = 288_000;
export const PLAYBACK_ACK_TIMEOUT_MS = 1_500;
export const PLAYBACK_BUSY_RETRY_LIMIT = 3;

export class AudioPlaybackValidationError extends Error {
  constructor(code, message, evidence) {
    super(message); this.name = "AudioPlaybackValidationError"; this.code = code; this.evidence = evidence;
  }
}

function validatePlaybackPcm(pcm, sampleRate, channels) {
  const byteCount = pcm instanceof Uint8Array ? pcm.byteLength : 0;
  const evidence = { byte_count: byteCount, max_bytes: MAX_AUDIO_PLAYBACK_BYTES, sample_rate_hz: sampleRate, channels, duration_ms: byteCount / 48, max_duration_ms: MAX_AUDIO_PLAYBACK_BYTES / 48 };
  if (!(pcm instanceof Uint8Array)) throw new AudioPlaybackValidationError("audio_playback_pcm_invalid", "Synthesized audio is not PCM bytes.", evidence);
  if (!byteCount) throw new AudioPlaybackValidationError("audio_playback_empty", "Synthesized audio contained no PCM samples.", evidence);
  if (byteCount % 2) throw new AudioPlaybackValidationError("audio_playback_invalid_byte_alignment", "Synthesized PCM is not aligned to 16-bit samples.", evidence);
  if (byteCount > MAX_AUDIO_PLAYBACK_BYTES) throw new AudioPlaybackValidationError("audio_playback_exceeds_max_bytes", "Synthesized speech exceeds the six-second K151 playback limit.", evidence);
  if (sampleRate !== PLAYBACK_SAMPLE_RATE_HZ) throw new AudioPlaybackValidationError("audio_playback_unsupported_sample_rate", "Synthesized PCM sample rate is not supported by K151 playback.", evidence);
  if (channels !== PLAYBACK_CHANNELS) throw new AudioPlaybackValidationError("audio_playback_unsupported_channels", "Synthesized PCM channel count is not supported by K151 playback.", evidence);
}

function encodeBase64(bytes) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const makeCommandId = () => globalThis.crypto?.randomUUID?.() ?? `play-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// Browser-side sender for bounded full-turn upload. The device does not start
// the speaker until every byte has been sequentially ACKed and playback_end
// validates the complete prebuffer.
export class AudioPlaybackSender {
  async send({ session, turnId, pcm, sampleRate = PLAYBACK_SAMPLE_RATE_HZ, channels = PLAYBACK_CHANNELS, signal }) {
    validatePlaybackPcm(pcm, sampleRate, channels);
    const startedAt = performance.now(); const ackLatencies = []; let busyRetries = 0;
    try {
      const start = await session.startPlaybackAndWait({ turnId, sampleRate, channels, totalBytes: pcm.byteLength });
      if (start.status !== "ok") throw new Error(start.detail ?? "audio_playback_start_rejected");
      let sequence = 0; let offset = 0;
      while (offset < pcm.byteLength) {
        if (signal?.aborted) throw new Error("audio_playback_aborted");
        const chunk = pcm.slice(offset, Math.min(offset + PLAYBACK_CHUNK_BYTES, pcm.byteLength));
        const sentAt = performance.now();
        const ack = await session.sendPlaybackChunkAndWait({ turnId, sequence, pcm: encodeBase64(chunk), byteCount: chunk.byteLength, commandId: makeCommandId(), timeoutMs: PLAYBACK_ACK_TIMEOUT_MS });
        const ackLatency = performance.now() - sentAt;
        if (ack.status === "ok" && ack.evidence?.accepted === true) {
          ackLatencies.push(ackLatency); offset += chunk.byteLength; sequence += 1;
          continue;
        }
        if (ack.detail === "audio_playback_chunk_busy") {
          busyRetries += 1;
          if (busyRetries > PLAYBACK_BUSY_RETRY_LIMIT) throw new Error("audio_playback_chunk_busy_timeout");
          await sleep(10);
          continue;
        }
        throw new Error(ack.detail ?? "audio_playback_chunk_rejected");
      }
      const ended = await session.endPlaybackAndWait(turnId);
      if (ended.status !== "ok") throw new Error(ended.detail ?? "audio_playback_end_rejected");
      return { turnId, chunks: sequence, byteCount: pcm.byteLength, transportLatencyMs: Math.round(performance.now() - startedAt), ackLatencyMs: ackLatencies, busyRetries, mode: "bounded_prebuffer" };
    } catch (error) {
      await session.cancelPlayback?.(turnId, error.code ?? error.message ?? "audio_playback_host_cancelled").catch(() => {});
      throw error;
    }
  }
}
