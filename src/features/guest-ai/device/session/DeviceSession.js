import { createDeviceCommand, parseDeviceMessage } from "../protocol/deviceProtocol.js";
import { isRobotState } from "../../robot/states.js";
import { AudioCaptureAssembler } from "../audio/AudioCaptureAssembler.js";

const initialSnapshot = Object.freeze({ connection: "offline", device: null, capabilities: {}, robotState: "OFFLINE", lastSeen: null, logs: [], error: null });

export class DeviceSession {
  constructor(adapter) { this.adapter = adapter; this.snapshot = { ...initialSnapshot, logs: [], audio: { state: "IDLE", capture: null } }; this.listeners = new Set(); this.audioAssembler = new AudioCaptureAssembler(); this.pendingCommands = new Map(); this.playbackCredit = null; this.playbackCreditWaiters = []; }
  subscribe(listener) { this.listeners.add(listener); listener(this.snapshot); return () => this.listeners.delete(listener); }
  update(patch) { this.snapshot = { ...this.snapshot, ...patch }; this.listeners.forEach((listener) => listener(this.snapshot)); }
  log(level, message) { this.update({ logs: [{ id: `${Date.now()}-${Math.random()}`, at: new Date().toISOString(), level, message }, ...this.snapshot.logs].slice(0, 100) }); }
  callbacks() { return {
    onMessage: (line) => this.receive(line),
    onOpen: () => this.restoreSnapshot("Serial transport opened; requesting device snapshot."),
    onReconnect: () => this.restoreSnapshot("K151 reconnected; requesting device snapshot."),
    onDisconnect: (error) => this.handleDeviceLost(error),
    onReconnectUnavailable: (error) => { this.update({ connection: "offline", reconnectAvailable: true, error: error.message }); this.log("error", error.message); },
  }; }
  async connect() {
    this.update({ connection: "connecting", error: null });
    try { await this.adapter.connect(this.callbacks()); }
    catch (error) { this.update({ connection: "offline", error: error.message }); this.log("error", error.message); throw error; }
  }
  async reconnect() { this.update({ connection: "reconnecting", error: null }); await this.adapter.reconnect(); }
  async restoreSnapshot(message) {
    this.update({ connection: "reconnecting", error: null }); this.log("info", message);
    try { await this.requestDeviceSnapshot(); }
    catch (error) { this.update({ connection: "offline", error: error.message }); this.log("error", error.message); }
  }
  handleDeviceLost(error) {
    this.rejectPendingCommands(error);
    this.rejectPlaybackCreditWaiters(error); this.playbackCredit = null;
    this.audioAssembler = new AudioCaptureAssembler();
    this.update({ connection: "reconnecting", reconnectAvailable: true, device: null, capabilities: {}, robotState: "OFFLINE", audio: { state: "IDLE", capture: null, aborted: "device_disconnected" }, error: error.message });
    this.log("error", `Transport disconnected: ${error.message}`);
  }
  rejectPendingCommands(error) { for (const pending of this.pendingCommands.values()) { clearTimeout(pending.timer); pending.reject(error); } this.pendingCommands.clear(); }
  rejectPlaybackCreditWaiters(error) { for (const pending of this.playbackCreditWaiters) { clearTimeout(pending.timer); pending.reject(error); } this.playbackCreditWaiters = []; }
  activePlaybackTurnId() { return this.snapshot.audio?.playback?.turn_id ?? this.snapshot.audio?.tts?.turnId ?? null; }
  publishPlaybackCredit(payload) {
    const activeTurnId = this.activePlaybackTurnId();
    if (!activeTurnId || payload.turn_id !== activeTurnId) { this.log("info", `Ignored stale audio_playback_credit for ${payload.turn_id}.`); return false; }
    this.playbackCredit = payload;
    const index = this.playbackCreditWaiters.findIndex((pending) => pending.turnId === payload.turn_id);
    if (index >= 0) { const [waiter] = this.playbackCreditWaiters.splice(index, 1); clearTimeout(waiter.timer); waiter.resolve(payload); }
    return true;
  }
  beginTranscription(turnId) {
    const capture = this.snapshot.audio?.capture;
    if (!capture || capture.turnId !== turnId || capture.completion !== "completed") throw new Error("audio_capture_not_ready_for_stt");
    this.update({ audio: { ...this.snapshot.audio, state: "TRANSCRIBING", stt: { state: "TRANSCRIBING", turnId, error: null } } });
  }
  completeTranscription(turnId, result) {
    const capture = this.snapshot.audio?.capture;
    if (!capture || capture.turnId !== turnId) return;
    this.update({ audio: { ...this.snapshot.audio, state: "COMPLETE", stt: { state: "COMPLETE", turnId, transcript: result.transcript ?? "", detectedLanguage: result.detected_language ?? null, provider: result.provider ?? null, model: result.model ?? null, providerStatus: result.stt_provider_status ?? "provisional", sttLatencyMs: result.stt_latency_ms ?? null, providerResponseMs: result.provider_response_ms ?? null, outcome: result.outcome ?? "transcribed", error: null } } });
  }
  beginConversation(turnId) {
    const capture = this.snapshot.audio?.capture;
    const stt = this.snapshot.audio?.stt;
    if (!capture || capture.turnId !== turnId || !stt || stt.turnId !== turnId || stt.state !== "COMPLETE") throw new Error("transcript_not_ready_for_llm");
    this.update({ audio: { ...this.snapshot.audio, state: "THINKING", conversation: { state: "THINKING", turnId, error: null } } });
  }
  completeConversation(turnId, result) {
    const capture = this.snapshot.audio?.capture;
    if (!capture || capture.turnId !== turnId) return;
    const sttLatencyMs = this.snapshot.audio?.stt?.sttLatencyMs ?? 0;
    const llmLatencyMs = result.llm_latency_ms ?? null;
    this.update({ audio: { ...this.snapshot.audio, state: "COMPLETE", conversation: { state: "COMPLETE", turnId, replyText: result.reply_text ?? "", provider: result.provider ?? null, model: result.model ?? null, llmLatencyMs, providerResponseMs: result.provider_response_ms ?? null, usage: result.usage ?? null, estimatedCostUsd: result.estimated_cost_usd ?? null, totalLatencyMs: llmLatencyMs == null ? null : sttLatencyMs + llmLatencyMs, error: null } } });
  }
  beginSynthesis(turnId) {
    const conversation = this.snapshot.audio?.conversation;
    if (!conversation || conversation.turnId !== turnId || conversation.state !== "COMPLETE" || !conversation.replyText?.trim()) throw new Error("reply_not_ready_for_tts");
    this.update({ audio: { ...this.snapshot.audio, state: "SYNTHESIZING", tts: { state: "SYNTHESIZING", turnId, error: null } } });
  }
  beginFixedTextSynthesis(turnId, text) {
    if (this.snapshot.connection !== "online" || ["LISTENING", "TRANSCRIBING", "THINKING", "SYNTHESIZING", "SPEAKING"].includes(this.snapshot.audio?.state)) throw new Error("device_not_ready_for_tts_test");
    this.update({ audio: { state: "SYNTHESIZING", capture: null, tts: { state: "SYNTHESIZING", turnId, text, fixedText: true, error: null } } });
  }
  markFollowUpReady(turnId) {
    if (this.snapshot.audio?.tts?.turnId !== turnId || this.snapshot.audio?.playback?.complete !== true) return false;
    this.update({ audio: { ...this.snapshot.audio, state: "FOLLOW_UP_READY" } });
    return true;
  }
  resetVoiceInteraction() {
    this.update({ audio: { ...this.snapshot.audio, state: "IDLE" } });
  }
  completeSynthesis(turnId, result) {
    if (this.snapshot.audio?.capture?.turnId !== turnId && this.snapshot.audio?.tts?.turnId !== turnId) return;
    const conversation = this.snapshot.audio?.conversation;
    const spokenReplyText = typeof result.spoken_reply === "string" && result.spoken_reply.trim() ? result.spoken_reply : conversation?.replyText;
    this.update({ audio: { ...this.snapshot.audio, state: "SYNTHESIZING", conversation: conversation?.turnId === turnId ? { ...conversation, spokenReplyText, replyShortened: result.reply_shortened === true } : conversation, tts: { state: "SYNTHESIZING", turnId, voice: result.voice, model: result.model, ttsLatencyMs: result.tts_latency_ms, providerResponseMs: result.provider_response_ms, byteCount: result.pcm.byteLength, pcmDiagnostics: result.pcm_diagnostics ?? null, compression: result.compression ?? null, playbackBudget: result.playback_budget ?? null, error: null } } });
  }
  failSynthesis(turnId, error) {
    if (this.snapshot.audio?.capture?.turnId !== turnId && this.snapshot.audio?.tts?.turnId !== turnId) return;
    this.update({ audio: { ...this.snapshot.audio, state: "ERROR", tts: { ...this.snapshot.audio?.tts, state: "ERROR", turnId, error: { code: error.code ?? "tts_failed", message: error.message ?? "Speech synthesis failed.", evidence: error.evidence ?? null } } } });
  }
  failConversation(turnId, error) {
    const capture = this.snapshot.audio?.capture;
    if (!capture || capture.turnId !== turnId) return;
    this.update({ audio: { ...this.snapshot.audio, state: "ERROR", conversation: { state: "ERROR", turnId, error: { code: error.code ?? "llm_failed", message: error.message ?? "Conversation reply failed." } } } });
  }
  failTranscription(turnId, error) {
    const capture = this.snapshot.audio?.capture;
    if (!capture || capture.turnId !== turnId) return;
    this.update({ audio: { ...this.snapshot.audio, state: "ERROR", stt: { state: "ERROR", turnId, error: { code: error.code ?? "stt_failed", message: error.message ?? "Speech transcription failed." } } } });
  }
  async disconnect(error = null) {
    await this.adapter.disconnect(); this.rejectPendingCommands(new Error("Serial device is not connected.")); this.rejectPlaybackCreditWaiters(new Error("Serial device is not connected.")); this.playbackCredit = null; this.audioAssembler = new AudioCaptureAssembler();
    this.update({ connection: "offline", reconnectAvailable: false, device: null, capabilities: {}, robotState: "OFFLINE", audio: { state: "IDLE", capture: null }, error: error?.message ?? null });
    this.log(error ? "error" : "info", error ? `Transport disconnected: ${error.message}` : "Transport disconnected.");
  }
  applySnapshot(snapshot, lastSeen) {
    const capabilities = Object.fromEntries(Object.entries(snapshot.capabilities ?? {}).map(([key, value]) => [key, value?.status ?? value]));
    this.update({ connection: "online", reconnectAvailable: false, device: { id: snapshot.device_id, model: snapshot.model, firmware_version: snapshot.firmware_version, protocol_version: snapshot.protocol_version, build_profile: snapshot.build_profile, fault_injection_enabled: snapshot.fault_injection_enabled }, capabilities, robotState: snapshot.robot_state ?? "IDLE", lastSeen, error: null, audio: { state: "IDLE", capture: null } });
  }
  receive(line) {
    try {
      const message = parseDeviceMessage(line); const lastSeen = new Date().toISOString();
      if (message.type === "device_connected") this.update({ connection: "online", device: { id: message.device_id, ...message.payload }, lastSeen, robotState: "BOOTING", error: null });
      else if (message.type === "heartbeat") this.update({ lastSeen });
      else if (message.type === "capability_status") this.update({ capabilities: Object.fromEntries(Object.entries(message.payload.capabilities ?? {}).map(([key, value]) => [key, value?.status ?? value])), lastSeen });
      else if (message.type === "audio_capture_stage") {
        const captureDiagnostics = message.payload.turn_id === this.snapshot.audio?.turn_id || message.payload.turn_id === this.snapshot.audio?.capture?.turnId
          ? { ...(this.snapshot.audio?.captureDiagnostics ?? {}), [message.payload.stage]: { ...message.payload, received_at: lastSeen } }
          : this.snapshot.audio?.captureDiagnostics;
        this.update({ audio: { ...this.snapshot.audio, captureDiagnostics }, lastSeen });
      }
      else if (message.type === "audio_capture_started") { this.audioAssembler.start(message.payload); this.update({ audio: { state: "LISTENING", capture: null, ...message.payload }, lastSeen }); }
      else if (message.type === "audio_capture_chunk") { this.audioAssembler.append(message.payload); this.update({ audio: { ...this.snapshot.audio, byteCount: this.audioAssembler.byteCount, chunks: this.audioAssembler.nextSequence }, lastSeen }); }
      else if (message.type === "audio_capture_complete") { const capture = this.audioAssembler.complete(message.payload); const state = capture.completion === "completed" ? "COMPLETE" : capture.completion === "cancelled" ? "CANCELLED" : "ERROR"; this.update({ audio: { state, capture, ...message.payload, captureDiagnostics: this.snapshot.audio?.captureDiagnostics ?? {} }, lastSeen }); }
      else if (message.type === "audio_playback_started") this.update({ audio: { ...this.snapshot.audio, state: "SYNTHESIZING", playback: { state: "RECEIVING", ...message.payload } }, lastSeen });
      else if (message.type === "audio_playback_playing") this.update({ audio: { ...this.snapshot.audio, state: "SPEAKING", tts: this.snapshot.audio?.tts ? { ...this.snapshot.audio.tts, state: "SPEAKING" } : this.snapshot.audio?.tts, playback: { state: "SPEAKING", ...message.payload } }, lastSeen });
      else if (message.type === "audio_playback_credit") {
        if (this.publishPlaybackCredit(message.payload)) this.update({ audio: { ...this.snapshot.audio, playback: { ...this.snapshot.audio?.playback, ...message.payload } }, lastSeen });
      }
      else if (message.type === "audio_playback_complete") {
        const playback = this.snapshot.audio?.playback;
        const activeTurnId = this.activePlaybackTurnId();
        const expectedBytes = playback?.total_bytes ?? this.snapshot.audio?.tts?.byteCount;
        const cancelled = message.payload.completion === "cancelled" && message.payload.cleanup_ok && message.payload.turn_id === activeTurnId;
        const complete = message.payload.completion === "completed" && message.payload.cleanup_ok && message.payload.turn_id === activeTurnId && message.payload.accepted_bytes === expectedBytes && message.payload.played_bytes === expectedBytes;
        const state = complete || cancelled ? "IDLE" : "ERROR";
        this.update({ audio: { ...this.snapshot.audio, state, tts: this.snapshot.audio?.tts ? { ...this.snapshot.audio.tts, state } : this.snapshot.audio?.tts, playback: { state, ...message.payload, complete } }, lastSeen });
      }
      else if (message.type === "command_result") {
        const snapshot = message.payload.evidence?.snapshot;
        if (message.payload.command_type === "request_device_snapshot" && message.payload.status === "ok" && snapshot) this.applySnapshot(snapshot, lastSeen);
        else this.update({ robotState: isRobotState(message.payload.robot_state) ? message.payload.robot_state : this.snapshot.robotState, lastSeen });
        this.resolvePendingCommand(message.message_id, message.payload);
      } else if (message.type === "error") { const error = new Error(message.payload.message ?? "Device error"); error.code = message.payload.message ?? "device_error"; this.rejectPendingCommand(message.message_id, error); this.update({ error: error.message, robotState: "ERROR", lastSeen }); }
      this.log(message.type === "error" ? "error" : "info", `← ${message.type}`);
    } catch (error) { this.log("error", `Rejected device message: ${error.message}`); }
  }
  resolvePendingCommand(commandId, payload) { const pending = this.pendingCommands.get(commandId); if (!pending) return; clearTimeout(pending.timer); this.pendingCommands.delete(commandId); pending.resolve(payload); }
  rejectPendingCommand(commandId, error) { const pending = this.pendingCommands.get(commandId); if (!pending) return; clearTimeout(pending.timer); this.pendingCommands.delete(commandId); pending.reject(error); }
  async send(type, payload = {}, { allowReconnecting = false } = {}) {
    if (this.snapshot.connection !== "online" && !(allowReconnecting && this.snapshot.connection === "reconnecting")) throw new Error("Device is not online.");
    const message = createDeviceCommand(type, payload, { deviceId: this.snapshot.device?.id }); await this.adapter.send(message); this.log("info", `→ ${type}`); return message.message_id;
  }
  command(type, payload = {}) { return this.send(type, payload); }
  async commandAndWait(type, payload = {}, { commandId, timeoutMs = 1500 } = {}) {
    if (this.snapshot.connection !== "online") throw new Error("Device is not online.");
    const message = createDeviceCommand(type, payload, { deviceId: this.snapshot.device?.id, commandId });
    const completion = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pendingCommands.delete(message.message_id); const error = new Error("device_command_timeout"); error.code = "device_command_timeout"; reject(error); }, timeoutMs);
      this.pendingCommands.set(message.message_id, { resolve, reject, timer });
    });
    try { await this.adapter.send(message); this.log("info", `→ ${type}`); }
    catch (error) { this.rejectPendingCommand(message.message_id, error); throw error; }
    return completion;
  }
  requestDeviceSnapshot() { return this.send("request_device_snapshot", {}, { allowReconnecting: true }); }
  setRobotStateAndWait(state, timeoutMs = 1_500) { return this.commandAndWait("set_robot_state", { state }, { timeoutMs }); }
  startListening(turnId, maxDurationMs = 6000) { return this.command("audio_capture_start", { turn_id: turnId, max_duration_ms: maxDurationMs }); }
  stopListening() { return this.command("audio_capture_end", {}); }
  startPlayback({ turnId, sampleRate, channels, totalBytes }) { return this.command("audio_playback_start", { turn_id: turnId, format: "pcm_s16le", sample_rate_hz: sampleRate, channels, total_bytes: totalBytes }); }
  sendPlaybackChunk({ turnId, sequence, pcm, byteCount }) { return this.command("audio_playback_chunk", { turn_id: turnId, sequence, byte_count: byteCount, encoding: "base64", pcm }); }
  endPlayback(turnId) { return this.command("audio_playback_end", { turn_id: turnId }); }
  startPlaybackAndWait({ turnId, sampleRate, channels, totalBytes }) { return this.commandAndWait("audio_playback_start", { turn_id: turnId, format: "pcm_s16le", sample_rate_hz: sampleRate, channels, total_bytes: totalBytes }); }
  sendPlaybackChunkAndWait({ turnId, sequence, pcm, byteCount, commandId, timeoutMs }) { return this.commandAndWait("audio_playback_chunk", { turn_id: turnId, sequence, byte_count: byteCount, encoding: "base64", pcm }, { commandId, timeoutMs }); }
  endPlaybackAndWait(turnId) { return this.commandAndWait("audio_playback_end", { turn_id: turnId }); }
  cancelPlayback(turnId, reason = "audio_playback_host_cancelled") { return this.command("audio_playback_cancel", { turn_id: turnId, reason }); }
  waitForPlaybackCredit(turnId, timeoutMs = 1500) {
    if (this.playbackCredit?.turn_id === turnId && this.playbackCredit.remaining_credit > 0) { const credit = this.playbackCredit; this.playbackCredit = null; return Promise.resolve(credit); }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.playbackCreditWaiters = this.playbackCreditWaiters.filter((pending) => pending.reject !== reject); const error = new Error("audio_playback_credit_timeout"); error.code = "audio_playback_credit_timeout"; reject(error); }, timeoutMs);
      this.playbackCreditWaiters.push({ turnId, resolve, reject, timer });
    });
  }
  recordPlaybackTransport(turnId, transport) {
    if (this.snapshot.audio?.tts?.turnId !== turnId && this.snapshot.audio?.playback?.turn_id !== turnId) return;
    this.update({ audio: { ...this.snapshot.audio, playbackTransport: transport } });
  }
}
