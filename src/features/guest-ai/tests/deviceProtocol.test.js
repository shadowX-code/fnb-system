import { describe, expect, it } from "vitest";
import { createDeviceCommand, encodeDeviceMessage, parseDeviceMessage } from "../device/protocol/deviceProtocol.js";
import { ROBOT_STATES, isRobotState } from "../robot/states.js";
describe("Guest AI device protocol", () => {
  it("creates newline-delimited canonical commands", () => { const command = createDeviceCommand("set_expression", { expression: "happy" }, { deviceId: "k151-1", commandId: "cmd-1" }); expect(command).toMatchObject({ protocol_version: "1.0", message_id: "cmd-1", type: "set_expression", device_id: "k151-1" }); expect(encodeDeviceMessage(command)).toBe(`${JSON.stringify(command)}\n`); });
  it("accepts the required device_connected event", () => { expect(parseDeviceMessage({ protocol_version: "1.0", message_id: "m-1", type: "device_connected", device_id: "k151-1", sent_at: "2026-08-22T00:00:00.000Z", payload: { model: "K151" } })).toMatchObject({ type: "device_connected", payload: { model: "K151" } }); });
  it("rejects unknown versions and event types", () => { expect(() => parseDeviceMessage({ protocol_version: "2.0", message_id: "m", type: "heartbeat", sent_at: "now" })).toThrow("Unsupported"); expect(() => parseDeviceMessage({ protocol_version: "1.0", message_id: "m", type: "unknown", sent_at: "now" })).toThrow("Unsupported"); });
  it("keeps the canonical bounded robot states", () => { expect(ROBOT_STATES).toEqual(["OFFLINE", "BOOTING", "IDLE", "ATTENTION", "LISTENING", "THINKING", "SPEAKING", "ERROR"]); expect(isRobotState("SPEAKING")).toBe(true); expect(isRobotState("CHATTING")).toBe(false); });
  it("keeps audio transport separate from capability evidence", () => { const start = createDeviceCommand("audio_capture_start", { turn_id: "turn-1", max_duration_ms: 6000 }, { commandId: "capture-1" }); expect(start.type).toBe("audio_capture_start"); expect(parseDeviceMessage({ protocol_version: "1.0", message_id: "turn-1", type: "audio_capture_complete", sent_at: "now", payload: { turn_id: "turn-1", byte_count: 960 } }).type).toBe("audio_capture_complete"); });
  it("keeps bounded playback in the same canonical audio transport", () => {
    expect(createDeviceCommand("audio_playback_start", { turn_id: "turn-1", format: "pcm_s16le", sample_rate_hz: 24000, channels: 1, total_bytes: 960 }, { commandId: "play-1" }).type).toBe("audio_playback_start");
    expect(createDeviceCommand("audio_playback_chunk", { turn_id: "turn-1", sequence: 0, byte_count: 4, encoding: "base64", pcm: "AAAAAA==" }, { commandId: "play-2" }).type).toBe("audio_playback_chunk");
    expect(createDeviceCommand("audio_playback_cancel", { turn_id: "turn-1", reason: "host_cancelled" }, { commandId: "play-3" }).type).toBe("audio_playback_cancel");
    // Prebuffer playback completes after local codec drain; it has no realtime
    // queue-depth requirement.  The legacy field remains optional only.
    expect(parseDeviceMessage({ protocol_version: "1.0", message_id: "turn-1", type: "audio_playback_complete", sent_at: "now", payload: { turn_id: "turn-1", completion: "completed", accepted_bytes: 960, played_bytes: 960, chunk_count: 1, write_blocks: 1, allocated_bytes: 960, duration_ms: 20, cleanup_ok: true } }).type).toBe("audio_playback_complete");
    expect(parseDeviceMessage({ protocol_version: "1.0", message_id: "turn-1", type: "audio_playback_playing", sent_at: "now", payload: { turn_id: "turn-1", phase: "playing", accepted_bytes: 960 } }).type).toBe("audio_playback_playing");
    expect(parseDeviceMessage({ protocol_version: "1.0", message_id: "credit-1", type: "audio_playback_credit", sent_at: "now", payload: { turn_id: "turn-1", queued_chunks: 1, queue_capacity: 4, remaining_credit: 3, accepted_bytes: 960, played_bytes: 0 } }).type).toBe("audio_playback_credit");
  });
  it("strictly validates playback credit accounting while retaining unknown-event rejection", () => {
    const message = { protocol_version: "1.0", message_id: "credit-1", type: "audio_playback_credit", sent_at: "now", payload: { turn_id: "turn-1", queued_chunks: 1, queue_capacity: 4, remaining_credit: 3, accepted_bytes: 960, played_bytes: 0 } };
    expect(parseDeviceMessage(message).payload.remaining_credit).toBe(3);
    expect(() => parseDeviceMessage({ ...message, payload: { ...message.payload, remaining_credit: 5 } })).toThrow("queue_capacity");
    expect(() => parseDeviceMessage({ ...message, payload: { ...message.payload, played_bytes: 961 } })).toThrow("played_bytes");
    expect(() => parseDeviceMessage({ ...message, type: "audio_playback_future_event" })).toThrow("Unsupported Guest AI device event");
  });
  it("keeps device snapshot recovery in the canonical command envelope", () => { expect(createDeviceCommand("request_device_snapshot", {}, { commandId: "snapshot-1" })).toMatchObject({ type: "request_device_snapshot", message_id: "snapshot-1" }); });
  it("accepts capture stages as non-terminal transport diagnostics", () => {
    expect(parseDeviceMessage({ protocol_version: "1.0", message_id: "turn-1", type: "audio_capture_stage", sent_at: "now", payload: { turn_id: "turn-1", stage: "audio_capture_task_started", ok: true, elapsed_ms: 0 } }).type).toBe("audio_capture_stage");
  });
  it("validates bounded EOS and stack summaries while retaining unknown-event rejection", () => {
    const payload = { turn_id: "turn-eos", byte_count: 960, duration_ms: 1000, completion: "completed", release_threshold_rms: 4, release_threshold_q8: 960, post_speech_silence_entered: true, possible_end_entered: true, possible_end_at_ms: 640, final_end_threshold_ms: 1120, speech_resumed_during_pending: true, longest_pending_pause_ms: 900, pending_eos_cancel_count: 1, final_auto_stop_silence_ms: 1120, silence_candidate_blocks: 56, silence_reset_count: 2, longest_trailing_silence_ms: 1120, final_eos_state: "auto_stop", auto_stop_reason: "trailing_silence", eos_calibration: { noise_baseline: { count: 12, min_q8: 1024, avg_q8: 1280, max_q8: 1536 }, after_baseline: { count: 30, min_q8: 768, avg_q8: 2048, max_q8: 4096 }, top_candidate_rms_q8: [4096, 3840], count_above_noise: 24, count_above_entry: 8, max_delta_from_noise_q8: 2816, max_ratio_to_noise_q8: 819 }, audio_task_stack_hwm: { unit: "bytes", configured_stack_bytes: 8192, after_task_start_bytes: 6000, after_first_mic_read_bytes: 4800, after_noise_baseline_bytes: 4700, minimum_during_eos_bytes: 4500, before_completion_bytes: 4400 } };
    expect(parseDeviceMessage({ protocol_version: "1.0", message_id: "turn-eos", type: "audio_capture_complete", sent_at: "now", payload }).payload.eos_calibration.top_candidate_rms_q8).toHaveLength(2);
    expect(() => parseDeviceMessage({ protocol_version: "1.0", message_id: "bad-eos", type: "audio_capture_complete", sent_at: "now", payload: { ...payload, eos_calibration: { ...payload.eos_calibration, top_candidate_rms_q8: Array(9).fill(1) } } })).toThrow("top_candidate");
    expect(() => parseDeviceMessage({ protocol_version: "1.0", message_id: "bad-stack", type: "audio_capture_complete", sent_at: "now", payload: { ...payload, audio_task_stack_hwm: { ...payload.audio_task_stack_hwm, unit: "words" } } })).toThrow("unit=bytes");
    expect(() => parseDeviceMessage({ protocol_version: "1.0", message_id: "bad-exit", type: "audio_capture_complete", sent_at: "now", payload: { ...payload, final_eos_state: "invalid" } })).toThrow("final_eos_state");
    expect(() => parseDeviceMessage({ protocol_version: "1.0", message_id: "bad-pause", type: "audio_capture_complete", sent_at: "now", payload: { ...payload, possible_end_entered: "yes" } })).toThrow("possible_end_entered");
  });
});
