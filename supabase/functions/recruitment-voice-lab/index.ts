import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.4";
import { interviewerProfile } from "../recruitment-realtime/voice.ts";
import { cachedSample, sampleKey } from "./cache.ts";
import { sampleRequest, samples, wav } from "./samples.ts";

const staging = "https://ujkzdaaadnvcfayuldmh.supabase.co";
const origins = new Set([
  "https://fnb-system-staging.vercel.app",
  "http://localhost:5173",
]);
function headers(request: Request) {
  return {
    "Access-Control-Allow-Origin": origins.has(
      request.headers.get("origin") || "",
    )
      ? request.headers.get("origin")!
      : "https://fnb-system-staging.vercel.app",
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
}
function error(request: Request, message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...headers(request), "Content-Type": "application/json" },
  });
}

// Disposable output-only Realtime session for a fixed sample, independent of
// interview transports. Credentials and provider events never reach the UI.
async function generate(
  secret: string,
  signal: AbortSignal,
): Promise<Uint8Array> {
  return await new Promise((resolve, reject) => {
    const socket = new WebSocket(
      "wss://api.openai.com/v1/realtime?model=gpt-realtime-1.5",
      ["realtime", "openai-insecure-api-key." + secret],
    );
    const parts: Uint8Array[] = [];
    let bytes = 0,
      settled = false;
    const finish = (reason?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      socket.close();
      reason ? reject(reason) : resolve(wav(parts));
    };
    const abort = () => finish(new Error("Sample request cancelled."));
    const timer = setTimeout(
      () => finish(new Error("Voice sample timed out. Please retry.")),
      40000,
    );
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    socket.onmessage = ({ data }) => {
      try {
        const event = JSON.parse(data);
        if (event.type === "session.created")
          socket.send(JSON.stringify({ type: "response.create" }));
        if (event.type === "response.output_audio.delta") {
          const part = Uint8Array.from(atob(event.delta), (c) =>
            c.charCodeAt(0),
          );
          bytes += part.length;
          if (bytes > 24000 * 2 * 40) {
            finish(new Error("Voice sample exceeded its limit."));
            return;
          }
          parts.push(part);
        }
        if (event.type === "error")
          finish(
            new Error(
              "The voice provider could not generate this sample. Please retry.",
            ),
          );
        if (event.type === "response.done")
          finish(
            event.response?.status === "completed" && bytes > 0
              ? undefined
              : new Error("Voice sample was incomplete. Please retry."),
          );
      } catch {
        finish(new Error("Voice sample could not be read."));
      }
    };
    socket.onerror = () =>
      finish(new Error("Voice sample connection failed. Please retry."));
    socket.onclose = () => {
      if (!settled)
        finish(new Error("Voice sample connection ended. Please retry."));
    };
  });
}
Deno.serve(async (request) => {
  const url = Deno.env.get("SUPABASE_URL") || Deno.env.get("PROJECT_URL");
  if (url !== staging)
    return error(request, "Voice Lab is available on Staging only.", 403);
  if (request.method === "OPTIONS")
    return new Response("ok", { headers: headers(request) });
  if (request.method !== "POST")
    return error(request, "Method not allowed.", 405);
  const origin = request.headers.get("origin");
  if (origin && !origins.has(origin))
    return error(request, "Origin unavailable.", 403);
  const auth = request.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer "))
    return error(request, "Sign in to Recruitment to use Voice Lab.", 401);
  const anon =
    Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("PROJECT_ANON_KEY");
  const caller = createClient(url, anon!, {
    global: {
      headers: { Authorization: auth },
      fetch: (input, init) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(5000) }),
    },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    const { data: user, error: authError } = await caller.auth.getUser(
      auth.slice(7),
    );
    if (authError || !user.user)
      return error(request, "Sign in to Recruitment to use Voice Lab.", 401);
    const { data: allowed, error: denied } = await caller
      .rpc("current_user_has_permission", {
        permission_code: "recruitment.manage",
      })
      .abortSignal(AbortSignal.timeout(5000));
    if (denied || allowed !== true)
      return error(request, "Recruitment management access is required.", 403);
    const input = sampleRequest(await request.json());
    const serviceKey =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
      Deno.env.get("PROJECT_SERVICE_ROLE_KEY");
    if (!serviceKey)
      return error(request, "Voice sample storage is unavailable.", 503);
    const service = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init) =>
          fetch(input, { ...init, signal: AbortSignal.timeout(7000) }),
      },
    });
    const keyId = await sampleKey(input.voice, input.language),
      path = `${keyId}.wav`;
    const bucket = service.storage.from("recruitment-voice-samples");
    const audio = await cachedSample({
      key: keyId,
      read: async () => {
        const { data, error: failure } = await bucket.download(path);
        if (failure) {
          if (
            String(failure.statusCode) === "404" ||
            /object not found|not found/i.test(failure.message)
          )
            return null;
          throw new Error(
            "Voice sample storage is unavailable. No new audio was generated.",
          );
        }
        if (!data || data.size < 44)
          throw new Error("Stored voice sample is invalid.");
        return new Uint8Array(await data.arrayBuffer());
      },
      claim: async (owner) => {
        const { data, error: failure } = await service.rpc(
          "recruitment_claim_voice_sample",
          { p_key: keyId, p_owner: owner },
        );
        if (failure) throw new Error("Voice sample cache is unavailable.");
        return data === true;
      },
      write: async (audio) => {
        const { error: failure } = await bucket.upload(path, audio, {
          contentType: "audio/wav",
          upsert: false,
        });
        if (failure)
          throw new Error(
            "Generated sample could not be stored. Please retry.",
          );
      },
      release: async (owner) => {
        const { error: failure } = await service
          .from("recruitment_voice_sample_jobs")
          .delete()
          .eq("sample_key", keyId)
          .eq("owner", owner);
        if (failure) throw failure;
      },
      generate: async () => {
        const key = Deno.env.get("OPENAI_API_KEY");
        if (!key) throw new Error("Voice samples are unavailable.");
        const response = await fetch(
          "https://api.openai.com/v1/realtime/client_secrets",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${key}`,
              "Content-Type": "application/json",
            },
            signal: AbortSignal.timeout(10000),
            body: JSON.stringify({
              expires_after: { anchor: "created_at", seconds: 60 },
              session: {
                type: "realtime",
                model: "gpt-realtime-1.5",
                output_modalities: ["audio"],
                tools: [],
                instructions: `${interviewerProfile.instructions}\nThis is a controlled voice comparison, not a live interview. Read the following sample verbatim once, in ${input.language === "yue" ? "Cantonese, not Mandarin" : input.language}. Do not translate, introduce extra content or answer the sample question. SAMPLE:\n${samples[input.language]}`,
                audio: {
                  input: { turn_detection: null },
                  output: {
                    voice: input.voice,
                    format: { type: "audio/pcm", rate: 24000 },
                  },
                },
              },
            }),
          },
        );
        if (!response.ok)
          throw new Error("The voice provider is unavailable. Please retry.");
        const secret = await response.json();
        if (!secret.value) throw new Error("Voice samples are unavailable.");
        return await generate(secret.value, AbortSignal.timeout(45000));
      },
    });
    return new Response(audio, {
      headers: {
        ...headers(request),
        "Content-Type": "application/octet-stream",
        "Content-Disposition": "inline; filename=voice-sample.wav",
      },
    });
  } catch (cause) {
    return error(
      request,
      cause instanceof Error
        ? cause.message
        : "Voice sample failed or timed out. Please retry.",
      cause instanceof Error &&
        cause.message === "Choose an available voice and language."
        ? 400
        : 502,
    );
  }
});
