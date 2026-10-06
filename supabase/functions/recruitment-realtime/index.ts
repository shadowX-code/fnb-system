import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.4";
import {
  interviewInstructions,
  firstInterviewResponse,
  type InterviewContext,
} from "./prompt.ts";
import { continuationContext } from "./context.ts";
import { interviewerProfile } from "./voice.ts";

const allowedOrigins = new Set([
  "https://interview.feedx.my",
  "https://fnb-system-staging.vercel.app",
  "http://localhost:5173",
]);

function cors(request: Request) {
  const origin = request.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin)
      ? origin
      : "https://interview.feedx.my",
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

function json(request: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors(request),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

const tokenPattern = /^[0-9a-f]{64}$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async (request) => {
  if (request.method === "OPTIONS")
    return new Response("ok", { headers: cors(request) });
  if (request.method !== "POST")
    return json(request, { error: "Method not allowed." }, 405);
  const origin = request.headers.get("origin") || "";
  if (origin && !allowedOrigins.has(origin))
    return json(request, { error: "Origin unavailable." }, 403);

  const body = await request.json().catch(() => ({}));
  const token = typeof body.token === "string" ? body.token : "";
  const clientId = typeof body.client_id === "string" ? body.client_id : "";
  if (!tokenPattern.test(token) || !uuidPattern.test(clientId))
    return json(request, { error: "Interview request is invalid." }, 400);

  const url = Deno.env.get("SUPABASE_URL") || Deno.env.get("PROJECT_URL");
  const serviceKey =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
    Deno.env.get("PROJECT_SERVICE_ROLE_KEY");
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!url || !serviceKey || !openaiKey)
    return json(request, { error: "Interview service is unavailable." }, 503);

  const service = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  if (body.action === "context") {
    const { data: state, error } = await service.rpc(
      "recruitment_assessment_context",
      { p_token: token, p_client_id: clientId },
    );
    if (error || !state?.attempt_id)
      return json(request, { error: "Interview context unavailable." }, 403);
    const { data: attempt } = await service
      .from("recruitment_interview_attempts")
      .select(
        "recovery_id,provider_generation,paused_at,config_version_id,application_id,preferred_language",
      )
      .eq("id", state.attempt_id)
      .single();
    if (
      !attempt ||
      attempt.recovery_id !== body.recovery_id ||
      attempt.provider_generation !== body.generation ||
      attempt.paused_at ||
      state.status !== "interviewing"
    )
      return json(request, { error: "Interview was replaced." }, 409);
    const [
      { data: config },
      { data: opening },
      { data: annotations, error: annotationError },
    ] = await Promise.all([
      service
        .from("recruitment_interview_configs")
        .select(
          "job_facts,job_context,employment_offerings,target_minutes,required_topics,scenario_briefs,language_guidance,interview_instructions,opening_requirements,interview_profile:recruitment_interview_profiles(name,version,definition)",
        )
        .eq("id", attempt.config_version_id)
        .single(),
      service
        .from("recruitment_applications")
        .select(
          "opening_title_snapshot,opening_description_snapshot,position_snapshot,workplace_snapshot,employment_preference",
        )
        .eq("id", attempt.application_id)
        .single(),
      service
        .from("recruitment_transcript_annotations")
        .select("provider_generation,provider_item_id,kind")
        .eq("attempt_id", state.attempt_id),
    ]);
    if (!config || !opening || annotationError)
      return json(request, { error: "Interview context unavailable." }, 503);
    // Revalidate ownership after the reads; a replaced browser must not receive
    // a new context update for the current generation.
    const { data: current } = await service
      .from("recruitment_interview_attempts")
      .select("recovery_id,provider_generation,paused_at")
      .eq("id", state.attempt_id)
      .single();
    if (
      current?.recovery_id !== body.recovery_id ||
      current?.provider_generation !== body.generation ||
      current?.paused_at
    )
      return json(request, { error: "Interview was replaced." }, 409);
    return json(request, {
      generation: attempt.provider_generation,
      instructions: interviewInstructions(
        continuationContext(state, attempt, config, opening, annotations || []),
      ),
    });
  }
  const { data, error } = await service.rpc(
    body.recovery_id
      ? "recruitment_recovery_context"
      : "recruitment_realtime_context",
    {
      p_token: token,
      p_client_id: clientId,
      ...(body.recovery_id ? { p_request_id: body.recovery_id } : {}),
    },
  );
  if (error || !data?.attempt_id)
    return json(request, { error: "Interview session is unavailable." }, 403);

  const context = data as InterviewContext & {
    attempt_id: string;
    max_ends_at: string;
  };
  const { data: role } = await service
    .from("recruitment_interview_attempts")
    .select(
      "preferred_language,application:recruitment_applications(position_snapshot,workplace_snapshot,employment_preference),config:recruitment_interview_configs(job_facts,job_context,employment_offerings,opening_requirements,interview_profile:recruitment_interview_profiles(name,version,definition))",
    )
    .eq("id", context.attempt_id)
    .single();
  context.preferred_language = role?.preferred_language || "en";
  if (!role?.application)
    return json(request, { error: "Interview context unavailable." }, 503);
  context.employment_preference = role.application.employment_preference;
  if (role?.application)
    context.opening = {
      ...context.opening,
      position: role.application.position_snapshot,
      workplace: role.application.workplace_snapshot,
    };
  if (role?.config) {
    context.job_facts = role.config.job_facts;
    context.job_context = role.config.job_context;
    context.employment_offerings = role.config.employment_offerings;
    context.interview_profile = role.config.interview_profile;
    context.opening_requirements = role.config.opening_requirements;
  }
  const { data: durable, error: durableError } = await service.rpc(
    "recruitment_assessment_context",
    { p_token: token, p_client_id: clientId },
  );
  if (durableError)
    return json(request, { error: "Interview context unavailable." }, 503);
  context.current_findings = durable.current_findings || [];
  context.job_facts = durable.job_facts || context.job_facts;
  context.scenarios = context.scenarios.map((s: any) => ({
    ...s,
    state: durable.scenarios.find((d: any) => d.scenario_index === s.index)
      ?.equivalent_turn_id
      ? "equivalent real evidence"
      : s.state,
  }));
  const remainingSeconds = Math.max(
    1,
    Math.floor((Date.parse(context.max_ends_at) - Date.now()) / 1000),
  );
  if (remainingSeconds < 20)
    return json(request, { error: "Interview duration has ended." }, 409);

  const safetyData = new TextEncoder().encode(
    `${context.attempt_id}:recruitment`,
  );
  const safetyHash = await crypto.subtle.digest("SHA-256", safetyData);
  const safetyId = [...new Uint8Array(safetyHash)]
    .map((part) => part.toString(16).padStart(2, "0"))
    .join("");
  const session = {
    expires_after: { anchor: "created_at", seconds: 60 },
    session: {
      type: "realtime",
      model: "gpt-realtime-1.5",
      output_modalities: ["audio"],
      tools: [
        {
          type: "function",
          name: "request_completion",
          description:
            "Request server permission to conclude after collecting required topics and scenario answers. If declined, follow up on the unresolved evidence.",
          parameters: {
            type: "object",
            properties: {},
            required: [],
            additionalProperties: false,
          },
        },
      ],
      instructions: interviewInstructions(context),
      audio: {
        input: {
          transcription: {
            model: "gpt-4o-transcribe",
            prompt:
              "F&B recruitment interview in Malaysia. English, Bahasa Malaysia and Mandarin/Cantonese Chinese, including natural Malaysian code-switching. Preserve the actual words; do not translate or invent speech from silence.",
          },
          noise_reduction: { type: "near_field" },
          turn_detection: {
            type: "semantic_vad",
            eagerness: "low",
            create_response: body.conversation_version === "provider-owned-v1",
            interrupt_response:
              body.conversation_version === "provider-owned-v1",
          },
        },
        output: { voice: interviewerProfile.voice },
      },
    },
  };
  let provider: Response;
  try {
    provider = await fetch(
      "https://api.openai.com/v1/realtime/client_secrets",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openaiKey}`,
          "Content-Type": "application/json",
          "OpenAI-Safety-Identifier": safetyId,
        },
        body: JSON.stringify(session),
        signal: AbortSignal.timeout(10000),
      },
    );
  } catch {
    return json(
      request,
      { error: "Unable to connect to the AI interviewer. Please retry." },
      502,
    );
  }
  if (!provider.ok)
    return json(
      request,
      { error: "Unable to connect to the AI interviewer. Please retry." },
      502,
    );
  const secret = await provider.json().catch(() => null);
  if (!secret?.value || typeof secret.value !== "string")
    return json(
      request,
      { error: "Unable to connect to the AI interviewer. Please retry." },
      502,
    );
  return json(request, {
    value: secret.value,
    expires_at: secret.expires_at,
    generation: context.generation,
    first_response_instructions: firstInterviewResponse(context),
    max_ends_at: context.max_ends_at,
  });
});
