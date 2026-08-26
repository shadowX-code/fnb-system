import { supabase } from "../../../lib/supabase.ts";

export class TtsProviderError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function decodeBase64(value) {
  const binary = atob(value); const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function pcmDiagnostics(pcm) {
  let min = 32767; let max = -32768; let sum = 0; let squared = 0; const preview = [];
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  for (let offset = 0; offset < pcm.byteLength; offset += 2) {
    const sample = view.getInt16(offset, true); min = Math.min(min, sample); max = Math.max(max, sample); sum += sample; squared += sample * sample;
    if (preview.length < 8) preview.push(sample);
  }
  const sampleCount = pcm.byteLength / 2;
  return { sampleCount, min, max, peak: Math.max(Math.abs(min), Math.abs(max)), mean: sampleCount ? sum / sampleCount : 0, rms: sampleCount ? Math.sqrt(squared / sampleCount) : 0, preview, durationMs: pcm.byteLength / 48 };
}

export class SupabaseTtsProvider {
  async synthesize({ text, turnId, signal }) {
    if (!String(text ?? "").trim()) throw new TtsProviderError("reply_empty", "No AI reply is available for speech synthesis.");
    if (signal?.aborted) throw new TtsProviderError("request_aborted", "Speech synthesis was cancelled.");
    const { data, error } = await supabase.functions.invoke("guest-ai-tts", { body: { turn_id: turnId, text }, signal, timeout: 30_000 });
    if (error) {
      const failure = await error.context?.json?.().catch(() => null);
      throw new TtsProviderError(failure?.error?.code || "tts_request_failed", failure?.error?.message || error.message || "Speech synthesis request failed.");
    }
    if (!data?.ok || data.stage !== "tts") throw new TtsProviderError(data?.error?.code || "tts_response_invalid", data?.error?.message || "Speech synthesis response is invalid.");
    if (data.turn_id !== turnId) throw new TtsProviderError("tts_turn_mismatch", "Speech synthesis response did not match the active turn.");
    if (data.target_format !== "pcm_s16le" || data.sample_rate_hz !== 24000 || data.channels !== 1 || typeof data.audio_base64 !== "string") throw new TtsProviderError("tts_format_invalid", "Speech synthesis response is not K151 PCM.");
    const pcm = decodeBase64(data.audio_base64);
    if (pcm.byteLength !== data.byte_count) throw new TtsProviderError("tts_size_mismatch", "Speech synthesis response byte count is invalid.");
    return { ...data, pcm, pcm_diagnostics: pcmDiagnostics(pcm) };
  }
}
