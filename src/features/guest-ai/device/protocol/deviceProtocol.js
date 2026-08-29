export const DEVICE_PROTOCOL_VERSION = "1.0";
export const DEVICE_EVENTS = Object.freeze(["device_connected", "heartbeat", "capability_status", "sensor_event", "audio_capture_stage", "audio_capture_started", "audio_capture_chunk", "audio_capture_complete", "audio_playback_started", "audio_playback_playing", "audio_playback_credit", "audio_playback_complete", "command_result", "error"]);
export const DEVICE_COMMANDS = Object.freeze(["set_expression", "set_gaze", "play_audio", "set_robot_state", "request_capability_test", "request_device_snapshot", "audio_capture_start", "audio_capture_end", "audio_playback_start", "audio_playback_chunk", "audio_playback_end", "audio_playback_cancel"]);

function makeId() { return globalThis.crypto?.randomUUID?.() ?? `guest-ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }
const isNonNegativeInteger = (value) => Number.isInteger(value) && value >= 0;

function validatePlaybackCredit(payload) {
  if (typeof payload.turn_id !== "string" || !payload.turn_id) throw new Error("audio_playback_credit requires turn_id.");
  for (const field of ["queued_chunks", "queue_capacity", "remaining_credit", "accepted_bytes", "played_bytes"]) {
    if (!isNonNegativeInteger(payload[field])) throw new Error(`audio_playback_credit requires non-negative integer ${field}.`);
  }
  if (payload.queued_chunks > payload.queue_capacity || payload.remaining_credit > payload.queue_capacity) throw new Error("audio_playback_credit exceeds queue_capacity.");
  if (payload.queued_chunks + payload.remaining_credit !== payload.queue_capacity) throw new Error("audio_playback_credit queue accounting is inconsistent.");
  if (payload.played_bytes > payload.accepted_bytes) throw new Error("audio_playback_credit played_bytes exceeds accepted_bytes.");
}

function validatePlaybackComplete(payload) {
  if (typeof payload.turn_id !== "string" || !payload.turn_id) throw new Error("audio_playback_complete requires turn_id.");
  for (const field of ["accepted_bytes", "played_bytes", "chunk_count", "duration_ms"]) {
    if (!isNonNegativeInteger(payload[field])) throw new Error(`audio_playback_complete requires non-negative integer ${field}.`);
  }
  if (payload.max_queue_depth !== undefined && !isNonNegativeInteger(payload.max_queue_depth)) throw new Error("audio_playback_complete max_queue_depth must be a non-negative integer.");
  if (payload.write_blocks !== undefined && !isNonNegativeInteger(payload.write_blocks)) throw new Error("audio_playback_complete write_blocks must be a non-negative integer.");
  if (payload.allocated_bytes !== undefined && !isNonNegativeInteger(payload.allocated_bytes)) throw new Error("audio_playback_complete allocated_bytes must be a non-negative integer.");
  if (!['completed', 'cancelled', 'error'].includes(payload.completion)) throw new Error("audio_playback_complete requires a valid completion.");
  if (typeof payload.cleanup_ok !== "boolean") throw new Error("audio_playback_complete requires cleanup_ok.");
}

function validatePlaybackPlaying(payload) {
  if (typeof payload.turn_id !== "string" || !payload.turn_id) throw new Error("audio_playback_playing requires turn_id.");
  if (payload.phase !== "playing") throw new Error("audio_playback_playing requires phase=playing.");
  if (!isNonNegativeInteger(payload.accepted_bytes)) throw new Error("audio_playback_playing requires accepted_bytes.");
}

function validateRmsDistribution(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an object.`);
  for (const key of ["count", "min_q8", "avg_q8", "max_q8"]) {
    if (!isNonNegativeInteger(value[key])) throw new Error(`${field} requires non-negative integer ${key}.`);
  }
  if (value.count === 0 && (value.min_q8 || value.avg_q8 || value.max_q8)) throw new Error(`${field} cannot have values when count is zero.`);
  if (value.count > 0 && (value.min_q8 > value.avg_q8 || value.avg_q8 > value.max_q8)) throw new Error(`${field} min/avg/max ordering is invalid.`);
}

