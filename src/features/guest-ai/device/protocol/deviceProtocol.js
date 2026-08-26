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
  return { ...message, payload: message.payload ?? {} };
}

export function encodeDeviceMessage(message) { return `${JSON.stringify(message)}\n`; }
