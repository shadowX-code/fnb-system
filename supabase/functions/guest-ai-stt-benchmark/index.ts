import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.4";
import { MAX_PCM_BYTES, metadataFromHeaders, pcmS16LeToWav, SttRequestError, validatePcmRequest } from "../guest-ai-stt/contract.ts";
import { DeepgramSttProvider, OpenAiBenchmarkSttProvider, type BenchmarkTranscript } from "./providers.ts";

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
  return json(request, { ok: false, stage: "stt_benchmark", turn_id: turnId, error: { code, message } }, status);
}

function config() {
  const timeoutMs = Number(Deno.env.get("VOICE_PROVIDER_TIMEOUT_MS") || "20000");
  return {
    supabaseUrl: Deno.env.get("PROJECT_URL") || Deno.env.get("SUPABASE_URL") || "",
    anonKey: Deno.env.get("SUPABASE_ANON_KEY") || "",
    openAiApiKey: Deno.env.get("OPENAI_API_KEY") || "",
    deepgramApiKey: Deno.env.get("DEEPGRAM_API_KEY") || "",
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs >= 1_000 && timeoutMs <= 60_000 ? timeoutMs : 20_000,
  };
}

async function authenticate(request: Request, supabaseUrl: string, anonKey: string) {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) return false;
  const client = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.getUser();
  return !error && Boolean(data.user);
}

function serialiseResult(result: PromiseSettledResult<BenchmarkTranscript>) {
  if (result.status === "fulfilled") {
    const value = result.value;
    return {
      ok: true,
      provider: value.provider,
      candidate: value.candidate,
      model: value.model,
      transcript: value.transcript,
      detected_languages: value.detectedLanguages,
      provider_response_ms: value.providerResponseMs,
      usage: value.usage,
      estimated_cost_usd: null,
    };
  }
  const error = result.reason instanceof SttRequestError ? result.reason : new SttRequestError("provider_failed", "Speech transcription provider failed.", 502);
  return { ok: false, error: { code: error.code, message: error.message }, estimated_cost_usd: null };
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin") || "";
  if (origin && !allowedOrigins.has(origin)) return errorResponse(request, null, "origin_not_allowed", "This origin is not permitted for the staging voice runtime.", 403);
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(request) });
  if (request.method !== "POST") return errorResponse(request, null, "method_not_allowed", "Only POST is supported.", 405);

  const metadata = metadataFromHeaders(request.headers);
  const runtime = config();
  if (!runtime.supabaseUrl || !runtime.anonKey) return errorResponse(request, metadata.turnId || null, "service_not_configured", "Voice runtime authentication is not configured.", 503);
  if (!runtime.openAiApiKey || !runtime.deepgramApiKey) return errorResponse(request, metadata.turnId || null, "benchmark_provider_not_configured", "The OpenAI and Deepgram Staging providers must both be configured before a benchmark capture is accepted.", 503);
  if (!(await authenticate(request, runtime.supabaseUrl, runtime.anonKey))) return errorResponse(request, metadata.turnId || null, "authentication_required", "Sign in is required.", 401);

  const declaredLength = Number(request.headers.get("content-length") || "0");
  if (declaredLength > MAX_PCM_BYTES) return errorResponse(request, metadata.turnId || null, "audio_size_invalid", "Audio exceeds the six-second capture limit.", 413);
  try {
    const pcm = new Uint8Array(await request.arrayBuffer());
    const valid = validatePcmRequest(metadata, pcm.byteLength);
    // The single WAV instance below is transient and is passed unchanged to every candidate.
    const wav = pcmS16LeToWav(pcm, valid.sampleRateHz, valid.channels);
    const startedAt = performance.now();
    const results = await Promise.allSettled([
      new OpenAiBenchmarkSttProvider("openai_gpt_4o_mini_transcribe", "gpt-4o-mini-transcribe", runtime.openAiApiKey).transcribe({ wav, timeoutMs: runtime.timeoutMs }),
      new OpenAiBenchmarkSttProvider("openai_gpt_4o_transcribe", "gpt-4o-transcribe", runtime.openAiApiKey).transcribe({ wav, timeoutMs: runtime.timeoutMs }),
      new DeepgramSttProvider(runtime.deepgramApiKey).transcribe({ wav, timeoutMs: runtime.timeoutMs }),
    ]);
    const benchmarkLatencyMs = Math.round(performance.now() - startedAt);
    const candidates = results.map(serialiseResult);
    console.info(JSON.stringify({ event: "guest_ai_stt_benchmark", turn_id: valid.turnId, audio_bytes: valid.byteCount, audio_duration_ms: valid.durationMs, candidate_count: candidates.length, success_count: candidates.filter((item) => item.ok).length, benchmark_latency_ms: benchmarkLatencyMs }));
    return json(request, { ok: true, stage: "stt_benchmark", turn_id: valid.turnId, audio_duration_ms: valid.durationMs, audio_bytes: valid.byteCount, benchmark_latency_ms: benchmarkLatencyMs, candidates });
  } catch (cause) {
    const known = cause instanceof SttRequestError ? cause : new SttRequestError("stt_benchmark_failed", "Speech transcription benchmark failed.", 502);
    console.info(JSON.stringify({ event: "guest_ai_stt_benchmark", turn_id: metadata.turnId || null, success: false, error_code: known.code }));
    return errorResponse(request, metadata.turnId || null, known.code, known.message, known.status);
  }
});
