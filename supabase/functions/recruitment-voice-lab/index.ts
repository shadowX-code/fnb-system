import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.4";
import { interviewerProfile } from "../recruitment-realtime/voice.ts";
import { sampleRequest, samples, wav } from "./samples.ts";

const staging = "https://ujkzdaaadnvcfayuldmh.supabase.co";
const origins = new Set(["https://fnb-system-staging.vercel.app", "http://localhost:5173"]);
function headers(request: Request) { return { "Access-Control-Allow-Origin": origins.has(request.headers.get("origin") || "") ? request.headers.get("origin")! : "https://fnb-system-staging.vercel.app", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS", "Cache-Control": "no-store", Vary: "Origin" }; }
function error(request: Request, message: string, status: number) { return new Response(JSON.stringify({error: message}), {status, headers: {...headers(request), "Content-Type": "application/json"}}); }

// Disposable output-only Realtime session for a fixed sample, independent of
// interview transports. Credentials and provider events never reach the UI.
async function generate(secret: string, signal: AbortSignal): Promise<Uint8Array> {
  return await new Promise((resolve, reject) => {
    const socket = new WebSocket("wss://api.openai.com/v1/realtime?model=gpt-realtime-1.5", ["realtime", "openai-insecure-api-key." + secret]);
    const parts: Uint8Array[] = []; let bytes = 0, settled = false;
    const finish = (reason?: Error) => { if (settled) return; settled = true; clearTimeout(timer); signal.removeEventListener("abort", abort); socket.close(); reason ? reject(reason) : resolve(wav(parts)); };
    const abort = () => finish(new Error("Sample request cancelled."));
    const timer = setTimeout(() => finish(new Error("Voice sample timed out. Please retry.")), 40000);
    signal.addEventListener("abort", abort, {once: true});
    if (signal.aborted) { abort(); return; }
    socket.onmessage = ({data}) => {
      try {
        const event = JSON.parse(data);
        if (event.type === "session.created") socket.send(JSON.stringify({type: "response.create"}));
        if (event.type === "response.output_audio.delta") {
          const part = Uint8Array.from(atob(event.delta), c => c.charCodeAt(0)); bytes += part.length;
          if (bytes > 24000 * 2 * 40) { finish(new Error("Voice sample exceeded its limit.")); return; }
          parts.push(part);
        }
        if (event.type === "error") finish(new Error("The voice provider could not generate this sample. Please retry."));
        if (event.type === "response.done") finish(event.response?.status === "completed" && bytes > 0 ? undefined : new Error("Voice sample was incomplete. Please retry."));
      } catch { finish(new Error("Voice sample could not be read.")); }
    };
    socket.onerror = () => finish(new Error("Voice sample connection failed. Please retry."));
    socket.onclose = () => { if (!settled) finish(new Error("Voice sample connection ended. Please retry.")); };
  });
}
Deno.serve(async request => {
  const url = Deno.env.get("SUPABASE_URL") || Deno.env.get("PROJECT_URL");
  if (url !== staging) return error(request, "Voice Lab is available on Staging only.", 403);
  if (request.method === "OPTIONS") return new Response("ok", {headers: headers(request)});
  if (request.method !== "POST") return error(request, "Method not allowed.", 405);
  const origin = request.headers.get("origin");
  if (origin && !origins.has(origin)) return error(request, "Origin unavailable.", 403);
  const auth = request.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return error(request, "Sign in to Recruitment to use Voice Lab.", 401);
  const anon = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("PROJECT_ANON_KEY");
  const caller = createClient(url, anon!, {global: {headers: {Authorization: auth}, fetch: (input, init) => fetch(input, {...init, signal: AbortSignal.timeout(5000)})}, auth: {persistSession: false, autoRefreshToken: false}});
  try {
    const {data: user, error: authError} = await caller.auth.getUser(auth.slice(7));
    if (authError || !user.user) return error(request, "Sign in to Recruitment to use Voice Lab.", 401);
    const {data: allowed, error: denied} = await caller.rpc("current_user_has_permission", {permission_code: "recruitment.manage"}).abortSignal(AbortSignal.timeout(5000));
    if (denied || allowed !== true) return error(request, "Recruitment management access is required.", 403);
    const input = sampleRequest(await request.json());
    const key = Deno.env.get("OPENAI_API_KEY");
    if (!key) return error(request, "Voice samples are unavailable.", 503);
    const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {method: "POST", headers: {Authorization: `Bearer ${key}`, "Content-Type": "application/json"}, signal: AbortSignal.timeout(10000), body: JSON.stringify({expires_after: {anchor: "created_at", seconds: 60}, session: {type: "realtime", model: "gpt-realtime-1.5", output_modalities: ["audio"], tools: [], instructions: `${interviewerProfile.instructions}\nThis is a controlled voice comparison, not a live interview. Read the following sample verbatim once, in ${input.language === "yue" ? "Cantonese, not Mandarin" : input.language}. Do not translate, introduce extra content or answer the sample question. SAMPLE:\n${samples[input.language]}`, audio: {input: {turn_detection: null}, output: {voice: input.voice, format: {type: "audio/pcm", rate: 24000}}}}})});
    if (!response.ok) return error(request, "The voice provider is unavailable. Please retry.", 502);
    const secret = await response.json();
    if (!secret.value) return error(request, "Voice samples are unavailable.", 502);
    const audio = await generate(secret.value, request.signal);
    return new Response(audio, {headers: {...headers(request), "Content-Type": "audio/wav"}});
  } catch (cause) {
    return error(request, cause instanceof Error && cause.message === "Choose an available voice and language." ? cause.message : "Voice sample failed or timed out. Please retry.", cause instanceof Error && cause.message === "Choose an available voice and language." ? 400 : 502);
  }
});
