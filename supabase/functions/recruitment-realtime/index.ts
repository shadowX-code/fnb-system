import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.4";
import {
  interviewInstructions,
  firstInterviewResponse,
  type InterviewContext,
} from "./prompt.ts";
import { continuationContext } from "./context.ts";
import { interviewerProfile } from "./voice.ts";
import { interviewTurnDetection } from "./turnDetection.ts";

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

const stagingOrigin = "https://fnb-system-staging.vercel.app";
const stagingProject = "https://ujkzdaaadnvcfayuldmh.supabase.co";

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

  const continuity = body.orientation_version === "continuity-v2";
  const orientationEnabled = continuity || body.orientation_version === "receipt-v1";
  const url = Deno.env.get("SUPABASE_URL") || Deno.env.get("PROJECT_URL");
  const serviceKey =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
    Deno.env.get("PROJECT_SERVICE_ROLE_KEY");
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  const naturalQa = body.conversation_version === "natural-qa-v1";
  if (naturalQa && (url !== stagingProject || origin !== stagingOrigin || !continuity || !body.recovery_id))
    return json(request, { error: "Interview policy is unavailable." }, 403);
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
      { data: traces, error: traceError },
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
      service.from("recruitment_realtime_traces").select("provider_generation,record")
        .eq("attempt_id", state.attempt_id).in("record->>phase", ["orientation_pending", "orientation_complete"]),
    ]);
    if (!config || !opening || annotationError || traceError)
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
    const context = continuationContext(state, attempt, config, opening, annotations || [], traces || []);
    if (continuity) context.conversation_protocol = "continuity-v2";
    if (!orientationEnabled) { delete context.orientation_complete; delete context.orientation_presented; }
    return json(request, {
      generation: attempt.provider_generation,
      instructions: interviewInstructions(context),
    });
  }
  if (naturalQa) {
    const { data: attempt, error: attemptError } = await service.rpc("recruitment_public_attempt", { p_token: token });
    const { data: opening } = attempt?.opening_id
      ? await service.from("recruitment_openings").select("test_profile_id").eq("id", attempt.opening_id).single()
      : { data: null };
    if (attemptError || !opening?.test_profile_id)
      return json(request, { error: "Interview policy is unavailable." }, 403);
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
      "preferred_language,opening_id,application_id,opening:recruitment_openings(test_profile_id),application:recruitment_applications(position_snapshot,workplace_snapshot,employment_preference),config:recruitment_interview_configs(job_facts,job_context,employment_offerings,opening_requirements,interview_profile:recruitment_interview_profiles(name,version,definition))",
    )
    .eq("id", context.attempt_id)
    .single();
  context.preferred_language = role?.preferred_language || "en";
  if (!role?.application)
    return json(request, { error: "Interview context unavailable." }, 503);
  const opening = Array.isArray(role.opening) ? role.opening[0] : role.opening;
  if (naturalQa && !opening?.test_profile_id)
    return json(request, { error: "Interview policy is unavailable." }, 403);
  if (opening?.test_profile_id && url === stagingProject) {
    const { data: prior, error: priorError } = await service.from("recruitment_events").select("id")
      .eq("attempt_id", context.attempt_id).eq("action", "natural_voice_qa").limit(1);
    if (priorError || (!naturalQa && prior?.length))
      return json(request, { error: "Use the original QA interview link." }, 409);
    // A fresh test attempt gets pinned before any Realtime secret can be issued.
    if (naturalQa && !prior?.length) {
      if (context.generation !== 1)
        return json(request, { error: "Start Natural QA with a fresh test invitation." }, 409);
      const { error: pinError } = await service.from("recruitment_events").insert({
        attempt_id: context.attempt_id, opening_id: role.opening_id, application_id: role.application_id,
        action: "natural_voice_qa", details: { generation: context.generation },
      });
      if (pinError) return json(request, { error: "Interview policy is unavailable." }, 503);
    }
  }
  context.natural_qa = naturalQa;
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
  const [{ data: annotations, error: annotationError }, { data: traces, error: traceError }, { data: connections, error: connectionError }] = await Promise.all([
    service.from("recruitment_transcript_annotations").select("provider_generation,provider_item_id,kind").eq("attempt_id", context.attempt_id),
    service.from("recruitment_realtime_traces").select("provider_generation,record").eq("attempt_id", context.attempt_id).in("record->>phase", ["orientation_pending", "orientation_complete"]),
    service.from("recruitment_events").select("id").eq("attempt_id", context.attempt_id).eq("action", "provider_connected").limit(1),
  ]);
  if (annotationError || traceError || connectionError) return json(request, {error:"Interview context unavailable."}, 503);
  const continuation = continuationContext(durable, {provider_generation:context.generation,preferred_language:context.preferred_language},
    {...context,interview_profile:context.interview_profile},
    {...context.opening, employment_preference:context.employment_preference}, annotations || [], traces || []);
  if (continuity) {
    context.conversation_protocol = "continuity-v2";
    context.has_connected = Boolean(connections?.length);
  }
  if (orientationEnabled) { context.orientation_complete = continuation.orientation_complete; context.orientation_presented = continuation.orientation_presented; }
  context.turns = continuation.turns;
  if (naturalQa && context.has_connected) {
    const { data: dialogue, error: dialogueError } = await service
      .from("recruitment_transcript_turns")
      .select("speaker,transcript,turn_number,provider_generation,provider_item_id")
      .eq("attempt_id", context.attempt_id)
      .lt("provider_generation", context.generation)
      .order("turn_number", { ascending: false })
      .limit(16);
    if (dialogueError) return json(request, { error: "Interview context unavailable." }, 503);
    const unavailable = new Set((annotations || [])
      .filter(a => a.kind === "truncated" || a.kind === "transcription_failed")
      .map(a => `${a.provider_generation}:${a.provider_item_id}`));
    context.provisional_dialogue = (dialogue || []).reverse()
      .filter(t => !unavailable.has(`${t.provider_generation}:${t.provider_item_id}`))
      .map(({ speaker, transcript, turn_number }) => ({ speaker, transcript: transcript.slice(0, 1500), turn_number }));
  }
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
      tools: naturalQa ? [] : [
        ...(orientationEnabled && !continuity ? [{
          type:"function",name:"confirm_orientation",
          description:"Silently confirm presentation only in the same response after speaking the workplace, position, confirmed role scope, approximate duration and self-introduction invitation. Then listen, without more speech. Never use a short Hello/Hi/OK as a substitute for the required orientation. This is not evidence coverage or completion permission.",
          parameters:{type:"object",properties:{},required:[],additionalProperties:false},
        }] : []),
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
      ...((naturalQa || body.conversation_version === "controlled-auto-v1") ? {include:["item.input_audio_transcription.logprobs"]} : {}),
      audio: {
        input: {
          transcription: {
            model: "gpt-4o-transcribe",
            prompt:
              "F&B recruitment interview in Malaysia. English, Bahasa Malaysia and Mandarin/Cantonese Chinese, including natural Malaysian code-switching. Preserve the actual words; do not translate or invent speech from silence.",
          },
          noise_reduction: { type: "near_field" },
          turn_detection: interviewTurnDetection(body.conversation_version),
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
    turn_policy: ["natural-qa-v1","controlled-auto-v1","controlled-turns-v1"].includes(body.conversation_version) ? body.conversation_version : "provider-owned-v1",
    conversation_protocol: continuity ? "continuity-v2" : "receipt-v1",
    orientation_required: !continuity && orientationEnabled && !context.orientation_complete && !context.orientation_presented,
    introduction_pending: !continuity && orientationEnabled && context.orientation_presented && !context.orientation_complete,
    conversation_instructions: interviewInstructions(context),
    first_response_instructions: firstInterviewResponse(context),
    max_ends_at: context.max_ends_at,
  });
});
