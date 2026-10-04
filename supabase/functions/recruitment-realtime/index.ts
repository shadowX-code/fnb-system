import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.4";
import { interviewInstructions, firstInterviewResponse, type InterviewContext } from "./prompt.ts";
import { interviewerProfile } from "./voice.ts";

const allowedOrigins = new Set([
  "https://interview.feedx.my",
  "https://fnb-system-staging.vercel.app",
  "http://localhost:5173",
]);

function cors(request: Request) {
  const origin = request.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://interview.feedx.my",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(request: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(request), "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

const tokenPattern = /^[0-9a-f]{64}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors(request) });
  if (request.method !== "POST") return json(request, { error: "Method not allowed." }, 405);
  const origin = request.headers.get("origin") || "";
  if (origin && !allowedOrigins.has(origin)) return json(request, { error: "Origin unavailable." }, 403);

  const body = await request.json().catch(() => ({}));
  const token = typeof body.token === "string" ? body.token : "";
  const clientId = typeof body.client_id === "string" ? body.client_id : "";
  if (!tokenPattern.test(token) || !uuidPattern.test(clientId)) return json(request, { error: "Interview request is invalid." }, 400);

  const url = Deno.env.get("SUPABASE_URL") || Deno.env.get("PROJECT_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("PROJECT_SERVICE_ROLE_KEY");
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!url || !serviceKey || !openaiKey) return json(request, { error: "Interview service is unavailable." }, 503);

  const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await service.rpc(body.recovery_id ? "recruitment_recovery_context" : "recruitment_realtime_context", { p_token: token, p_client_id: clientId, ...(body.recovery_id ? {p_request_id:body.recovery_id} : {}) });
  if (error || !data?.attempt_id) return json(request, { error: "Interview session is unavailable." }, 403);

  const context = data as InterviewContext & { attempt_id: string; max_ends_at: string };
  const remainingSeconds = Math.max(1, Math.floor((Date.parse(context.max_ends_at) - Date.now()) / 1000));
  if (remainingSeconds < 20) return json(request, { error: "Interview duration has ended." }, 409);

  const safetyData = new TextEncoder().encode(`${context.attempt_id}:recruitment`);
  const safetyHash = await crypto.subtle.digest("SHA-256", safetyData);
  const safetyId = [...new Uint8Array(safetyHash)].map((part) => part.toString(16).padStart(2, "0")).join("");
  const session = {
    expires_after: { anchor: "created_at", seconds: 60 },
    session: {
      type: "realtime",
      model: "gpt-realtime-1.5",
      output_modalities: ["audio"],
      tools: [{ type: "function", name: "request_completion", description: "Request server permission to conclude after collecting required topics and scenario answers. If declined, follow up on the unresolved evidence.", parameters: { type: "object", properties: {}, required: [], additionalProperties: false } }],
      instructions: interviewInstructions(context),
      audio: {
        input: {
          transcription: { model: "gpt-4o-transcribe", prompt: "F&B recruitment interview in Malaysia. English, Bahasa Malaysia and Mandarin Chinese, including natural Malaysian code-switching. Preserve the actual words; do not translate or invent speech from silence." },
          noise_reduction: { type: "near_field" },
          turn_detection: { type: "semantic_vad", eagerness: "low", create_response: false, interrupt_response: false },
        },
        output: { voice: interviewerProfile.voice },
      },
    },
  };
  let provider: Response;
  try {
    provider = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: { "Authorization": `Bearer ${openaiKey}`, "Content-Type": "application/json", "OpenAI-Safety-Identifier": safetyId },
      body: JSON.stringify(session),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    return json(request, { error: "Unable to connect to the AI interviewer. Please retry." }, 502);
  }
  if (!provider.ok) return json(request, { error: "Unable to connect to the AI interviewer. Please retry." }, 502);
  const secret = await provider.json().catch(() => null);
  if (!secret?.value || typeof secret.value !== "string") return json(request, { error: "Unable to connect to the AI interviewer. Please retry." }, 502);
  return json(request, { value: secret.value, expires_at: secret.expires_at, generation: context.generation, first_response_instructions: firstInterviewResponse(context), max_ends_at: context.max_ends_at });
});
