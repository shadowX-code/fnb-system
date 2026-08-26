import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.4";
import { ConversationRequestError, estimateCostUsd, validateConversationRequest } from "./contract.ts";
import { OpenAiConversationProvider } from "./provider.ts";
import { GUEST_AI_CONVERSATION_INSTRUCTIONS } from "./instructions.ts";

const allowedOrigins = new Set(["http://127.0.0.1:5175", "http://localhost:5175", "https://fnb-system-staging.vercel.app"]);
const baseCorsHeaders = { "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" };

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin") || "";
  return { ...baseCorsHeaders, "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "null" };
}
function json(request: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(request), "Cache-Control": "no-store", "Content-Type": "application/json" } });
}
function errorResponse(request: Request, turnId: string | null, code: string, message: string, status: number) {
  return json(request, { ok: false, stage: "llm", turn_id: turnId, error: { code, message } }, status);
}
function positiveBoundedNumber(raw: string | undefined, fallback: number, min: number, max: number) {
  const value = Number(raw ?? fallback);
  return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}
function optionalNonNegativeNumber(raw: string | undefined) {
  if (raw == null || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}
function serverConfig() {
  return {
    supabaseUrl: Deno.env.get("PROJECT_URL") || Deno.env.get("SUPABASE_URL") || "",
    anonKey: Deno.env.get("SUPABASE_ANON_KEY") || "",
    apiKey: Deno.env.get("OPENAI_API_KEY") || "",
    model: Deno.env.get("VOICE_LLM_MODEL") || "gpt-4o-mini",
    timeoutMs: positiveBoundedNumber(Deno.env.get("VOICE_LLM_TIMEOUT_MS"), 15_000, 1_000, 60_000),
    maxOutputTokens: positiveBoundedNumber(Deno.env.get("VOICE_LLM_MAX_OUTPUT_TOKENS"), 32, 16, 32),
    inputUsdPerMillion: optionalNonNegativeNumber(Deno.env.get("VOICE_LLM_INPUT_USD_PER_MILLION_TOKENS")),
    outputUsdPerMillion: optionalNonNegativeNumber(Deno.env.get("VOICE_LLM_OUTPUT_USD_PER_MILLION_TOKENS")),
  };
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin") || "";
  if (origin && !allowedOrigins.has(origin)) return errorResponse(request, null, "origin_not_allowed", "This origin is not permitted for the staging voice runtime.", 403);
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(request) });
  if (request.method !== "POST") return errorResponse(request, null, "method_not_allowed", "Only POST is supported.", 405);

  let raw: Record<string, unknown> = {};
  try { raw = await request.json(); } catch { return errorResponse(request, null, "request_invalid", "Conversation request must be valid JSON.", 400); }
  const turnId = typeof raw.turn_id === "string" ? raw.turn_id : null;
  const config = serverConfig();
  if (!config.supabaseUrl || !config.anonKey) return errorResponse(request, turnId, "service_not_configured", "Voice runtime authentication is not configured.", 503);
  if (!config.apiKey) return errorResponse(request, turnId, "provider_not_configured", "Conversation provider is not configured.", 503);
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) return errorResponse(request, turnId, "authentication_required", "Sign in is required.", 401);
  const authClient = createClient(config.supabaseUrl, config.anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await authClient.auth.getUser();
  if (authError || !authData.user) return errorResponse(request, turnId, "authentication_required", "Your session is not valid.", 401);

  try {
    const valid = validateConversationRequest(raw);
    const requestStartedAt = performance.now();
    const result = await new OpenAiConversationProvider().reply({ transcript: valid.transcript, context: valid.context, apiKey: config.apiKey, model: config.model, timeoutMs: config.timeoutMs, maxOutputTokens: config.maxOutputTokens, instructions: GUEST_AI_CONVERSATION_INSTRUCTIONS });
    const llmLatencyMs = Math.round(performance.now() - requestStartedAt);
    const estimatedCostUsd = estimateCostUsd(result.usage, config.inputUsdPerMillion, config.outputUsdPerMillion);
    console.info(JSON.stringify({ event: "guest_ai_reply", turn_id: valid.turnId, transcript_length: valid.transcript.length, context_message_count: valid.context.length, reply_length: result.replyText.length, llm_latency_ms: llmLatencyMs, provider_response_ms: result.providerResponseMs, model: config.model, input_tokens: result.usage?.input_tokens ?? null, output_tokens: result.usage?.output_tokens ?? null, estimated_cost_usd: estimatedCostUsd, outcome: "replied" }));
    return json(request, { ok: true, stage: "llm", status: "completed", turn_id: valid.turnId, transcript: valid.transcript, reply_text: result.replyText, provider: "openai", model: config.model, llm_latency_ms: llmLatencyMs, provider_response_ms: result.providerResponseMs, usage: result.usage, estimated_cost_usd: estimatedCostUsd });
  } catch (cause) {
    const known = cause instanceof ConversationRequestError ? cause : new ConversationRequestError("llm_failed", "Conversation reply failed.", 502);
    console.info(JSON.stringify({ event: "guest_ai_reply", turn_id: turnId, success: false, error_code: known.code }));
    return errorResponse(request, turnId, known.code, known.message, known.status);
  }
});
