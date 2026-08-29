import { describe, expect, it, vi } from "vitest";
import { DeviceSession } from "../device/session/DeviceSession.js";

function snapshotMessage() {
  return JSON.stringify({ protocol_version: "1.0", message_id: "snapshot-1", type: "command_result", sent_at: "now", payload: {
    command_type: "request_device_snapshot", status: "ok", evidence: { snapshot: {
      device_id: "k151-idf-pending", model: "M5Stack StackChan K151", firmware_version: "bridge", protocol_version: "1.0",
      build_profile: "normal", fault_injection_enabled: false, robot_state: "IDLE", uptime_ms: 12,
      capabilities: { microphone: { status: "pass" }, camera: { status: "pass" } },
    } },
  } });
}

describe("Guest AI device reconnect session", () => {
  it("requests an authoritative snapshot after opening and restores identity from its result", async () => {
    let callbacks; const adapter = { connect: vi.fn(async (value) => { callbacks = value; await value.onOpen(); }), send: vi.fn(), disconnect: vi.fn(), reconnect: vi.fn() };
    const session = new DeviceSession(adapter); await session.connect();
    expect(adapter.send).toHaveBeenCalledWith(expect.objectContaining({ type: "request_device_snapshot" }));
    session.receive(snapshotMessage());
    expect(session.snapshot).toMatchObject({ connection: "online", robotState: "IDLE", device: { id: "k151-idf-pending", build_profile: "normal", fault_injection_enabled: false }, capabilities: { microphone: "pass", camera: "pass" } });
    expect(callbacks.onReconnect).toBeTypeOf("function");
  });

  it("aborts an active audio turn and clears identity while reconnecting", () => {
    const session = new DeviceSession({ disconnect: vi.fn() });
    session.audioAssembler.start({ turn_id: "old", format: "pcm_s16le", sample_rate_hz: 24000, channels: 1 });
    session.update({ connection: "online", device: { id: "k151" }, audio: { state: "LISTENING" } });
    session.handleDeviceLost(new Error("The device has been lost."));
    expect(session.snapshot).toMatchObject({ connection: "reconnecting", device: null, robotState: "OFFLINE", audio: { state: "IDLE", aborted: "device_disconnected" } });
    expect(session.audioAssembler.turnId).toBeNull();
  });

  it("presents an explicitly cancelled capture as CANCELLED", () => {
    const session = new DeviceSession({ disconnect: vi.fn() });
    session.receive(JSON.stringify({ protocol_version: "1.0", message_id: "started", type: "audio_capture_started", sent_at: "now", payload: { turn_id: "turn-1", format: "pcm_s16le", sample_rate_hz: 24000, channels: 1 } }));
    session.receive(JSON.stringify({ protocol_version: "1.0", message_id: "chunk", type: "audio_capture_chunk", sent_at: "now", payload: { turn_id: "turn-1", sequence: 0, encoding: "base64", pcm: "AAAAAA==", byte_count: 4 } }));
    session.receive(JSON.stringify({ protocol_version: "1.0", message_id: "complete", type: "audio_capture_complete", sent_at: "now", payload: { turn_id: "turn-1", byte_count: 4, duration_ms: 20, completion: "cancelled" } }));
    expect(session.snapshot.audio.state).toBe("CANCELLED");
  });

  it("retains non-sensitive end-of-speech evidence from the completed capture", () => {
    const session = new DeviceSession({ disconnect: vi.fn() });
    session.receive(JSON.stringify({ protocol_version: "1.0", message_id: "started", type: "audio_capture_started", sent_at: "now", payload: { turn_id: "turn-eos", format: "pcm_s16le", sample_rate_hz: 24000, channels: 1 } }));
    session.receive(JSON.stringify({ protocol_version: "1.0", message_id: "speech", type: "audio_capture_stage", sent_at: "now", payload: { turn_id: "turn-eos", stage: "audio_capture_speech_detected", ok: true, elapsed_ms: 260, detail: "rms=700 threshold=450 noise_floor=20" } }));
    session.receive(JSON.stringify({ protocol_version: "1.0", message_id: "chunk", type: "audio_capture_chunk", sent_at: "now", payload: { turn_id: "turn-eos", sequence: 0, encoding: "base64", pcm: "AAAAAA==", byte_count: 4 } }));
    session.receive(JSON.stringify({ protocol_version: "1.0", message_id: "complete", type: "audio_capture_complete", sent_at: "now", payload: { turn_id: "turn-eos", byte_count: 4, duration_ms: 1000, completion: "completed", speech_detected: true, auto_stop: true, current_rms: 20, noise_floor_rms: 20, speech_threshold_rms: 450, release_threshold_rms: 120, release_threshold_q8: 30720, post_speech_silence_entered: true, silence_candidate_blocks: 36, silence_reset_count: 1, longest_trailing_silence_ms: 720, final_eos_state: "auto_stop", auto_stop_reason: "trailing_silence", estimated_speech_end_elapsed_ms: 280, post_speech_silence_ms: 720, time_saved_ms: 5000, eos_calibration: { noise_baseline: { count: 12, min_q8: 100, avg_q8: 120, max_q8: 140 }, after_baseline: { count: 38, min_q8: 90, avg_q8: 260, max_q8: 700 }, top_candidate_rms_q8: [700, 650], count_above_noise: 20, count_above_entry: 5, max_delta_from_noise_q8: 580, max_ratio_to_noise_q8: 1493 }, audio_task_stack_hwm: { unit: "bytes", configured_stack_bytes: 8192, after_task_start_bytes: 6000, after_first_mic_read_bytes: 4800, after_noise_baseline_bytes: 4700, minimum_during_eos_bytes: 4500, before_completion_bytes: 4400 } } }));
    expect(session.snapshot.audio).toMatchObject({ state: "COMPLETE", auto_stop: true, time_saved_ms: 5000, release_threshold_q8: 30720, final_eos_state: "auto_stop", eos_calibration: { count_above_entry: 5, top_candidate_rms_q8: [700, 650] }, audio_task_stack_hwm: { unit: "bytes", minimum_during_eos_bytes: 4500 }, captureDiagnostics: { audio_capture_speech_detected: { elapsed_ms: 260 } } });
  });

  it("transitions a completed transient capture through STT and recovers after an STT failure", () => {
    const session = new DeviceSession({ disconnect: vi.fn() });
    session.audioAssembler.start({ turn_id: "turn-1", format: "pcm_s16le", sample_rate_hz: 24000, channels: 1 });
    session.audioAssembler.append({ turn_id: "turn-1", sequence: 0, encoding: "base64", pcm: "AAAAAA==", byte_count: 4 });
    const capture = session.audioAssembler.complete({ turn_id: "turn-1", byte_count: 4, duration_ms: 20, completion: "completed" });
    session.update({ connection: "online", audio: { state: "COMPLETE", capture } });
    session.beginTranscription("turn-1");
    expect(session.snapshot.audio.state).toBe("TRANSCRIBING");
    session.failTranscription("turn-1", { code: "provider_timeout", message: "Timed out" });
    expect(session.snapshot.audio).toMatchObject({ state: "ERROR", stt: { state: "ERROR", error: { code: "provider_timeout" } } });
  });

  it("moves a successful transcript through THINKING to a bounded LLM reply without device control", () => {
    const session = new DeviceSession({ disconnect: vi.fn() });
    session.audioAssembler.start({ turn_id: "turn-1", format: "pcm_s16le", sample_rate_hz: 24000, channels: 1 });
    session.audioAssembler.append({ turn_id: "turn-1", sequence: 0, encoding: "base64", pcm: "AAAAAA==", byte_count: 4 });
    const capture = session.audioAssembler.complete({ turn_id: "turn-1", byte_count: 4, duration_ms: 20, completion: "completed" });
    session.update({ connection: "online", audio: { state: "COMPLETE", capture } });
    session.beginTranscription("turn-1");
    session.completeTranscription("turn-1", { transcript: "hello", stt_latency_ms: 100 });
    session.beginConversation("turn-1");
    expect(session.snapshot.audio.state).toBe("THINKING");
    session.completeConversation("turn-1", { reply_text: "Hello!", provider: "openai", model: "gpt-4o-mini", llm_latency_ms: 200, usage: { input_tokens: 10, output_tokens: 3 } });
    expect(session.snapshot.audio).toMatchObject({ state: "COMPLETE", conversation: { replyText: "Hello!", totalLatencyMs: 300, usage: { input_tokens: 10 } } });
  });

  it("recovers safely after an LLM failure so a second capture can be started", () => {
    const session = new DeviceSession({ disconnect: vi.fn() });
    session.update({ connection: "online", audio: { state: "COMPLETE", capture: { turnId: "turn-1" }, stt: { state: "COMPLETE", turnId: "turn-1", sttLatencyMs: 1 } } });
    session.beginConversation("turn-1");
    session.failConversation("turn-1", { code: "provider_timeout", message: "Timed out" });
    expect(session.snapshot.audio).toMatchObject({ state: "ERROR", conversation: { state: "ERROR", error: { code: "provider_timeout" } } });
  });
  it("moves the real reply through synthesizing and returns to IDLE only after playback completion", () => {
    const session = new DeviceSession({ disconnect: vi.fn() });
    session.update({ connection: "online", audio: { state: "COMPLETE", capture: { turnId: "turn-1" }, conversation: { state: "COMPLETE", turnId: "turn-1", replyText: "Hello" } } });
    session.beginSynthesis("turn-1");
    expect(session.snapshot.audio.state).toBe("SYNTHESIZING");
    session.completeSynthesis("turn-1", { voice: "alloy", model: "gpt-4o-mini-tts", pcm: new Uint8Array(960), tts_latency_ms: 100 });
    expect(session.snapshot.audio).toMatchObject({ state: "SYNTHESIZING", tts: { voice: "alloy", byteCount: 960 } });
    session.receive(JSON.stringify({ protocol_version: "1.0", message_id: "turn-1", type: "audio_playback_playing", sent_at: "now", payload: { turn_id: "turn-1", phase: "playing", accepted_bytes: 960 } }));
    expect(session.snapshot.audio).toMatchObject({ state: "SPEAKING", playback: { state: "SPEAKING", accepted_bytes: 960 } });
    session.receive(JSON.stringify({ protocol_version: "1.0", message_id: "turn-1", type: "audio_playback_complete", sent_at: "now", payload: { turn_id: "turn-1", completion: "completed", accepted_bytes: 960, played_bytes: 960, chunk_count: 1, write_blocks: 1, allocated_bytes: 960, duration_ms: 20, cleanup_ok: true } }));
    expect(session.snapshot.audio).toMatchObject({ state: "IDLE", tts: { state: "IDLE" }, playback: { completion: "completed", accepted_bytes: 960, complete: true } });
  });

  it("retains non-sensitive playback validation evidence when synthesis cannot be uploaded", () => {
    const session = new DeviceSession({ disconnect: vi.fn() });
    session.update({ connection: "online", audio: { state: "SYNTHESIZING", capture: { turnId: "turn-1" }, tts: { state: "SYNTHESIZING", turnId: "turn-1", byteCount: 288002 } } });
    session.failSynthesis("turn-1", { code: "audio_playback_exceeds_max_bytes", message: "Synthesized speech exceeds the six-second K151 playback limit.", evidence: { byte_count: 288002, max_bytes: 288000, duration_ms: 6000.041666666667, max_duration_ms: 6000 } });
    expect(session.snapshot.audio).toMatchObject({ state: "ERROR", tts: { state: "ERROR", byteCount: 288002, error: { code: "audio_playback_exceeds_max_bytes", evidence: { byte_count: 288002, max_bytes: 288000 } } } });
  });

  it("keeps the final spoken reply for context when a server-side compression occurred", () => {
    const session = new DeviceSession({ disconnect: vi.fn() });
    session.update({ connection: "online", audio: { state: "COMPLETE", capture: { turnId: "turn-1" }, conversation: { state: "COMPLETE", turnId: "turn-1", replyText: "Saya di sini untuk membantu menyambut tetamu seperti anda!" } } });
    session.beginSynthesis("turn-1");
    session.completeSynthesis("turn-1", { voice: "alloy", model: "gpt-4o-mini-tts", pcm: new Uint8Array(960), spoken_reply: "Saya di sini untuk bantu anda!", reply_shortened: true, compression: { triggered: true }, playback_budget: { max_playback_duration_ms: 6000 } });
    expect(session.snapshot.audio.conversation).toMatchObject({ replyText: "Saya di sini untuk membantu menyambut tetamu seperti anda!", spokenReplyText: "Saya di sini untuk bantu anda!", replyShortened: true });
  });

  it("correlates a playback chunk ACK before the sender can advance its sequence", async () => {
    const adapter = { send: vi.fn(async () => {}), disconnect: vi.fn() };
    const session = new DeviceSession(adapter);
    session.update({ connection: "online", device: { id: "k151" } });
    const acknowledgement = session.sendPlaybackChunkAndWait({ turnId: "turn-1", sequence: 0, pcm: "AAAAAA==", byteCount: 4, commandId: "chunk-0" });
    expect(adapter.send).toHaveBeenCalledWith(expect.objectContaining({ message_id: "chunk-0", type: "audio_playback_chunk" }));
    session.receive(JSON.stringify({ protocol_version: "1.0", message_id: "chunk-0", type: "command_result", sent_at: "now", payload: {
      command_type: "audio_playback_chunk", status: "ok", detail: "audio_playback_chunk_accepted", evidence: { turn_id: "turn-1", sequence: 0, accepted: true, queued_chunks: 1, queue_capacity: 4, remaining_credit: 3 },
    } }));
    await expect(acknowledgement).resolves.toMatchObject({ status: "ok", evidence: { accepted: true, sequence: 0 } });
  });

  it("delivers only matching, valid playback credit to the active session", async () => {
    const session = new DeviceSession({ disconnect: vi.fn() });
    session.update({ connection: "online", audio: { state: "SPEAKING", tts: { turnId: "turn-1", byteCount: 960 } } });
    const waiting = session.waitForPlaybackCredit("turn-1");
    session.receive(JSON.stringify({ protocol_version: "1.0", message_id: "stale", type: "audio_playback_credit", sent_at: "now", payload: { turn_id: "other", queued_chunks: 1, queue_capacity: 4, remaining_credit: 3, accepted_bytes: 960, played_bytes: 0 } }));
    expect(session.playbackCredit).toBeNull();
    session.receive(JSON.stringify({ protocol_version: "1.0", message_id: "credit", type: "audio_playback_credit", sent_at: "now", payload: { turn_id: "turn-1", queued_chunks: 1, queue_capacity: 4, remaining_credit: 3, accepted_bytes: 960, played_bytes: 0 } }));
    await expect(waiting).resolves.toMatchObject({ turn_id: "turn-1", remaining_credit: 3 });
  });

  it("rejects an in-flight playback ACK when the device disconnects", async () => {
    const adapter = { send: vi.fn(async () => {}), disconnect: vi.fn() };
    const session = new DeviceSession(adapter);
    session.update({ connection: "online", device: { id: "k151" } });
    const acknowledgement = session.sendPlaybackChunkAndWait({ turnId: "turn-1", sequence: 0, pcm: "AAAAAA==", byteCount: 4, commandId: "chunk-lost" });
    session.handleDeviceLost(new Error("device_lost"));
    await expect(acknowledgement).rejects.toThrow("device_lost");
    expect(session.pendingCommands.size).toBe(0);
  });
});
