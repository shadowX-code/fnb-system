import { Bot, Camera, ChevronDown, ChevronLeft, ChevronRight, Eye, Mic, RotateCcw, Smile, Volume2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Card from "../../../components/ui/Card.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import { ROBOT_GAZES } from "../robot/actions.js";
import { ROBOT_EXPRESSIONS } from "../robot/expressions.js";
import { useGuestAiDeviceRuntime } from "../device/session/GuestAiDeviceRuntimeContext.jsx";
import { SupabaseSttProvider } from "../voice/SttProvider.js";
import { SupabaseSttBenchmarkProvider } from "../voice/SttBenchmarkProvider.js";
import { SupabaseConversationProvider } from "../voice/ConversationProvider.js";
import { SupabaseTtsProvider } from "../voice/TtsProvider.js";
import { AudioPlaybackSender } from "../device/audio/AudioPlaybackSender.js";
import { appendOwnedInteractionTurn, createInteractionSession, FOLLOW_UP_TIMEOUT_MS, followUpExpired, interactionContext, markFollowUpReady } from "../voice/InteractionSession.js";

const capabilityLabels = { display: "Display", servo_x: "Servo X", servo_y: "Servo Y", speaker: "Speaker", microphone: "Microphone", camera: "Camera", wifi: "Wi-Fi" };
const formatTime = (value) => value ? new Date(value).toLocaleString("en-MY") : "—";

export default function GuestAiDeviceConsolePage({ ui }) {
  const { session, snapshot, serialSupported } = useGuestAiDeviceRuntime();
  const sttProvider = useMemo(() => new SupabaseSttProvider(), []);
  const sttBenchmarkProvider = useMemo(() => new SupabaseSttBenchmarkProvider(), []);
  const conversationProvider = useMemo(() => new SupabaseConversationProvider(), []);
  const ttsProvider = useMemo(() => new SupabaseTtsProvider(), []);
  const playbackSender = useMemo(() => new AudioPlaybackSender(), []);
  const transcriptionTurns = useRef(new Set());
  const benchmarkTurns = useRef(new Set());
  const sttAbortController = useRef(null);
  const conversationAbortController = useRef(null);
  const ttsAbortController = useRef(null);
  const followUpTimer = useRef(null);
  const speakingAnimationTimers = useRef([]);
  const interactionRef = useRef(null);
  const turnInteractionOwners = useRef(new Map());
  const [fidelitySource, setFidelitySource] = useState("");
  const [fidelityTurn, setFidelityTurn] = useState(null);
  const [fidelityVerdict, setFidelityVerdict] = useState(null);
  const [benchmarkMode, setBenchmarkMode] = useState(false);
  const [benchmarkTurnIds, setBenchmarkTurnIds] = useState(() => new Set());
  const [benchmark, setBenchmark] = useState(null);
  const [interaction, setInteraction] = useState(null);
  const online = snapshot.connection === "online";
  const reconnecting = snapshot.connection === "reconnecting";
  const audio = snapshot.audio ?? { state: "IDLE", capture: null };
  const setInteractionSnapshot = (next) => { interactionRef.current = next; setInteraction(next); };
  const clearFollowUpTimer = () => { if (followUpTimer.current) clearTimeout(followUpTimer.current); followUpTimer.current = null; };
  const clearSpeakingAnimation = () => { speakingAnimationTimers.current.forEach(clearTimeout); speakingAnimationTimers.current = []; };
  const syncRobotState = async (state) => {
    const result = await session.setRobotStateAndWait(state);
    if (result.status !== "ok") throw new Error(result.detail ?? `robot_state_${state}_rejected`);
    return result;
  };
  const recoverVoiceError = (stage, turnId, error) => {
    session.log("error", `${stage}: ${error.message ?? "failed"}`);
    void syncRobotState("ERROR").catch(() => {}).finally(() => {
      setTimeout(() => { void syncRobotState("IDLE").catch(() => {}); }, 400);
    });
    clearFollowUpTimer(); setInteractionSnapshot(null);
  };
  useEffect(() => {
    const capture = audio.capture;
    if (audio.state !== "COMPLETE" || !capture || capture.completion !== "completed" || snapshot.connection !== "online") return;
    if (benchmarkTurnIds.has(capture.turnId)) {
      if (benchmarkTurns.current.has(capture.turnId)) return;
      benchmarkTurns.current.add(capture.turnId);
      const controller = new AbortController();
      sttAbortController.current = controller;
      setBenchmark({ state: "RUNNING", turnId: capture.turnId, error: null });
      sttBenchmarkProvider.transcribe({ pcm: capture.pcm, sampleRate: capture.sampleRateHz, channels: capture.channels, turnId: capture.turnId, signal: controller.signal })
        .then((result) => setBenchmark({ state: "COMPLETE", turnId: capture.turnId, result, error: null }))
        .catch((error) => setBenchmark({ state: "ERROR", turnId: capture.turnId, error: { code: error.code ?? "stt_benchmark_failed", message: error.message ?? "Speech transcription benchmark failed." } }));
      return;
    }
    if (transcriptionTurns.current.has(capture.turnId)) return;
    transcriptionTurns.current.add(capture.turnId);
    const controller = new AbortController();
    sttAbortController.current = controller;
    void syncRobotState("THINKING").catch((error) => session.log("error", `display_thinking: ${error.message}`));
    session.beginTranscription(capture.turnId);
    sttProvider.transcribe({ pcm: capture.pcm, sampleRate: capture.sampleRateHz, channels: capture.channels, turnId: capture.turnId, signal: controller.signal })
      .then((result) => {
        session.completeTranscription(capture.turnId, result);
        if (!result.transcript?.trim()) return null;
        const conversationController = new AbortController();
        conversationAbortController.current = conversationController;
        session.beginConversation(capture.turnId);
        return conversationProvider.reply({ transcript: result.transcript, turnId: capture.turnId, context: interactionContext(interactionRef.current), signal: conversationController.signal })
          .then((reply) => {
            session.completeConversation(capture.turnId, reply);
            const ttsController = new AbortController();
            ttsAbortController.current = ttsController;
            session.beginSynthesis(capture.turnId);
            return ttsProvider.synthesize({ text: reply.reply_text, turnId: capture.turnId, signal: ttsController.signal })
              .then(async (speech) => {
                session.completeSynthesis(capture.turnId, speech);
                const transport = await playbackSender.send({ session, turnId: capture.turnId, pcm: speech.pcm, sampleRate: speech.sample_rate_hz, channels: speech.channels, signal: ttsController.signal });
                session.recordPlaybackTransport(capture.turnId, transport);
              })
              .catch((error) => { session.failSynthesis(capture.turnId, error); recoverVoiceError("tts", capture.turnId, error); });
          })
          .catch((error) => { session.failConversation(capture.turnId, error); recoverVoiceError("llm", capture.turnId, error); });
      })
      .catch((error) => { session.failTranscription(capture.turnId, error); recoverVoiceError("stt", capture.turnId, error); });
  }, [audio, benchmarkTurnIds, conversationProvider, playbackSender, session, snapshot.connection, sttBenchmarkProvider, sttProvider, ttsProvider]);
  useEffect(() => {
    const turnId = audio.playback?.turn_id;
    const capture = audio.capture;
    const reply = audio.conversation;
    if (audio.state !== "IDLE" || !audio.playback?.complete || !turnId || capture?.turnId !== turnId || reply?.turnId !== turnId) return;
    const interactionId = turnInteractionOwners.current.get(turnId);
    const current = interactionRef.current;
    const owned = appendOwnedInteractionTurn(current, interactionId, { turnId, transcript: capture.transcript ?? audio.stt?.transcript, reply: reply.spokenReplyText ?? reply.replyText });
    turnInteractionOwners.current.delete(turnId);
    // The interaction may have been explicitly ended/replaced while a prior
    // voice turn was completing.  Its result is intentionally discarded.
    if (!interactionId || owned === current) return;
    const next = markFollowUpReady(owned);
    setInteractionSnapshot(next);
    session.markFollowUpReady(turnId);
    clearFollowUpTimer();
    followUpTimer.current = setTimeout(() => { setInteractionSnapshot(null); session.resetVoiceInteraction(); }, FOLLOW_UP_TIMEOUT_MS);
  }, [audio, session]);
  useEffect(() => {
    if (audio.state !== "CANCELLED") return;
    clearFollowUpTimer(); turnInteractionOwners.current.clear(); setInteractionSnapshot(null);
    void syncRobotState("IDLE").catch(() => {});
  }, [audio.state]);
  useEffect(() => {
    clearSpeakingAnimation();
    if (audio.state !== "SPEAKING" || audio.playback?.state !== "SPEAKING") return undefined;
    // Two 120 ms blinks at most: bounded, low-frequency display traffic that
    // never participates in PCM upload or audio pacing.
    [900, 2_400].forEach((delay) => {
      const blink = setTimeout(() => {
        session.command("set_expression", { expression: "blink" }).catch((error) => session.log("error", `speaking_blink: ${error.message}`));
        const restore = setTimeout(() => session.command("set_expression", { expression: "speaking" }).catch((error) => session.log("error", `speaking_restore: ${error.message}`)), 120);
        speakingAnimationTimers.current.push(restore);
      }, delay);
      speakingAnimationTimers.current.push(blink);
    });
    return clearSpeakingAnimation;
  }, [audio.playback?.state, audio.state, session]);
  useEffect(() => {
    if (snapshot.connection === "online") return;
    if (sttAbortController.current) sttAbortController.current.abort();
    if (conversationAbortController.current) conversationAbortController.current.abort();
    if (ttsAbortController.current) ttsAbortController.current.abort();
    clearFollowUpTimer(); clearSpeakingAnimation(); turnInteractionOwners.current.clear(); setInteractionSnapshot(null);
  }, [snapshot.connection]);
  async function run(type, payload, label) {
    try { await session.command(type, payload); ui.notify({ title: `${label} sent`, message: "Awaiting command_result from firmware.", tone: "success" }); }
    catch (error) { ui.notify({ title: "Command not sent", message: error.message, tone: "error" }); }
  }
  async function connect() { try { if (snapshot.reconnectAvailable) await session.reconnect(); else await session.connect(); } catch {} }
  async function startNewInteraction() { clearFollowUpTimer(); turnInteractionOwners.current.clear(); setInteractionSnapshot(createInteractionSession()); session.resetVoiceInteraction(); try { await syncRobotState("IDLE"); } catch (error) { ui.notify({ title: "Interaction reset failed", message: error.message, tone: "error" }); } }
  async function endInteraction() { clearFollowUpTimer(); turnInteractionOwners.current.clear(); setInteractionSnapshot(null); session.resetVoiceInteraction(); try { await syncRobotState("IDLE"); } catch (error) { ui.notify({ title: "Interaction end failed", message: error.message, tone: "error" }); } }
  async function startListening() {
    try {
      let active = interactionRef.current;
      if (!active || followUpExpired(active)) active = createInteractionSession();
      clearFollowUpTimer(); setInteractionSnapshot({ ...active, phase: "LISTENING", expiresAt: null });
      const turnId = globalThis.crypto?.randomUUID?.() ?? `turn-${Date.now()}`;
      turnInteractionOwners.current.set(turnId, active.id);
      setFidelityTurn({ turnId, source: fidelitySource.trim() }); setFidelityVerdict(null); setBenchmark(null);
      if (benchmarkMode) setBenchmarkTurnIds((turnIds) => new Set([...turnIds, turnId]));
      await syncRobotState("LISTENING");
      await session.startListening(turnId);
    } catch (error) { ui.notify({ title: "Capture not started", message: error.message, tone: "error" }); }
  }
  async function stopListening() { try { await session.stopListening(); } catch (error) { ui.notify({ title: "Capture not stopped", message: error.message, tone: "error" }); } }
  async function playFixedText() {
    const turnId = globalThis.crypto?.randomUUID?.() ?? `tts-test-${Date.now()}`;
    const text = "Hi! Nice to meet you.";
    try {
      session.beginFixedTextSynthesis(turnId, text);
      const controller = new AbortController();
      ttsAbortController.current = controller;
      const speech = await ttsProvider.synthesize({ text, turnId, signal: controller.signal });
      session.completeSynthesis(turnId, speech);
      const transport = await playbackSender.send({ session, turnId, pcm: speech.pcm, sampleRate: speech.sample_rate_hz, channels: speech.channels, signal: controller.signal });
      session.recordPlaybackTransport(turnId, transport);
    } catch (error) {
      session.failSynthesis(turnId, error);
      ui.notify({ title: "Fixed-text playback failed", message: error.message, tone: "error" });
    }
  }
  return <div className="space-y-4">
    <Card title="Natural interaction · Phase 1E" description="A short browser-memory-only conversation. It keeps at most three completed transcript/reply turns and clears after follow-up expiry, End Interaction, or disconnect.">
      <div className="space-y-3 p-4 text-sm">
        <div className="flex flex-wrap items-center gap-3"><Control disabled={!online || ["LISTENING", "TRANSCRIBING", "THINKING", "SYNTHESIZING", "SPEAKING"].includes(audio.state)} onClick={startNewInteraction}>Start New Interaction</Control><Control disabled={!online || interaction?.phase !== "FOLLOW_UP_READY"} onClick={startListening}>Continue Listening</Control><Control disabled={!interaction} onClick={endInteraction}>End Interaction</Control><Badge tone={interaction?.phase === "FOLLOW_UP_READY" ? "success" : "neutral"}>{interaction?.phase ?? "IDLE"}</Badge></div>
        <dl className="grid gap-2 sm:grid-cols-3"><Row label="Interaction ID" value={interaction?.id ?? "—"} /><Row label="Turn count" value={interaction?.turns.length ?? 0} /><Row label="Follow-up" value={interaction?.expiresAt ? `${Math.max(0, Math.ceil((interaction.expiresAt - Date.now()) / 1000))} s` : "—"} /></dl>
        {interaction?.turns.length ? <div className="space-y-2">{interaction.turns.map((turn, index) => <div className="rounded border border-border bg-surface-muted p-2" key={turn.turnId}><p className="font-semibold">Turn {index + 1}</p><p className="mt-1 text-text-secondary">Guest: {turn.transcript}</p><p className="mt-1 text-text-secondary">Guest AI: {turn.reply}</p></div>)}</div> : <p className="text-text-secondary">Start a new interaction to begin a transient conversation.</p>}
      </div>
    </Card>
    <PageHeader section="Guest AI · Development" title="Device Console" description="Canonical protocol console for a locally connected Guest AI device. No business or guest data is persisted in this foundation." actions={<button type="button" className="btn-primary" disabled={reconnecting} onClick={online ? () => session.disconnect() : connect}>{online ? "Disconnect" : reconnecting ? "Reconnecting K151…" : snapshot.reconnectAvailable ? "Reconnect Device" : "Connect K151 over USB"}</button>} />
    {!serialSupported ? <div className="card border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">This browser does not expose Web Serial. Use Chromium over localhost/HTTPS, or implement the network gateway adapter before device control can begin.</div> : null}
    {snapshot.error ? <div className="card border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{snapshot.error}</div> : null}
    <div className="grid gap-4 lg:grid-cols-3">
      <Card title="Connection" description="Transport and handshake state"><dl className="grid gap-3 p-4 text-sm"><Row label="Status"><Badge tone={online ? "success" : snapshot.connection === "connecting" || reconnecting ? "warning" : "neutral"}>{snapshot.connection}</Badge></Row><Row label="Device ID" value={snapshot.device?.id ?? "Awaiting snapshot"} /><Row label="Model" value={snapshot.device?.model ?? "—"} /><Row label="Firmware" value={snapshot.device?.firmware_version ?? "—"} /><Row label="Last seen" value={formatTime(snapshot.lastSeen)} /></dl></Card>
      <Card title="Robot state" description="Canonical state model"><div className="p-4"><Badge tone={snapshot.robotState === "ERROR" ? "danger" : online ? "info" : "neutral"}>{snapshot.robotState}</Badge><p className="mt-3 text-xs text-text-secondary">State changes are accepted only from firmware command_result/error messages.</p></div></Card>
      <Card title="Capability status" description="Reported by device firmware"><div className="divide-y divide-border">{Object.entries(capabilityLabels).map(([key, label]) => <div key={key} className="flex items-center justify-between px-4 py-2.5 text-sm"><span>{label}</span><Badge tone={snapshot.capabilities[key] === "pass" ? "success" : snapshot.capabilities[key] === "partial" ? "warning" : snapshot.capabilities[key] === "blocked" ? "danger" : "neutral"}>{snapshot.capabilities[key] ?? "unknown"}</Badge></div>)}</div></Card>
    </div>
    <Card title="Raw STT provider benchmark" description="Development-only: one completed K151 capture is held in browser memory and sent once to the authenticated Staging benchmark endpoint, which fans the identical WAV to all candidates. No LLM, PCM persistence, or source-text upload."><div className="space-y-3 p-4"><label className="flex items-center gap-2 text-sm text-text-secondary"><input type="checkbox" checked={benchmarkMode} onChange={(event) => setBenchmarkMode(event.target.checked)} />Use raw STT benchmark for the next capture</label><p className="text-xs text-text-secondary">Enable before Start Listening. The manual source phrase remains in this browser only.</p>{benchmark ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm"><p className="font-semibold">Benchmark {benchmark.state}</p>{fidelityTurn?.turnId === benchmark.turnId && fidelityTurn.source ? <p className="mt-2 text-text-secondary">Source (browser memory only): {fidelityTurn.source}</p> : null}{benchmark.state === "RUNNING" ? <p className="mt-2 text-text-secondary">Comparing raw transcripts; no conversation reply is requested.</p> : null}{benchmark.state === "ERROR" ? <p className="mt-2 text-rose-700">{benchmark.error.code}: {benchmark.error.message}</p> : null}{benchmark.state === "COMPLETE" ? <div className="mt-3 space-y-3">{benchmark.result.candidates.map((candidate, index) => <div key={`${candidate.candidate ?? "error"}-${index}`} className="rounded border border-border bg-surface p-2"><p className="font-semibold">{candidate.candidate ?? "provider error"}{candidate.model ? ` · ${candidate.model}` : ""}</p>{candidate.ok ? <><p className="mt-1 whitespace-pre-wrap text-text-primary">{candidate.transcript || "No speech detected."}</p><p className="mt-1 text-xs text-text-secondary">{candidate.provider_response_ms} ms · languages: {candidate.detected_languages?.join(", ") || "not returned"} · cost is scored from provider billing, not guessed.</p></> : <p className="mt-1 text-rose-700">{candidate.error?.code}: {candidate.error?.message}</p>}</div>)}</div> : null}</div> : null}</div></Card>
    <div id="guest-ai-voice-tools"><Card title="Voice loop · Phase 1D TTS playback" description="PCM, transcript, reply, and synthesized speech are transient. STT remains provisional; the reply is based only on the raw transcript."><div className="space-y-3 p-4"><label className="block text-sm text-text-secondary">Fidelity test source — manual development aid, never sent or persisted<input className="mt-1 block w-full rounded border border-border bg-surface px-2 py-1 text-text-primary" value={fidelitySource} onChange={(event) => setFidelitySource(event.target.value)} placeholder="Optional phrase you will speak" /></label><div className="flex flex-wrap items-center gap-3"><Control disabled={!online || ["LISTENING", "TRANSCRIBING", "THINKING", "SYNTHESIZING", "SPEAKING"].includes(audio.state)} onClick={startListening}><Mic size={15} />Start Listening</Control><Control disabled={!online || audio.state !== "LISTENING"} onClick={stopListening}><RotateCcw size={15} />Stop Listening</Control><Control disabled={!online || ["LISTENING", "TRANSCRIBING", "THINKING", "SYNTHESIZING", "SPEAKING"].includes(audio.state)} onClick={playFixedText}><Volume2 size={15} />Play fixed TTS</Control><Badge tone={audio.state === "ERROR" ? "danger" : ["COMPLETE", "CANCELLED", "IDLE"].includes(audio.state) ? "success" : "info"}>{audio.state}</Badge><span className="text-sm text-text-secondary">{audio.byteCount ?? audio.capture?.byteCount ?? 0} bytes · {audio.chunks ?? audio.capture?.chunks ?? 0} chunks · {audio.duration_ms ?? audio.capture?.durationMs ?? 0} ms</span></div><p className="text-xs text-text-secondary">Fixed TTS sends only “Hi! Nice to meet you.” to the authenticated Staging TTS endpoint; it bypasses STT and LLM.</p>{audio.capture?.completion === "completed" ? <div className="rounded-lg border border-border bg-surface-muted p-3 text-sm"><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">End-of-speech evidence</p><div className="grid gap-2 sm:grid-cols-3"><Row label="Speech detected" value={audio.speech_detected ? "yes" : "no"} /><Row label="Current RMS" value={audio.current_rms ?? "—"} /><Row label="Noise threshold" value={audio.speech_threshold_rms ?? "—"} /><Row label="Noise floor RMS" value={audio.noise_floor_rms ?? "—"} /><Row label="Post-speech silence" value={audio.post_speech_silence_ms == null ? "—" : `${audio.post_speech_silence_ms} ms`} /><Row label="Auto-stop" value={audio.auto_stop ? "yes" : "no"} /><Row label="Estimated speech end" value={audio.estimated_speech_end_elapsed_ms == null ? "—" : `${audio.estimated_speech_end_elapsed_ms} ms`} /><Row label="Time saved vs 6 s" value={audio.time_saved_ms == null ? "—" : `${audio.time_saved_ms} ms`} /></div></div> : null}{audio.stt ? <div className="rounded-lg border border-border bg-surface-muted p-3 text-sm"><Row label="STT latency" value={audio.stt.sttLatencyMs == null ? "—" : `${audio.stt.sttLatencyMs} ms`} /><p className="mt-3 text-xs font-semibold uppercase tracking-wide text-text-secondary">Raw STT transcript — not corrected by the LLM</p><p className="mt-1 whitespace-pre-wrap text-text-primary">{audio.stt.outcome === "empty_transcript" ? "No speech was detected." : audio.stt.transcript}</p></div> : null}{audio.conversation ? <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm"><Row label="LLM latency" value={audio.conversation.llmLatencyMs == null ? "—" : `${audio.conversation.llmLatencyMs} ms`} /><p className="mt-3 text-xs font-semibold uppercase tracking-wide text-text-secondary">AI reply — based only on the raw transcript above</p><p className="mt-1 whitespace-pre-wrap text-text-primary">{audio.conversation.replyText}</p>{audio.conversation.replyShortened ? <><p className="mt-3 text-xs font-semibold uppercase tracking-wide text-text-secondary">Reply shortened for playback</p><p className="mt-1 whitespace-pre-wrap text-text-primary">{audio.conversation.spokenReplyText}</p></> : null}</div> : null}{audio.tts ? <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm"><div className="grid gap-2 sm:grid-cols-3"><Row label="TTS state" value={audio.tts.state} /><Row label="Voice" value={audio.tts.voice ?? "—"} /><Row label="TTS latency" value={audio.tts.ttsLatencyMs == null ? "—" : `${audio.tts.ttsLatencyMs} ms`} /><Row label="Output bytes" value={audio.tts.byteCount ?? "—"} /><Row label="PCM peak" value={audio.tts.pcmDiagnostics?.peak ?? "—"} /><Row label="PCM RMS" value={audio.tts.pcmDiagnostics?.rms == null ? "—" : Math.round(audio.tts.pcmDiagnostics.rms)} /><Row label="PCM duration" value={audio.tts.pcmDiagnostics?.durationMs == null ? "—" : `${Math.round(audio.tts.pcmDiagnostics.durationMs)} ms`} /><Row label="Playback limit" value={audio.tts.playbackBudget?.max_playback_duration_ms == null ? "—" : `${audio.tts.playbackBudget.max_playback_duration_ms} ms`} /><Row label="Playback latency" value={audio.playback?.duration_ms == null ? "—" : `${audio.playback.duration_ms} ms`} /></div>{audio.tts.fixedText ? <p className="mt-3 text-xs text-text-secondary">Fixed text: Hi! Nice to meet you.</p> : null}{audio.tts.state === "ERROR" ? <><p className="mt-3 text-rose-700">TTS error ({audio.tts.error?.code}): {audio.tts.error?.message}</p>{audio.tts.error?.evidence ? <p className="mt-1 text-xs text-rose-700">PCM {audio.tts.error.evidence.byte_count} / {audio.tts.error.evidence.max_bytes} bytes · {Math.round(audio.tts.error.evidence.duration_ms)} / {audio.tts.error.evidence.max_duration_ms} ms</p> : null}</> : null}</div> : null}</div></Card></div>
    <div id="guest-ai-device-tools"><Card title="Manual test controls" description="Commands are disabled until the firmware identifies itself using device_connected."><div className="grid gap-4 p-4 lg:grid-cols-2"><ControlGroup icon={Eye} title="Gaze / head position">{Object.entries(ROBOT_GAZES).map(([name, gaze]) => <Control key={name} disabled={!online} onClick={() => run("set_gaze", gaze, `Look ${name}`)}>{name === "up" ? <ChevronDown size={15} className="rotate-180" /> : name === "down" ? <ChevronDown size={15} /> : name === "left" ? <ChevronLeft size={15} /> : name === "right" ? <ChevronRight size={15} /> : <RotateCcw size={15} />}Look {name}</Control>)}</ControlGroup><ControlGroup icon={Smile} title="Expression / state">{ROBOT_EXPRESSIONS.map((expression) => <Control key={expression} disabled={!online} onClick={() => run("set_expression", { expression }, expression)}>{expression === "blink" ? <Eye size={15} /> : <Bot size={15} />}{expression}</Control>)}{["IDLE", "ATTENTION", "LISTENING", "THINKING", "SPEAKING"].map((state) => <Control key={state} disabled={!online} onClick={() => run("set_robot_state", { state }, state)}>{state}</Control>)}</ControlGroup><ControlGroup icon={Volume2} title="Audio"><Control disabled={!online} onClick={() => run("request_capability_test", { capability: "speaker" }, "Speaker test")}><Volume2 size={15} />Speaker test</Control><Control disabled={!online} onClick={() => run("play_audio", { asset: "test_tone" }, "Test tone")}>Play test tone</Control></ControlGroup><ControlGroup icon={Mic} title="Capture checks"><Control disabled={!online} onClick={() => run("request_capability_test", { capability: "microphone" }, "Mic test")}><Mic size={15} />Mic test</Control><Control disabled={!online} onClick={() => run("request_capability_test", { capability: "camera" }, "Camera test")}><Camera size={15} />Camera test</Control><p className="col-span-full text-xs text-text-secondary">Camera preview is intentionally not implemented: it needs a declared stream transport and consent policy, not a placeholder.</p></ControlGroup></div></Card></div>
    <div id="guest-ai-diagnostics"><Card title="Connection log" description="Newest first; retained only in browser memory."><div className="max-h-64 divide-y divide-border overflow-auto">{snapshot.logs.length ? snapshot.logs.map((entry) => <div key={entry.id} className="flex gap-3 px-4 py-2 text-xs"><span className={entry.level === "error" ? "font-bold text-rose-700" : "font-bold text-text-secondary"}>{entry.level.toUpperCase()}</span><span className="text-text-muted">{formatTime(entry.at)}</span><span>{entry.message}</span></div>) : <div className="p-4 text-sm text-text-secondary">No connection events yet.</div>}</div></Card></div>
  </div>;
}
function Row({ label, value, children }) { return <div className="flex items-center justify-between gap-3"><dt className="text-text-secondary">{label}</dt><dd className="m-0 text-right font-semibold text-text-primary">{children ?? value}</dd></div>; }
function ControlGroup({ icon: Icon, title, children }) { return <section className="rounded-xl border border-border bg-surface-muted p-3"><div className="mb-3 flex items-center gap-2 text-sm font-bold text-text-primary"><Icon size={16} className="text-primary" />{title}</div><div className="flex flex-wrap gap-2">{children}</div></section>; }
function Control({ children, ...props }) { return <button type="button" className="btn-secondary inline-flex items-center gap-1.5 capitalize disabled:cursor-not-allowed disabled:opacity-50" {...props}>{children}</button>; }