function validateCaptureDiagnostics(payload) {
  for (const key of [
    "release_threshold_rms",
    "release_threshold_q8",
    "possible_end_at_ms",
    "final_end_threshold_ms",
    "longest_pending_pause_ms",
    "pending_eos_cancel_count",
    "final_auto_stop_silence_ms",
    "silence_candidate_blocks",
    "silence_reset_count",
    "longest_trailing_silence_ms",
  ]) {
    if (payload[key] !== undefined && !isNonNegativeInteger(payload[key])) {
      throw new Error(`audio_capture_complete ${key} must be a non-negative integer.`);
    }
  }
  if (payload.post_speech_silence_entered !== undefined && typeof payload.post_speech_silence_entered !== "boolean") {
    throw new Error("audio_capture_complete post_speech_silence_entered must be boolean.");
  }
  for (const key of ["possible_end_entered", "speech_resumed_during_pending"]) {
    if (payload[key] !== undefined && typeof payload[key] !== "boolean") {
      throw new Error(`audio_capture_complete ${key} must be boolean.`);
    }
  }
  if (payload.final_eos_state !== undefined && !["waiting_for_speech", "speaking", "possible_end", "final_end", "auto_stop"].includes(payload.final_eos_state)) {
    throw new Error("audio_capture_complete final_eos_state is invalid.");
  }
  if (payload.auto_stop_reason !== undefined && !["trailing_silence", "safety_cap", "cancelled", "capture_error"].includes(payload.auto_stop_reason)) {
    throw new Error("audio_capture_complete auto_stop_reason is invalid.");
  }
  if (payload.eos_calibration !== undefined) {
    const calibration = payload.eos_calibration;
    if (!calibration || typeof calibration !== "object" || Array.isArray(calibration)) throw new Error("audio_capture_complete eos_calibration must be an object.");
    validateRmsDistribution(calibration.noise_baseline, "eos_calibration.noise_baseline");
    validateRmsDistribution(calibration.after_baseline, "eos_calibration.after_baseline");
    for (const key of ["count_above_noise", "count_above_entry", "max_delta_from_noise_q8", "max_ratio_to_noise_q8"]) {
      if (!isNonNegativeInteger(calibration[key])) throw new Error(`eos_calibration requires non-negative integer ${key}.`);
    }
    if (!Array.isArray(calibration.top_candidate_rms_q8) || calibration.top_candidate_rms_q8.length > 8 || calibration.top_candidate_rms_q8.some((value) => !isNonNegativeInteger(value))) throw new Error("eos_calibration top_candidate_rms_q8 must contain at most eight non-negative integers.");
  }
  if (payload.audio_task_stack_hwm !== undefined) {
    const stack = payload.audio_task_stack_hwm;
    if (!stack || typeof stack !== "object" || Array.isArray(stack) || stack.unit !== "bytes") throw new Error("audio_task_stack_hwm requires unit=bytes.");
    for (const key of ["configured_stack_bytes", "after_task_start_bytes", "after_first_mic_read_bytes", "after_noise_baseline_bytes", "minimum_during_eos_bytes", "before_completion_bytes"]) {
      if (!isNonNegativeInteger(stack[key])) throw new Error(`audio_task_stack_hwm requires non-negative integer ${key}.`);
      if (stack[key] > stack.configured_stack_bytes) throw new Error(`audio_task_stack_hwm ${key} exceeds configured_stack_bytes.`);
    }
  }
}

export function createDeviceCommand(type, payload = {}, { deviceId = null, commandId = makeId() } = {}) {
  if (!DEVICE_COMMANDS.includes(type)) throw new Error(`Unsupported Guest AI device command: ${type}`);
  return { protocol_version: DEVICE_PROTOCOL_VERSION, message_id: commandId, type, device_id: deviceId, sent_at: new Date().toISOString(), payload };
}

export function parseDeviceMessage(value) {
  const message = typeof value === "string" ? JSON.parse(value) : value;
  if (!message || typeof message !== "object" || Array.isArray(message)) throw new Error("Device message must be an object.");
  if (message.protocol_version !== DEVICE_PROTOCOL_VERSION) throw new Error(`Unsupported device protocol version: ${message.protocol_version ?? "missing"}`);
  if (!DEVICE_EVENTS.includes(message.type)) throw new Error(`Unsupported Guest AI device event: ${message.type ?? "missing"}`);
  if (!message.message_id || !message.sent_at) throw new Error("Device message requires message_id and sent_at.");
  if (message.payload !== undefined && (!message.payload || typeof message.payload !== "object" || Array.isArray(message.payload))) throw new Error("Device message payload must be an object when provided.");
  if (message.type === "audio_playback_credit") validatePlaybackCredit(message.payload ?? {});
  if (message.type === "audio_playback_playing") validatePlaybackPlaying(message.payload ?? {});
  if (message.type === "audio_playback_complete") validatePlaybackComplete(message.payload ?? {});
  if (message.type === "audio_capture_complete") validateCaptureDiagnostics(message.payload ?? {});
  return { ...message, payload: message.payload ?? {} };
}

export function encodeDeviceMessage(message) { return `${JSON.stringify(message)}\n`; }
