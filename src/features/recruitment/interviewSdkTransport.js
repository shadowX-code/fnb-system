import { bounded } from "./interviewRecovery.js";

// Use the existing Recruitment QA opening marker and exact Staging identities.
export function interviewQaTransport(title, location, dataUrl = import.meta.env.VITE_SUPABASE_URL) {
  if (dataUrl !== "https://ujkzdaaadnvcfayuldmh.supabase.co" ||
      location?.origin !== "https://fnb-system-staging.vercel.app" ||
      !/^QA([ :_-]|$)/i.test(title || "")) return undefined;
  const transport = new URLSearchParams(location.search).get("voice-transport");
  return transport === "sdk" || transport === "legacy" ? transport : undefined;
}

const model = "gpt-realtime-1.5";
const confidence = "item.input_audio_transcription.logprobs";
const turnDetection = {
  type: "semantic_vad", eagerness: "low", create_response: false, interrupt_response: false,
};

function controlledPolicyError(session) {
  if (!session) return "ack_missing";
  const input = session.audio?.input;
  if (session.model !== model && !session.model?.startsWith(model + "-")) return "model";
  if (session.tracing != null) return "tracing";
  if (Object.entries(turnDetection).some(([key, value]) => input?.turn_detection?.[key] !== value))
    return "turn_detection";
  if (input?.transcription?.model !== "gpt-4o-transcribe") return "transcription";
  if (input.noise_reduction && input.noise_reduction.type !== "near_field") return "noise_reduction";
  if (session.include && !session.include.includes(confidence)) return "confidence";
  return null;
}

export async function connectInterviewSdk({ signal, mediaStream, audioElement, apiKey, bind, consume, checkpoint = () => {} }) {
  const { OpenAIRealtimeWebRTC } = await import("@openai/agents-realtime");
  signal?.throwIfAborted();
  class InterviewWebRTC extends OpenAIRealtimeWebRTC {
    // FeedX consumes raw events and owns provider context. SDK history lookups
    // can race with FeedX deleting an unverified input item.
    sendEvent(event) {
      if (event.type !== "conversation.item.retrieve") super.sendEvent(event);
    }

    // Preserve the server-pinned prompt, voice, tools and transcription.
    buildSessionPayload() {
      return {
        type: "realtime", tracing: null, include: [confidence],
        audio: { input: { turn_detection: turnDetection, noise_reduction: { type: "near_field" } } },
      };
    }
  }
  let channel;
  let policyError = "ack_missing";
  let acknowledgePolicy;
  const policy = new Promise(resolve => { acknowledgePolicy = resolve; });
  const observePolicy = ({ data }) => {
    let event;
    try { event = JSON.parse(data); } catch { return; }
    if (event?.type !== "session.updated" || signal?.aborted) return;
    policyError = controlledPolicyError(event.session);
    acknowledgePolicy();
  };
  const sdk = new InterviewWebRTC({
    mediaStream, audioElement,
    changePeerConnection(peer) {
      channel = sdk.connectionState.dataChannel;
      // SDK 0.21.0 can resolve connect before its wildcard listener sees the same
      // acknowledgement. Observe the channel before the SDK adds its listeners.
      channel.addEventListener("message", observePolicy);
      bind(peer, channel, sdk);
      return peer;
    },
  });
  sdk.on("*", event => {
    if (signal?.aborted) return;
    consume(event);
  });
  try {
    await bounded(sdk.connect({
      apiKey, model, initialSessionConfig: { tracing: null },
    }), "Interviewer SDK connection", { signal, timeoutMs: 17000 });
    await bounded(policy, "Interviewer SDK voice policy", { signal, timeoutMs: 1000 }).catch(error => {
      if (error.code !== "recovery_timeout") throw error;
    });
    if (policyError) {
      checkpoint("sdk.policy", policyError);
      throw Object.assign(Error("Interviewer SDK did not acknowledge the required voice policy."), {
        code: "sdk_policy_unverified",
      });
    }
    checkpoint("sdk.policy", "dependency_completed");
  } catch (error) {
    try { sdk.close(); } catch { /* Original startup error owns recovery. */ }
    if (signal?.aborted) throw signal.reason;
    // The SDK's SDP error can include provider text. Do not retain it in diagnostics.
    throw Object.assign(Error("Interviewer SDK could not connect."), {
      code: ["sdk_policy_unverified", "recovery_timeout"].includes(error.code)
        ? error.code : "sdk_connection_failed",
    });
  } finally {
    channel?.removeEventListener("message", observePolicy);
  }
}

// Receive energy is an audio onset proxy, not proof of speaker output or hearing.
export function observeRemoteAudio(peer, track, audio, onSignal) {
  const receiver = peer?.getReceivers?.().find(r => r.track === track);
  if (!receiver?.getStats) return () => {};
  let stopped = false, timer, lastEnergy;
  const deadline = performance.now() + 10000;
  const stop = () => { stopped = true; clearTimeout(timer); };
  const sample = async () => {
    try {
      const stats = await receiver.getStats();
      if (stopped) return;
      const energy = [...stats.values()].find(s => s.type === "inbound-rtp" &&
        (s.kind ?? s.mediaType) === "audio")?.totalAudioEnergy;
      if (Number.isFinite(energy) && Number.isFinite(lastEnergy) && energy > lastEnergy &&
          !audio.paused && !audio.muted && audio.volume > 0 && !track.muted) {
        stop();
        onSignal();
        return;
      }
      lastEnergy = energy;
      if (performance.now() < deadline) timer = setTimeout(sample, 50);
    } catch { stop(); }
  };
  void sample();
  return stop;
}
