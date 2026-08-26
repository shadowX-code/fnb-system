import { supabase } from "../../../lib/supabase.ts";
import { SttProviderError } from "./SttProvider.js";

export class SupabaseSttBenchmarkProvider {
  async transcribe({ pcm, sampleRate, channels, turnId, signal }) {
    if (!(pcm instanceof Uint8Array) || !pcm.byteLength) throw new SttProviderError("audio_invalid", "No PCM audio is available for transcription benchmark.");
    if (signal?.aborted) throw new SttProviderError("request_aborted", "Speech transcription benchmark was cancelled.");
    const body = pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength);
    const { data, error } = await supabase.functions.invoke("guest-ai-stt-benchmark", {
      body,
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Guest-AI-Turn-ID": turnId,
        "X-Guest-AI-Format": "pcm_s16le",
        "X-Guest-AI-Sample-Rate": String(sampleRate),
        "X-Guest-AI-Channels": String(channels),
        "X-Guest-AI-Byte-Count": String(pcm.byteLength),
      },
      signal,
      timeout: 70_000,
    });
    if (error) {
      const failure = await error.context?.json?.().catch(() => null);
      throw new SttProviderError(failure?.error?.code || "stt_benchmark_request_failed", failure?.error?.message || error.message || "Speech transcription benchmark request failed.");
    }
    if (!data?.ok || data.stage !== "stt_benchmark") throw new SttProviderError(data?.error?.code || "stt_benchmark_response_invalid", data?.error?.message || "Speech transcription benchmark response is invalid.");
    if (data.turn_id !== turnId) throw new SttProviderError("stt_benchmark_turn_mismatch", "Speech transcription benchmark response did not match the active turn.");
    return data;
  }
}
