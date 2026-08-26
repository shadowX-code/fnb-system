import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.4";
import { MAX_PCM_BYTES, metadataFromHeaders, pcmS16LeToWav, SttRequestError, validatePcmRequest } from "./contract.ts";
import { OpenAiSttProvider } from "./provider.ts";
import { STT_FIDELITY_PROMPT } from "./instructions.ts";

const allowedOrigins = new Set(["http://127.0.0.1:5175", "http://localhost:5175", "https://fnb-system-staging.vercel.app"]);
const baseCorsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-guest-ai-turn-id, x-guest-ai-format, x-guest-ai-sample-rate, x-guest-ai-channels, x-guest-ai-byte-count",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin") || "";
  return { ...baseCorsHeaders, "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "null" };
}

function json(request: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(request), "Cache-Control": "no-store", "Content-Type": "application/json" } });
}

function errorResponse(request: Request, turnId: string | null, code: string, message: string, status: number) {
  return json(request, { ok: false, stage: "stt", turn_id: turnId, error: { code, message } }, status);
}

function serverConfig() {
  const supabaseUrl = Deno.env.get("PROJECT_URL") || Deno.env.get("SUPABASE_URL") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const apiKey = Deno.env.get("OPENAI_API_KEY") || "";
  const model = Deno.env.get("VOICE_STT_MODEL") || "gpt-4o-mini-transcribe";
  const timeoutMs = Number(Deno.env.get("VOICE_PROVIDER_TIMEOUT_MS") || "20000");
  return { supabaseUrl, anonKey, apiKey, model, timeoutMs: Number.isFinite(timeoutMs) && timeoutMs >= 1_000 && timeoutMs <= 60_000 ? timeoutMs : 20_000 };
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin") || "";
  if (origin && !allowedOrigins.has(origin)) return errorResponse(request, null, "origin_not_allowed", "This origin is not permitted for the staging voice runtime.", 403);
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(request) });
  if (request.method !== "POST") return errorResponse(request, null, "method_not_allowed", "Only POST is supported.", 405);

  const metadata = metadataFromHeaders(request.headers);
  const config = serverConfig();
  if (!config.supabaseUrl || !config.anonKey) return errorResponse(request, metadata.turnId || null, "service_not_configured", "Voice runtime authentication is not configured.", 503);
  if (!config.apiKey) return errorResponse(request, metadata.turnId || null, "provider_not_configured", "Speech transcription provider is not configured.", 503);

  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) return errorResponse(request, metadata.turnId || null, "authentication_required", "Sign in is required.", 401);
  const authClient = createClient(config.supabaseUrl, config.anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await authClient.auth.getUser();
  if (authError || !authData.user) return errorResponse(request, metadata.turnId || null, "authentication_required", "Your session is not valid.", 401);

  const declaredLength = Number(request.headers.get("content-length") || "0");
  if (declaredLength > MAX_PCM_BYTES) return errorResponse(request, metadata.turnId || null, "audio_size_invalid", "Audio exceeds the six-second capture limit.", 413);
  try {
    const pcm = new Uint8Array(await request.arrayBuffer());
    const valid = validatePcmRequest(metadata, pcm.byteLength);
    const requestStartedAt = performance.now();
    const result = await new OpenAiSttProvider().transcribe({ wav: pcmS16LeToWav(pcm, valid.sampleRateHz, valid.channels), apiKey: config.apiKey, model: config.model, timeoutMs: config.timeoutMs, prompt: STT_FIDELITY_PROMPT });
    const sttLatencyMs = Math.round(performance.now() - requestStartedAt);
    const outcome = result.transcript ? "transcribed" : "empty_transcript";
    console.info(JSON.stringify({ event: "guest_ai_stt", turn_id: valid.turnId, audio_bytes: valid.byteCount, audio_duration_ms: valid.durationMs, stt_request_ms: sttLatencyMs, provider_response_ms: result.providerResponseMs, transcript_length: result.transcript.length, outcome }));
    return json(request, { ok: true, stage: "stt", turn_id: valid.turnId, outcome, transcript: result.transcript, detected_language: result.language, provider: "openai", model: config.model, stt_provider_status: "provisional", audio_duration_ms: valid.durationMs, audio_bytes: valid.byteCount, stt_latency_ms: sttLatencyMs, provider_response_ms: result.providerResponseMs, usage: result.usage });
  } catch (cause) {
    const known = cause instanceof SttRequestError ? cause : new SttRequestError("stt_failed", "Speech transcription failed.", 502);
    console.info(JSON.stringify({ event: "guest_ai_stt", turn_id: metadata.turnId || null, audio_bytes: Number.isFinite(metadata.byteCount) ? metadata.byteCount : null, success: false, error_code: known.code }));
    return errorResponse(request, metadata.turnId || null, known.code, known.message, known.status);
  }
});
