import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.4";
import { CHANNELS, fitsPlaybackBudget, MAX_PLAYBACK_PCM_BYTES, PCM_S16LE, pcmDurationMs, SAMPLE_RATE_HZ, TtsRequestError, validateTtsRequest } from "./contract.ts";
import { OpenAiReplyCompressor } from "./compressor.ts";
import { OpenAiTtsProvider } from "./provider.ts";

const allowedOrigins = new Set(["http://127.0.0.1:5175", "http://localhost:5175", "https://fnb-system-staging.vercel.app"]);
const baseCorsHeaders = { "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", Vary: "Origin" };
const corsHeaders = (request: Request) => ({ ...baseCorsHeaders, "Access-Control-Allow-Origin": allowedOrigins.has(request.headers.get("origin") || "") ? request.headers.get("origin") || "" : "null" });
const response = (request: Request, body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(request), "Cache-Control": "no-store", "Content-Type": "application/json" } });
const fail = (request: Request, turnId: string | null, code: string, message: string, status: number) => response(request, { ok: false, stage: "tts", turn_id: turnId, error: { code, message } }, status);
const bounded = (raw: string | undefined, fallback: number, min: number, max: number) => { const value = Number(raw ?? fallback); return Number.isFinite(value) && value >= min && value <= max ? value : fallback; };
function base64(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin") || "";
  if (origin && !allowedOrigins.has(origin)) return fail(request, null, "origin_not_allowed", "This origin is not permitted for the staging voice runtime.", 403);
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(request) });
  if (request.method !== "POST") return fail(request, null, "method_not_allowed", "Only POST is supported.", 405);
  let raw: Record<string, unknown> = {};
  try { raw = await request.json(); } catch { return fail(request, null, "request_invalid", "Speech synthesis request must be JSON.", 400); }
  const turnId = typeof raw.turn_id === "string" ? raw.turn_id : null;
  const supabaseUrl = Deno.env.get("PROJECT_URL") || Deno.env.get("SUPABASE_URL") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const apiKey = Deno.env.get("OPENAI_API_KEY") || "";
  const model = Deno.env.get("VOICE_TTS_MODEL") || "";
  const voice = Deno.env.get("VOICE_TTS_VOICE") || "";
  const compressionModel = Deno.env.get("VOICE_TTS_COMPRESSION_MODEL") || Deno.env.get("VOICE_LLM_MODEL") || "gpt-4o-mini";
  if (!supabaseUrl || !anonKey) return fail(request, turnId, "service_not_configured", "Voice runtime authentication is not configured.", 503);
  if (!apiKey || !model || !voice) return fail(request, turnId, "provider_not_configured", "Speech synthesis provider configuration is missing.", 503);
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) return fail(request, turnId, "authentication_required", "Sign in is required.", 401);
  const auth = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await auth.auth.getUser();
  if (error || !data.user) return fail(request, turnId, "authentication_required", "Your session is not valid.", 401);
  try {
    const valid = validateTtsRequest(raw);
    const startedAt = performance.now(); const timeoutMs = bounded(Deno.env.get("VOICE_TTS_TIMEOUT_MS"), 20_000, 1_000, 60_000);
    const provider = new OpenAiTtsProvider();
    const original = await provider.synthesize({ text: valid.text, apiKey, model, voice, timeoutMs });
    const originalDurationMs = pcmDurationMs(original.pcm.byteLength);
    let synthesized = original; let spokenReply = valid.text;
    let compression = { triggered: false, original_reply_length: valid.text.length, original_pcm_bytes: original.pcm.byteLength, original_duration_ms: originalDurationMs, compressed_reply_length: null as number | null, compressed_pcm_bytes: null as number | null, compressed_duration_ms: null as number | null, compression_latency_ms: 0 };
    if (!fitsPlaybackBudget(original.pcm)) {
      const compressed = await new OpenAiReplyCompressor().compress({ text: valid.text, apiKey, model: compressionModel, timeoutMs });
      synthesized = await provider.synthesize({ text: compressed.text, apiKey, model, voice, timeoutMs });
      spokenReply = compressed.text;
      compression = { ...compression, triggered: true, compressed_reply_length: compressed.text.length, compressed_pcm_bytes: synthesized.pcm.byteLength, compressed_duration_ms: pcmDurationMs(synthesized.pcm.byteLength), compression_latency_ms: compressed.providerResponseMs };
      if (!fitsPlaybackBudget(synthesized.pcm)) throw new TtsRequestError("tts_reply_still_exceeds_playback_limit", "Shortened reply still exceeds the six-second K151 playback limit.", 422);
    }
    const ttsLatencyMs = Math.round(performance.now() - startedAt);
    // Audio is base64 only for this no-store function response and immediately
    // becomes the browser's bounded USB playback payload; it is never logged.
    const encoded = base64(synthesized.pcm);
    console.info(JSON.stringify({ event: "guest_ai_tts", turn_id: valid.turnId, original_reply_length: valid.text.length, final_reply_length: spokenReply.length, pcm_bytes: synthesized.pcm.byteLength, playback_duration_ms: pcmDurationMs(synthesized.pcm.byteLength), max_playback_pcm_bytes: MAX_PLAYBACK_PCM_BYTES, compression_triggered: compression.triggered, tts_latency_ms: ttsLatencyMs, provider_response_ms: synthesized.providerResponseMs, model, voice, outcome: "synthesized" }));
    return response(request, { ok: true, stage: "tts", turn_id: valid.turnId, provider: "openai", model, voice, target_format: PCM_S16LE, sample_rate_hz: SAMPLE_RATE_HZ, channels: CHANNELS, byte_count: synthesized.pcm.byteLength, audio_base64: encoded, spoken_reply: spokenReply, reply_shortened: compression.triggered, compression, playback_budget: { max_tts_pcm_bytes: MAX_PLAYBACK_PCM_BYTES, sample_rate_hz: SAMPLE_RATE_HZ, bit_depth: 16, channels: CHANNELS, max_playback_duration_ms: pcmDurationMs(MAX_PLAYBACK_PCM_BYTES) }, tts_latency_ms: ttsLatencyMs, provider_response_ms: synthesized.providerResponseMs });
  } catch (cause) {
    const known = cause instanceof TtsRequestError ? cause : new TtsRequestError("tts_failed", "Speech synthesis failed.", 502);
    console.info(JSON.stringify({ event: "guest_ai_tts", turn_id: turnId, success: false, error_code: known.code }));
    return fail(request, turnId, known.code, known.message, known.status);
  }
});
