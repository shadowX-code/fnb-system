import { bounded } from "./interviewRecovery.js";

// Use the existing Recruitment QA opening marker and exact Staging identities.
export function interviewQaTransport(title, location, dataUrl = import.meta.env.VITE_SUPABASE_URL) {
  if (dataUrl !== "https://ujkzdaaadnvcfayuldmh.supabase.co" ||
      location?.origin !== "https://fnb-system-staging.vercel.app" ||
      !/^QA([ :_-]|$)/i.test(title || "")) return undefined;
  const transport = new URLSearchParams(location.search).get("voice-transport");
  return transport === "sdk" || transport === "legacy" ? transport : undefined;
}

function hasControlledPolicy(session) {
  const input = session?.audio?.input;
  const vad = input?.turn_detection;
  return session?.model === "gpt-realtime-1.5" && session.tracing === null &&
    vad?.type === "semantic_vad" && vad.eagerness === "low" &&
    vad.create_response === false && vad.interrupt_response === false &&
    input.transcription?.model === "gpt-4o-transcribe" &&
    input.noise_reduction?.type === "near_field" &&
    session.include?.includes("item.input_audio_transcription.logprobs");
}

export async function connectInterviewSdk({ signal, mediaStream, audioElement, apiKey, bind, consume }) {
  const { OpenAIRealtimeWebRTC } = await import("@openai/agents-realtime");
  signal?.throwIfAborted();
  class InterviewWebRTC extends OpenAIRealtimeWebRTC {
    // The ephemeral secret already carries the server-owned configuration.
    // In 0.21.0, the base serializer would send its own transcription and VAD defaults.
    buildSessionPayload() { return { type: "realtime", tracing: null }; }
  }
  const sdk = new InterviewWebRTC({
    mediaStream, audioElement,
    changePeerConnection(peer) {
      bind(peer, sdk.connectionState.dataChannel, sdk);
      return peer;
    },
  });
  let acknowledged = false;
  sdk.on("*", event => {
    if (signal?.aborted) return;
    if (event.type === "session.updated") acknowledged = hasControlledPolicy(event.session);
    consume(event);
  });
  try {
    await bounded(sdk.connect({
      apiKey, model: "gpt-realtime-1.5", initialSessionConfig: { tracing: null },
    }), "Interviewer SDK connection", { signal, timeoutMs: 17000 });
    if (!acknowledged) throw Error("Interviewer SDK did not acknowledge the required voice policy.");
  } catch (error) {
    try { sdk.close(); } catch { /* Original startup error owns recovery. */ }
    if (signal?.aborted) throw signal.reason;
    // The SDK's SDP error can include provider text. Do not retain it in diagnostics.
    throw Object.assign(Error("Interviewer SDK could not connect with the required voice policy."), {
      code: acknowledged ? "sdk_connection_failed" : "sdk_policy_unverified",
      ...(error.code === "dependency_timeout" ? { code: error.code } : {}),
    });
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
