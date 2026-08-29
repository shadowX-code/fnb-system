#include "device_protocol.hpp"

#include <algorithm>
#include <cstdarg>
#include <cstddef>
#include <cstring>
#include <cstdio>

#include <cJSON.h>
#include <driver/usb_serial_jtag.h>
#include <esp_err.h>
#include <esp_heap_caps.h>
#include <esp_log.h>
#include <esp_system.h>
#include <esp_timer.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <mbedtls/base64.h>

#include <k151_board.hpp>
#include <capture_evidence.hpp>

#include "protocol_rules.hpp"
#include "end_of_speech_detector.hpp"
#include "motion_authority.hpp"
#include "usb_tx_full_write.hpp"
#if CONFIG_FEEDX_GUEST_AI_FAULT_INJECTION
#include "fault_injection.hpp"
#include "fault_injection_c.h"
#endif

namespace guest_ai::protocol {
namespace {

constexpr const char* kProtocolVersion = "1.0";
constexpr const char* kDeviceId = "k151-idf-pending";
constexpr const char* kBridgeVersion = "0.5.0-idf";
#if CONFIG_FEEDX_GUEST_AI_FAULT_INJECTION
constexpr const char* kBuildProfile = "fault-test";
constexpr bool kFaultInjectionEnabled = true;
#else
constexpr const char* kBuildProfile = "normal";
constexpr bool kFaultInjectionEnabled = false;
#endif
constexpr const char* kTag = "guest_ai_protocol";
constexpr uint32_t kAudioSampleRate = 24000;
constexpr uint32_t kAudioChunkDurationMs = 20;
constexpr uint32_t kAudioMaxDurationMs = 6000;
constexpr uint32_t kAudioMaxBytes = 288000;
// The capture task calls the codec read path and per-block metrics helper;
// reserve one bounded budget for that established call depth.
constexpr uint32_t kAudioCaptureTaskStackBytes = 8192;
constexpr EndOfSpeechConfig kEndOfSpeechConfig{};
constexpr uint32_t kPlaybackMaxBytes = 288000;  // 6 s at 24 kHz S16LE mono.
// The largest raw chunk whose fully serialized JSON-line stays below the
// production 2 KiB framer limit with UUID-sized identifiers.
constexpr uint32_t kPlaybackChunkBytes = 1024;
constexpr uint32_t kPlaybackWriteBlockBytes = 4096;
StaticSemaphore_t s_tx_lock_storage;
SemaphoreHandle_t s_tx_lock{};

bool lock_tx() {
  if (!s_tx_lock) s_tx_lock = xSemaphoreCreateMutexStatic(&s_tx_lock_storage);
  return s_tx_lock && xSemaphoreTake(s_tx_lock, pdMS_TO_TICKS(1000)) == pdTRUE;
}

// Every protocol frame is serialized by send_message().  The ESP-IDF console
// uses the same USB Serial/JTAG byte stream, though, so suppress console logs
// only while a PCM session is active.  Audio diagnostics below remain protocol
// frames and therefore retain the same serialization guarantee as chunks.
vprintf_like_t s_console_vprintf{};
bool s_protocol_exclusive_wire{};
int discard_console_log(const char*, va_list) { return 0; }
void enable_protocol_exclusive_wire() {
  if (!s_protocol_exclusive_wire) {
    s_console_vprintf = esp_log_set_vprintf(discard_console_log);
    s_protocol_exclusive_wire = true;
  }
}
void set_audio_console_suppressed(bool suppressed) {
  if (s_protocol_exclusive_wire) return;
  if (suppressed) {
    if (!s_console_vprintf) s_console_vprintf = esp_log_set_vprintf(discard_console_log);
  } else if (s_console_vprintf) {
    esp_log_set_vprintf(s_console_vprintf);
    s_console_vprintf = nullptr;
  }
}

bool send_message(const char* type, const char* message_id, cJSON* payload);

void add_hex_preview(cJSON* object, const char* key, const uint8_t* bytes, size_t count) {
  static constexpr char kHex[] = "0123456789abcdef";
  char text[33]{};
  const size_t bounded = count < 16 ? count : 16;
  for (size_t index = 0; index < bounded; ++index) {
    text[index * 2] = kHex[(bytes[index] >> 4) & 0x0f];
    text[index * 2 + 1] = kHex[bytes[index] & 0x0f];
  }
  cJSON_AddStringToObject(object, key, text);
}

void audio_stage(const char* turn_id, const char* stage, bool ok, const char* detail, uint32_t elapsed_ms) {
  cJSON* payload = cJSON_CreateObject();
  cJSON_AddStringToObject(payload, "turn_id", turn_id ? turn_id : "");
  cJSON_AddStringToObject(payload, "stage", stage);
  cJSON_AddBoolToObject(payload, "ok", ok);
  cJSON_AddStringToObject(payload, "detail", detail ? detail : "");
  cJSON_AddNumberToObject(payload, "elapsed_ms", elapsed_ms);
  send_message("audio_capture_stage", turn_id ? turn_id : "audio", payload);
}

uint32_t current_task_stack_hwm_bytes() {
  // ESP-IDF intentionally reports this API in bytes (not upstream FreeRTOS
  // words). It is the minimum remaining stack observed since task creation.
  return static_cast<uint32_t>(uxTaskGetStackHighWaterMark(nullptr));
}

void add_rms_distribution(cJSON* payload, const char* key, const RmsDistribution& distribution) {
  cJSON* object = cJSON_AddObjectToObject(payload, key);
  cJSON_AddNumberToObject(object, "count", distribution.count);
  cJSON_AddNumberToObject(object, "min_q8", distribution.minimum_q8);
  cJSON_AddNumberToObject(object, "avg_q8", distribution.average_q8());
  cJSON_AddNumberToObject(object, "max_q8", distribution.maximum_q8);
}

void add_capability(cJSON* capabilities, const char* name, const char* status, const char* detail) {
  cJSON* value = cJSON_AddObjectToObject(capabilities, name);
  cJSON_AddStringToObject(value, "status", status);
  cJSON_AddStringToObject(value, "detail", detail);
}

const char* s_tx_fault_command_id{}; bool s_tx_fault_first_write{};
#if CONFIG_FEEDX_GUEST_AI_FAULT_INJECTION
struct UsbFaultTelemetry {
  const char* type{};
  char armed_by[40]{};
  char triggered_by[40]{};
  bool triggered{};
  size_t first_requested{};
  int first_actual{};
};
UsbFaultTelemetry s_tx_fault_telemetry{};

void record_usb_fault(const char* type, const char* command_id, size_t requested, int actual) {
  const auto state = guest_ai::fault::snapshot();
  s_tx_fault_telemetry = {type, {}, {}, true, requested, actual};
  std::strncpy(s_tx_fault_telemetry.armed_by, state.armed_by, sizeof(s_tx_fault_telemetry.armed_by) - 1);
  std::strncpy(s_tx_fault_telemetry.triggered_by, command_id, sizeof(s_tx_fault_telemetry.triggered_by) - 1);
}
#endif
int tx_write(void*, const char* data, size_t length, uint32_t timeout_ms) {
#if CONFIG_FEEDX_GUEST_AI_FAULT_INJECTION
  if (s_tx_fault_first_write && s_tx_fault_command_id) { s_tx_fault_first_write=false;
    if (feedx_fault_consume_usb_tx_zero_progress_once(s_tx_fault_command_id)) {
      record_usb_fault("usb_tx_zero_progress_once", s_tx_fault_command_id, length, 0);
      return 0;
    }
    if (feedx_fault_consume_usb_tx_partial_once(s_tx_fault_command_id)) {
      const int actual = usb_serial_jtag_write_bytes(data, length > 32 ? 32 : length, timeout_ms);
      record_usb_fault("usb_tx_partial_once", s_tx_fault_command_id, length, actual);
      return actual;
    }
  }
#endif
  return usb_serial_jtag_write_bytes(data, length, timeout_ms);
}
uint64_t tx_now(void*) { return static_cast<uint64_t>(esp_timer_get_time()); }
void tx_wait(void*) { vTaskDelay(pdMS_TO_TICKS(1)); }

bool send_message(const char* type, const char* message_id, cJSON* payload) {
  if (!lock_tx()) { cJSON_Delete(payload); ESP_LOGE(kTag, "protocol_tx_lock_timeout type=%s", type); return false; }
  cJSON* envelope = cJSON_CreateObject();
  cJSON_AddStringToObject(envelope, "protocol_version", kProtocolVersion);
  cJSON_AddStringToObject(envelope, "message_id", message_id);
  cJSON_AddStringToObject(envelope, "type", type);
  cJSON_AddStringToObject(envelope, "device_id", kDeviceId);
  cJSON_AddNumberToObject(envelope, "sent_at", static_cast<double>(esp_timer_get_time() / 1000));
  cJSON_AddItemToObject(envelope, "payload", payload);

  char* wire = cJSON_PrintUnformatted(envelope);
  bool sent = false;
  if (wire) {
    const size_t length = std::strlen(wire);
    s_tx_fault_first_write = s_tx_fault_command_id != nullptr;
#if CONFIG_FEEDX_GUEST_AI_FAULT_INJECTION
    s_tx_fault_telemetry = {};
#endif
    const UsbTxWriteOps ops{nullptr,tx_write,tx_now,tx_wait}; UsbTxWriteResult body{}, newline{};
    const bool body_ok = usb_tx_write_full(ops, wire, length, &body);
    const bool newline_ok = body_ok && usb_tx_write_full(ops, "\n", 1, &newline);
    ESP_LOGI(kTag, "protocol_tx type=%s command_id=%s intended=%u body_written=%u newline_written=%u result=%d", type, message_id,
             static_cast<unsigned>(length + 1), static_cast<unsigned>(body.written), static_cast<unsigned>(newline.written), body_ok && newline_ok);
#if CONFIG_FEEDX_GUEST_AI_FAULT_INJECTION
    if (s_tx_fault_telemetry.triggered) {
      const uint32_t retries = body.calls ? body.calls - 1 : 0;
      ESP_LOGI(kTag,
               "fault_tx type=%s armed_by=%s triggered_by=%s triggered=1 first_requested=%u first_actual=%d retries=%u remaining=%u subsequent_writes=%u final_body_written=%u newline_written=%u tx_complete=%d tx_failed=%d auto_cleared=1",
               s_tx_fault_telemetry.type, s_tx_fault_telemetry.armed_by, s_tx_fault_telemetry.triggered_by,
               static_cast<unsigned>(s_tx_fault_telemetry.first_requested), s_tx_fault_telemetry.first_actual,
               static_cast<unsigned>(retries),
               static_cast<unsigned>(length > static_cast<size_t>(s_tx_fault_telemetry.first_actual > 0 ? s_tx_fault_telemetry.first_actual : 0)
                   ? length - static_cast<size_t>(s_tx_fault_telemetry.first_actual > 0 ? s_tx_fault_telemetry.first_actual : 0) : 0),
               static_cast<unsigned>(retries), static_cast<unsigned>(body.written), static_cast<unsigned>(newline.written),
               body_ok && newline_ok, !(body_ok && newline_ok));
    }
#endif
    sent = body_ok && newline_ok;
    s_tx_fault_command_id=nullptr;
    cJSON_free(wire);
  } else {
    ESP_LOGE(kTag, "protocol_tx type=%s command_id=%s serialize_failed", type, message_id);
  }
  cJSON_Delete(envelope);
  xSemaphoreGive(s_tx_lock);
  return sent;
}

const char* state_expression(const char* state) {
  if (std::strcmp(state, "LISTENING") == 0) return "listening";
  if (std::strcmp(state, "THINKING") == 0) return "thinking";
  if (std::strcmp(state, "SPEAKING") == 0) return "speaking";
  if (std::strcmp(state, "ATTENTION") == 0) return "happy";
  return "neutral";
}

}  // namespace

#if CONFIG_FEEDX_GUEST_AI_FAULT_INJECTION
extern "C" bool feedx_test_send_message(const char* type, const char* command_id, const char* detail) {
  cJSON* payload=cJSON_CreateObject();
  cJSON_AddStringToObject(payload,"command_id",command_id);
  cJSON_AddStringToObject(payload,"detail",detail);
  return send_message(type,command_id,payload);
}
#endif

Transport::Transport()
    : framer_(&Transport::handle_frame, &Transport::handle_framing_error, this) {}

void Transport::enable_protocol_exclusive_wire() { ::guest_ai::protocol::enable_protocol_exclusive_wire(); }

void Transport::handle_frame(void* context, const char* frame) {
  static_cast<Transport*>(context)->dispatch(frame);
}

void Transport::handle_framing_error(void* context, const char* code) {
  static_cast<Transport*>(context)->error("invalid", code);
}

void Transport::ingest(const uint8_t* bytes, size_t count) {
  framer_.ingest(reinterpret_cast<const unsigned char*>(bytes), count);
}

void Transport::reset() {
  framer_.reset();
  audio_capture_cancel_ = true;
  if (audio_playback_active_) abort_audio_playback("audio_playback_device_disconnected");
}

bool Transport::start_audio_capture(const char* command_id, const char* turn_id, uint32_t max_duration_ms) {
  audio_stage(turn_id, "audio_capture_command_received", true, "dispatch", 0);
  if (audio_capture_active_ || !turn_id || !*turn_id || std::strlen(turn_id) >= sizeof(audio_turn_id_) || max_duration_ms == 0 || max_duration_ms > kAudioMaxDurationMs) {
    audio_stage(turn_id, "audio_capture_validated", false, audio_capture_active_ ? "busy" : "invalid", 0); return false;
  }
  audio_stage(turn_id, "audio_capture_validated", true, "ok", 0);
  audio_capture_state_ = AudioCaptureState::Starting;
  std::strncpy(audio_turn_id_, turn_id, sizeof(audio_turn_id_) - 1);
  audio_max_duration_ms_ = max_duration_ms;
  audio_capture_cancel_ = false;
  audio_capture_active_ = true;
  audio_stage(turn_id, "audio_capture_session_created", true, "starting", 0);
  audio_stage(turn_id, "audio_capture_task_create_begin", true, "stack=8192_priority=1", 0);
  if (xTaskCreate(audio_capture_task, "guest_ai_audio", kAudioCaptureTaskStackBytes, this, tskIDLE_PRIORITY + 1,
                  &audio_capture_task_handle_) != pdPASS) {
    audio_capture_active_ = false;
    audio_capture_state_ = AudioCaptureState::Failed;
    audio_stage(turn_id, "audio_capture_task_created", false, "xTaskCreate_failed", 0);
    result(command_id, "audio_capture_start", false, "audio_capture_task_create_failed");
    return false;
  }
  audio_stage(turn_id, "audio_capture_task_created", true, "ok", 0);
  result(command_id, "audio_capture_start", true, "audio_capture_started");
  return true;
}

void Transport::stop_audio_capture(const char* command_id, const char* reason) {
  if (!audio_capture_active_) { error(command_id, "no_active_audio_capture"); return; }
  audio_capture_cancel_ = true;
  audio_stage(audio_turn_id_, "audio_capture_cancel_requested", true, reason, 0);
  result(command_id, "audio_capture_end", true, reason);
}

bool Transport::start_audio_playback(const char* command_id, const char* turn_id, uint32_t sample_rate_hz, uint32_t channels, uint32_t total_bytes) {
  if (audio_playback_active_ || audio_capture_active_ || !turn_id || !*turn_id || std::strlen(turn_id) >= sizeof(audio_playback_turn_id_) ||
      sample_rate_hz != kAudioSampleRate || channels != 1 || total_bytes == 0 || total_bytes > kPlaybackMaxBytes || total_bytes % 2 != 0) {
    error(command_id, "audio_playback_start_rejected");
    return false;
  }
  const uint32_t heap_before = esp_get_free_heap_size();
  auto* buffer = static_cast<uint8_t*>(heap_caps_malloc(total_bytes, MALLOC_CAP_8BIT));
  if (!buffer) {
    cJSON* evidence = cJSON_CreateObject();
    cJSON_AddNumberToObject(evidence, "requested_bytes", total_bytes);
    cJSON_AddNumberToObject(evidence, "free_heap_before", heap_before);
    result(command_id, "audio_playback_start", false, "audio_playback_prebuffer_allocation_failed", evidence);
    return false;
  }
  audio_playback_buffer_ = buffer;
  audio_playback_allocated_bytes_ = total_bytes;
  audio_playback_free_heap_before_ = heap_before;
  std::strncpy(audio_playback_turn_id_, turn_id, sizeof(audio_playback_turn_id_) - 1);
  audio_playback_flow_.start(total_bytes);
  audio_playback_abort_requested_ = false;
  audio_playback_failure_[0] = '\0';
  audio_playback_active_ = true;
  audio_playback_state_ = AudioPlaybackState::Receiving;
  cJSON* payload = cJSON_CreateObject();
  cJSON_AddStringToObject(payload, "turn_id", turn_id);
  cJSON_AddNumberToObject(payload, "sample_rate_hz", sample_rate_hz);
  cJSON_AddNumberToObject(payload, "channels", channels);
  cJSON_AddNumberToObject(payload, "total_bytes", total_bytes);
  cJSON_AddNumberToObject(payload, "chunk_bytes", kPlaybackChunkBytes);
  cJSON_AddStringToObject(payload, "phase", "receiving");
  cJSON_AddNumberToObject(payload, "allocated_bytes", total_bytes);
  send_message("audio_playback_started", turn_id, payload);
  cJSON* evidence = cJSON_CreateObject();
  cJSON_AddStringToObject(evidence, "mode", "bounded_prebuffer");
  cJSON_AddNumberToObject(evidence, "chunk_bytes", kPlaybackChunkBytes);
  cJSON_AddNumberToObject(evidence, "allocated_bytes", total_bytes);
  cJSON_AddNumberToObject(evidence, "free_heap_before", heap_before);
  cJSON_AddNumberToObject(evidence, "free_heap_after", esp_get_free_heap_size());
  result(command_id, "audio_playback_start", true, "audio_playback_started", evidence);
  return true;
}

void Transport::ingest_audio_playback_chunk(const char* command_id, const char* turn_id, uint32_t sequence, const char* encoded, uint32_t declared_bytes) {
  if (!audio_playback_active_ || audio_playback_state_ != AudioPlaybackState::Receiving || audio_playback_abort_requested_ || !turn_id || std::strcmp(turn_id, audio_playback_turn_id_) != 0 || !encoded || declared_bytes == 0 || declared_bytes > kPlaybackChunkBytes) {
    if (audio_playback_active_) abort_audio_playback("audio_playback_chunk_rejected");
    error(command_id, "audio_playback_chunk_rejected");
    return;
  }
  const auto decision = audio_playback_flow_.validate(sequence, declared_bytes);
  if (decision != PlaybackFlowControl::ChunkDecision::Accepted) {
    abort_audio_playback(decision == PlaybackFlowControl::ChunkDecision::SequenceMismatch ? "audio_playback_sequence_mismatch" : "audio_playback_byte_count_invalid");
    error(command_id, audio_playback_failure_);
    return;
  }
  const uint32_t offset = audio_playback_flow_.accepted_bytes();
  size_t decoded{};
  if (!audio_playback_buffer_ || mbedtls_base64_decode(audio_playback_buffer_ + offset, audio_playback_allocated_bytes_ - offset, &decoded, reinterpret_cast<const unsigned char*>(encoded), std::strlen(encoded)) != 0 || decoded != declared_bytes) {
    abort_audio_playback("audio_playback_chunk_invalid");
    error(command_id, "audio_playback_chunk_invalid");
    return;
  }
  audio_playback_flow_.accepted(static_cast<uint32_t>(decoded));
  cJSON* evidence = cJSON_CreateObject();
  cJSON_AddStringToObject(evidence, "turn_id", turn_id);
  cJSON_AddNumberToObject(evidence, "sequence", sequence);
  cJSON_AddBoolToObject(evidence, "accepted", true);
  cJSON_AddNumberToObject(evidence, "accepted_bytes", audio_playback_flow_.accepted_bytes());
  cJSON_AddNumberToObject(evidence, "remaining_bytes", audio_playback_flow_.total_bytes() - audio_playback_flow_.accepted_bytes());
  cJSON_AddNumberToObject(evidence, "next_sequence", audio_playback_flow_.expected_sequence());
  result(command_id, "audio_playback_chunk", true, "audio_playback_chunk_accepted", evidence);
}

void Transport::finish_audio_playback(const char* command_id, const char* turn_id) {
  if (!audio_playback_active_ || audio_playback_state_ != AudioPlaybackState::Receiving || audio_playback_abort_requested_ || !turn_id || std::strcmp(turn_id, audio_playback_turn_id_) != 0) { error(command_id, "no_matching_audio_playback"); return; }
  if (!audio_playback_flow_.all_accepted()) { abort_audio_playback("audio_playback_byte_count_mismatch"); error(command_id, "audio_playback_byte_count_mismatch"); return; }
  audio_playback_state_ = AudioPlaybackState::Ready;
  if (xTaskCreate(audio_playback_task, "guest_ai_playback", 6144, this, tskIDLE_PRIORITY + 1, &audio_playback_task_handle_) != pdPASS) {
    abort_audio_playback("audio_playback_task_create_failed");
    error(command_id, "audio_playback_task_create_failed");
    return;
  }
  cJSON* evidence = cJSON_CreateObject();
  cJSON_AddNumberToObject(evidence, "accepted_bytes", audio_playback_flow_.accepted_bytes());
  cJSON_AddNumberToObject(evidence, "allocated_bytes", audio_playback_allocated_bytes_);
  cJSON_AddStringToObject(evidence, "phase", "ready");
  result(command_id, "audio_playback_end", true, "audio_playback_ready", evidence);
}

void Transport::abort_audio_playback(const char* reason) {
  audio_playback_abort_requested_ = true;
  std::strncpy(audio_playback_failure_, reason ? reason : "audio_playback_failed", sizeof(audio_playback_failure_) - 1);
  if (audio_playback_state_ == AudioPlaybackState::Receiving || audio_playback_state_ == AudioPlaybackState::Ready) {
    release_audio_playback_buffer();
    audio_playback_active_ = false;
    audio_playback_state_ = AudioPlaybackState::Idle;
    audio_playback_turn_id_[0] = '\0';
    audio_playback_flow_.reset();
    robot_state_ = "IDLE";
    (void)guest_ai::k151::k151_display_expression(state_expression(robot_state_));
  }
}

void Transport::cancel_audio_playback(const char* command_id, const char* turn_id, const char* reason) {
  if (!audio_playback_active_ || !turn_id || std::strcmp(turn_id, audio_playback_turn_id_) != 0) { error(command_id, "no_matching_audio_playback"); return; }
  if (audio_playback_state_ == AudioPlaybackState::Playing) { error(command_id, "audio_playback_cancel_unsupported_while_playing"); return; }
  const uint32_t accepted_bytes = audio_playback_flow_.accepted_bytes();
  const uint32_t chunk_count = audio_playback_flow_.accepted_chunks();
  const uint32_t allocated_bytes = audio_playback_allocated_bytes_;
  abort_audio_playback(reason ? reason : "audio_playback_cancelled");
  cJSON* complete = cJSON_CreateObject();
  cJSON_AddStringToObject(complete, "turn_id", turn_id);
  cJSON_AddNumberToObject(complete, "accepted_bytes", accepted_bytes);
  cJSON_AddNumberToObject(complete, "played_bytes", 0);
  cJSON_AddNumberToObject(complete, "chunk_count", chunk_count);
  cJSON_AddNumberToObject(complete, "write_blocks", 0);
  cJSON_AddNumberToObject(complete, "allocated_bytes", allocated_bytes);
  cJSON_AddStringToObject(complete, "mode", "bounded_prebuffer");
  cJSON_AddNumberToObject(complete, "duration_ms", 0);
  cJSON_AddStringToObject(complete, "completion", "cancelled");
  cJSON_AddBoolToObject(complete, "cleanup_ok", true);
  cJSON_AddStringToObject(complete, "error", reason ? reason : "audio_playback_cancelled");
  send_message("audio_playback_complete", turn_id, complete);
  result(command_id, "audio_playback_cancel", true, "audio_playback_cancelled");
}

void Transport::release_audio_playback_buffer() {
  if (audio_playback_buffer_) heap_caps_free(audio_playback_buffer_);
  audio_playback_buffer_ = nullptr;
  audio_playback_allocated_bytes_ = 0;
}

void Transport::audio_playback_task(void* context) {
  auto* transport = static_cast<Transport*>(context);
  const int64_t started_us = esp_timer_get_time();
  transport->audio_playback_state_ = AudioPlaybackState::Playing;
  transport->robot_state_ = "SPEAKING";
  (void)guest_ai::k151::k151_display_expression(state_expression(transport->robot_state_));
  cJSON* playing = cJSON_CreateObject();
  cJSON_AddStringToObject(playing, "turn_id", transport->audio_playback_turn_id_);
  cJSON_AddStringToObject(playing, "phase", "playing");
  cJSON_AddNumberToObject(playing, "accepted_bytes", transport->audio_playback_flow_.accepted_bytes());
  send_message("audio_playback_playing", transport->audio_playback_turn_id_, playing);
  bool failed = guest_ai::k151::k151_speaker_playback_begin(kAudioSampleRate, 1) != ESP_OK;
  if (failed) transport->abort_audio_playback("audio_playback_begin_failed");
  uint32_t offset = 0;
  uint32_t write_blocks = 0;
  while (!failed && offset < transport->audio_playback_flow_.total_bytes()) {
    if (transport->audio_playback_abort_requested_) { failed = true; break; }
    const uint32_t block = std::min<uint32_t>(kPlaybackWriteBlockBytes, transport->audio_playback_flow_.total_bytes() - offset);
    size_t written{};
    if (!transport->audio_playback_buffer_ || guest_ai::k151::k151_speaker_playback_write(transport->audio_playback_buffer_ + offset, block, &written) != ESP_OK || written != block) {
      transport->abort_audio_playback("audio_playback_write_failed"); failed = true; break;
    }
    transport->audio_playback_flow_.played(block);
    offset += block;
    ++write_blocks;
  }
  const esp_err_t drain = !failed ? guest_ai::k151::k151_speaker_playback_drain() : ESP_FAIL;
  if (!failed && drain != ESP_OK) {
    transport->abort_audio_playback("audio_playback_drain_failed");
    failed = true;
  }
  const esp_err_t cleanup = guest_ai::k151::k151_speaker_playback_end();
  cJSON* complete = cJSON_CreateObject();
  cJSON_AddStringToObject(complete, "turn_id", transport->audio_playback_turn_id_);
  cJSON_AddNumberToObject(complete, "accepted_bytes", transport->audio_playback_flow_.accepted_bytes());
  cJSON_AddNumberToObject(complete, "played_bytes", transport->audio_playback_flow_.played_bytes());
  cJSON_AddNumberToObject(complete, "chunk_count", transport->audio_playback_flow_.accepted_chunks());
  cJSON_AddNumberToObject(complete, "write_blocks", write_blocks);
  cJSON_AddNumberToObject(complete, "allocated_bytes", transport->audio_playback_allocated_bytes_);
  cJSON_AddStringToObject(complete, "mode", "bounded_prebuffer");
  cJSON_AddNumberToObject(complete, "duration_ms", static_cast<double>((esp_timer_get_time() - started_us) / 1000));
  cJSON_AddBoolToObject(complete, "drain_ok", drain == ESP_OK);
  cJSON_AddStringToObject(complete, "completion", !failed && cleanup == ESP_OK ? "completed" : "error");
  cJSON_AddBoolToObject(complete, "cleanup_ok", cleanup == ESP_OK);
  cJSON_AddStringToObject(complete, "error", failed ? (transport->audio_playback_failure_[0] ? transport->audio_playback_failure_ : "audio_playback_failed") : "");
  send_message("audio_playback_complete", transport->audio_playback_turn_id_, complete);
  transport->audio_playback_active_ = false;
  transport->audio_playback_abort_requested_ = false;
  transport->audio_playback_task_handle_ = nullptr;
  transport->release_audio_playback_buffer();
  transport->audio_playback_state_ = AudioPlaybackState::Idle;
  transport->audio_playback_turn_id_[0] = '\0';
  transport->audio_playback_failure_[0] = '\0';
  transport->audio_playback_flow_.reset();
  transport->robot_state_ = "IDLE";
  (void)guest_ai::k151::k151_display_expression(state_expression(transport->robot_state_));
  vTaskDelete(nullptr);
}

void Transport::audio_capture_task(void* context) {
  auto* transport = static_cast<Transport*>(context);
  const int64_t started_us = esp_timer_get_time();
  transport->audio_capture_state_ = AudioCaptureState::Capturing;
  set_audio_console_suppressed(true);
  audio_stage(transport->audio_turn_id_, "audio_capture_task_started", true, "running", 0);
  uint32_t sequence = 0, total = 0;
  bool failed = false;
  EndOfSpeechDetector end_of_speech{kEndOfSpeechConfig};
  bool post_speech_silence_reported = false;
  bool possible_end_reported = false;
  bool calibration_reported = false;
  const uint32_t hwm_after_task_start = current_task_stack_hwm_bytes();
  uint32_t hwm_after_first_mic_read = hwm_after_task_start;
  uint32_t hwm_after_noise_baseline = hwm_after_task_start;
  uint32_t minimum_hwm_during_eos_processing = hwm_after_task_start;
  char stack_detail[160]{};
  std::snprintf(stack_detail, sizeof(stack_detail), "unit=bytes configured=%lu remaining=%lu",
                static_cast<unsigned long>(kAudioCaptureTaskStackBytes),
                static_cast<unsigned long>(hwm_after_task_start));
  audio_stage(transport->audio_turn_id_, "audio_capture_stack_hwm_task_started", true, stack_detail, 0);
  cJSON* started = cJSON_CreateObject();
  cJSON_AddStringToObject(started, "turn_id", transport->audio_turn_id_);
  cJSON_AddStringToObject(started, "format", "pcm_s16le");
  cJSON_AddNumberToObject(started, "sample_rate_hz", kAudioSampleRate);
  cJSON_AddNumberToObject(started, "channels", 1);
  cJSON_AddNumberToObject(started, "max_bytes", kAudioMaxBytes);
  const bool started_sent = send_message("audio_capture_started", transport->audio_turn_id_, started);
  if (!started_sent) {
    audio_stage(transport->audio_turn_id_, "audio_capture_failed", false, "started_tx_failed", 0);
    transport->audio_capture_state_ = AudioCaptureState::Failed;
    transport->audio_capture_active_ = false;
    transport->audio_capture_cancel_ = false;
    transport->audio_capture_task_handle_ = nullptr;
    transport->audio_turn_id_[0] = '\0';
    set_audio_console_suppressed(false);
    vTaskDelete(nullptr);
    return;
  }
  uint8_t pcm[guest_ai::k151::k151_audio_capture_chunk_bytes]{};
  char encoded[1284]{};
  while (!transport->audio_capture_cancel_ && total < kAudioMaxBytes &&
         (esp_timer_get_time() - started_us) / 1000 < transport->audio_max_duration_ms_) {
    if (sequence == 0) audio_stage(transport->audio_turn_id_, "audio_capture_mic_read_begin", true, "requested_bytes=960", static_cast<uint32_t>((esp_timer_get_time()-started_us)/1000));
    guest_ai::k151::AudioLevel pcm_level{};
    const esp_err_t read = guest_ai::k151::k151_microphone_read_mono_chunk(pcm, sizeof(pcm), &pcm_level);
    if (read != ESP_OK) { audio_stage(transport->audio_turn_id_, "audio_capture_failed", false, esp_err_to_name(read), static_cast<uint32_t>((esp_timer_get_time()-started_us)/1000)); failed = true; break; }
    if (sequence == 0) {
      hwm_after_first_mic_read = current_task_stack_hwm_bytes();
      minimum_hwm_during_eos_processing = std::min(minimum_hwm_during_eos_processing, hwm_after_first_mic_read);
      audio_stage(transport->audio_turn_id_, "audio_capture_first_pcm_read", true, "actual_bytes=960", static_cast<uint32_t>((esp_timer_get_time()-started_us)/1000));
      std::snprintf(stack_detail, sizeof(stack_detail), "unit=bytes configured=%lu remaining=%lu",
                    static_cast<unsigned long>(kAudioCaptureTaskStackBytes),
                    static_cast<unsigned long>(hwm_after_first_mic_read));
      audio_stage(transport->audio_turn_id_, "audio_capture_stack_hwm_after_first_mic_read", true, stack_detail,
                  static_cast<uint32_t>((esp_timer_get_time()-started_us)/1000));
    }
    const uint32_t elapsed_ms = static_cast<uint32_t>((esp_timer_get_time() - started_us) / 1000);
    const bool had_speech = end_of_speech.metrics().speech_detected;
    const auto& eos = end_of_speech.observe(pcm_level, elapsed_ms);
    char eos_detail[128]{};
    if (!calibration_reported && elapsed_ms >= kEndOfSpeechConfig.calibration_duration_ms && end_of_speech.calibrated()) {
      calibration_reported = true;
      hwm_after_noise_baseline = current_task_stack_hwm_bytes();
      minimum_hwm_during_eos_processing = std::min(minimum_hwm_during_eos_processing, hwm_after_noise_baseline);
      std::snprintf(eos_detail, sizeof(eos_detail), "noise_rms_q8=%lu threshold_q8=%lu peak=%lu", static_cast<unsigned long>(eos.noise_floor_rms_q8), static_cast<unsigned long>(eos.speech_threshold_rms_q8), static_cast<unsigned long>(eos.current_peak));
      audio_stage(transport->audio_turn_id_, "audio_capture_eos_calibrated", true, eos_detail, elapsed_ms);
      std::snprintf(stack_detail, sizeof(stack_detail), "unit=bytes configured=%lu remaining=%lu",
                    static_cast<unsigned long>(kAudioCaptureTaskStackBytes),
                    static_cast<unsigned long>(hwm_after_noise_baseline));
      audio_stage(transport->audio_turn_id_, "audio_capture_stack_hwm_after_noise_baseline", true, stack_detail,
                  elapsed_ms);
    }
    if (!had_speech && eos.speech_detected) {
      minimum_hwm_during_eos_processing = std::min(minimum_hwm_during_eos_processing, current_task_stack_hwm_bytes());
      std::snprintf(eos_detail, sizeof(eos_detail), "rms_q8=%lu threshold_q8=%lu noise_q8=%lu peak=%lu", static_cast<unsigned long>(eos.current_rms_q8), static_cast<unsigned long>(eos.speech_threshold_rms_q8), static_cast<unsigned long>(eos.noise_floor_rms_q8), static_cast<unsigned long>(eos.current_peak));
      audio_stage(transport->audio_turn_id_, "audio_capture_speech_detected", true, eos_detail, elapsed_ms);
    }
    if (eos.post_speech_silence_entered && !post_speech_silence_reported) {
      post_speech_silence_reported = true;
      std::snprintf(eos_detail, sizeof(eos_detail), "rms_q8=%lu silence_ms=%lu release_q8=%lu", static_cast<unsigned long>(eos.current_rms_q8), static_cast<unsigned long>(eos.trailing_silence_ms), static_cast<unsigned long>(eos.release_threshold_rms_q8));
      audio_stage(transport->audio_turn_id_, "audio_capture_post_speech_silence", true, eos_detail, elapsed_ms);
    }
    if (eos.possible_end_entered && !possible_end_reported) {
      possible_end_reported = true;
      std::snprintf(eos_detail, sizeof(eos_detail), "silence_ms=%lu final_threshold_ms=%lu release_q8=%lu",
                    static_cast<unsigned long>(eos.trailing_silence_ms),
                    static_cast<unsigned long>(kEndOfSpeechConfig.final_end_silence_ms),
                    static_cast<unsigned long>(eos.release_threshold_rms_q8));
      audio_stage(transport->audio_turn_id_, "audio_capture_possible_end", true, eos_detail, elapsed_ms);
    }
    size_t encoded_length{};
    if (mbedtls_base64_encode(reinterpret_cast<unsigned char*>(encoded), sizeof(encoded), &encoded_length, pcm, sizeof(pcm)) != 0) { audio_stage(transport->audio_turn_id_, "audio_capture_failed", false, "base64_encode_failed", 0); failed = true; break; }
    if (sequence == 0) audio_stage(transport->audio_turn_id_, "audio_capture_first_chunk_encoded", true, "encoded_bytes=1280", static_cast<uint32_t>((esp_timer_get_time()-started_us)/1000));
    encoded[encoded_length] = '\0';
    cJSON* chunk = cJSON_CreateObject();
    cJSON_AddStringToObject(chunk, "turn_id", transport->audio_turn_id_);
    const bool first_chunk = sequence == 0;
    cJSON_AddNumberToObject(chunk, "sequence", sequence++);
    cJSON_AddNumberToObject(chunk, "byte_count", sizeof(pcm));
    cJSON_AddStringToObject(chunk, "encoding", "base64");
    cJSON_AddStringToObject(chunk, "pcm", encoded);
    if (first_chunk) audio_stage(transport->audio_turn_id_, "audio_capture_first_chunk_tx_begin", true, "", static_cast<uint32_t>((esp_timer_get_time()-started_us)/1000));
    if (!send_message("audio_capture_chunk", transport->audio_turn_id_, chunk)) { audio_stage(transport->audio_turn_id_, "audio_capture_failed", false, "chunk_tx_failed", 0); failed = true; break; }
    if (first_chunk) audio_stage(transport->audio_turn_id_, "audio_capture_first_chunk_tx_complete", true, "", static_cast<uint32_t>((esp_timer_get_time()-started_us)/1000));
    total += sizeof(pcm);
    if (eos.auto_stop) {
      std::snprintf(eos_detail, sizeof(eos_detail), "silence_ms=%lu final_threshold_ms=%lu release_q8=%lu",
                    static_cast<unsigned long>(eos.trailing_silence_ms),
                    static_cast<unsigned long>(kEndOfSpeechConfig.final_end_silence_ms),
                    static_cast<unsigned long>(eos.release_threshold_rms_q8));
      audio_stage(transport->audio_turn_id_, "audio_capture_auto_stop", true, eos_detail, elapsed_ms);
      break;
    }
  }
  transport->audio_capture_state_ = AudioCaptureState::Completing;
  const uint32_t hwm_before_completion = current_task_stack_hwm_bytes();
  minimum_hwm_during_eos_processing = std::min(minimum_hwm_during_eos_processing, hwm_before_completion);
  audio_stage(transport->audio_turn_id_, "audio_capture_complete_begin", !failed, transport->audio_capture_cancel_ ? "cancelled" : "", static_cast<uint32_t>((esp_timer_get_time()-started_us)/1000));
  cJSON* complete = cJSON_CreateObject();
  cJSON_AddStringToObject(complete, "turn_id", transport->audio_turn_id_);
  cJSON_AddNumberToObject(complete, "chunk_count", sequence);
  cJSON_AddNumberToObject(complete, "byte_count", total);
  cJSON_AddNumberToObject(complete, "duration_ms", static_cast<double>((esp_timer_get_time() - started_us) / 1000));
  cJSON_AddNumberToObject(complete, "sample_rate_hz", kAudioSampleRate);
  cJSON_AddNumberToObject(complete, "channels", 1);
  cJSON_AddStringToObject(complete, "format", "pcm_s16le");
  const auto& eos = end_of_speech.metrics();
  cJSON_AddBoolToObject(complete, "speech_detected", eos.speech_detected);
  cJSON_AddBoolToObject(complete, "auto_stop", eos.auto_stop);
  cJSON_AddNumberToObject(complete, "current_rms", eos.current_rms);
  cJSON_AddNumberToObject(complete, "noise_floor_rms", eos.noise_floor_rms);
  cJSON_AddNumberToObject(complete, "speech_threshold_rms", eos.speech_threshold_rms);
  cJSON_AddNumberToObject(complete, "release_threshold_rms", eos.release_threshold_rms);
  cJSON_AddNumberToObject(complete, "release_threshold_q8", eos.release_threshold_rms_q8);
  cJSON_AddNumberToObject(complete, "first_speech_elapsed_ms", eos.first_speech_elapsed_ms);
  cJSON_AddNumberToObject(complete, "estimated_speech_end_elapsed_ms", eos.estimated_speech_end_elapsed_ms);
  cJSON_AddNumberToObject(complete, "post_speech_silence_ms", eos.trailing_silence_ms);
  cJSON_AddBoolToObject(complete, "post_speech_silence_entered", eos.post_speech_silence_entered);
  cJSON_AddBoolToObject(complete, "possible_end_entered", eos.possible_end_entered);
  cJSON_AddNumberToObject(complete, "possible_end_at_ms", eos.possible_end_at_ms);
  cJSON_AddNumberToObject(complete, "final_end_threshold_ms", kEndOfSpeechConfig.final_end_silence_ms);
  cJSON_AddBoolToObject(complete, "speech_resumed_during_pending", eos.speech_resumed_during_pending);
  cJSON_AddNumberToObject(complete, "longest_pending_pause_ms", eos.longest_pending_pause_ms);
  cJSON_AddNumberToObject(complete, "pending_eos_cancel_count", eos.pending_eos_cancel_count);
  cJSON_AddNumberToObject(complete, "final_auto_stop_silence_ms", eos.final_auto_stop_silence_ms);
  cJSON_AddNumberToObject(complete, "silence_candidate_blocks", eos.silence_candidate_blocks);
  cJSON_AddNumberToObject(complete, "silence_reset_count", eos.silence_reset_count);
  cJSON_AddNumberToObject(complete, "longest_trailing_silence_ms", eos.longest_trailing_silence_ms);
  cJSON_AddStringToObject(complete, "final_eos_state", end_of_speech_state_name(eos.state));
  cJSON_AddStringToObject(complete, "auto_stop_reason", eos.auto_stop ? "trailing_silence" :
                          (failed ? "capture_error" : (transport->audio_capture_cancel_ ? "cancelled" : "safety_cap")));
  cJSON_AddNumberToObject(complete, "time_saved_ms", eos.auto_stop && transport->audio_max_duration_ms_ > static_cast<uint32_t>((esp_timer_get_time() - started_us) / 1000) ? transport->audio_max_duration_ms_ - static_cast<uint32_t>((esp_timer_get_time() - started_us) / 1000) : 0);
  const auto& calibration = end_of_speech.calibration_evidence();
  cJSON* calibration_evidence = cJSON_AddObjectToObject(complete, "eos_calibration");
  add_rms_distribution(calibration_evidence, "noise_baseline", calibration.baseline);
  add_rms_distribution(calibration_evidence, "after_baseline", calibration.after_baseline);
  cJSON_AddNumberToObject(calibration_evidence, "count_above_noise", calibration.count_above_noise);
  cJSON_AddNumberToObject(calibration_evidence, "count_above_entry", calibration.count_above_entry);
  cJSON_AddNumberToObject(calibration_evidence, "max_delta_from_noise_q8", calibration.maximum_delta_from_noise_q8);
  cJSON_AddNumberToObject(calibration_evidence, "max_ratio_to_noise_q8", calibration.maximum_ratio_to_noise_q8);
  cJSON* top_candidates = cJSON_AddArrayToObject(calibration_evidence, "top_candidate_rms_q8");
  for (uint32_t index = 0; index < calibration.top_candidate_count; ++index) {
    cJSON_AddItemToArray(top_candidates, cJSON_CreateNumber(calibration.top_candidate_rms_q8[index]));
  }
  cJSON* stack_hwm = cJSON_AddObjectToObject(complete, "audio_task_stack_hwm");
  cJSON_AddStringToObject(stack_hwm, "unit", "bytes");
  cJSON_AddNumberToObject(stack_hwm, "configured_stack_bytes", kAudioCaptureTaskStackBytes);
  cJSON_AddNumberToObject(stack_hwm, "after_task_start_bytes", hwm_after_task_start);
  cJSON_AddNumberToObject(stack_hwm, "after_first_mic_read_bytes", hwm_after_first_mic_read);
  cJSON_AddNumberToObject(stack_hwm, "after_noise_baseline_bytes", hwm_after_noise_baseline);
  cJSON_AddNumberToObject(stack_hwm, "minimum_during_eos_bytes", minimum_hwm_during_eos_processing);
  cJSON_AddNumberToObject(stack_hwm, "before_completion_bytes", hwm_before_completion);
  cJSON_AddStringToObject(complete, "completion", failed ? "error" : (transport->audio_capture_cancel_ ? "cancelled" : "completed"));
  const bool complete_sent = send_message("audio_capture_complete", transport->audio_turn_id_, complete);
  audio_stage(transport->audio_turn_id_, "audio_capture_complete_sent", complete_sent, "", static_cast<uint32_t>((esp_timer_get_time()-started_us)/1000));
  const uint32_t hwm_before_task_exit = current_task_stack_hwm_bytes();
  std::snprintf(stack_detail, sizeof(stack_detail), "unit=bytes configured=%lu remaining=%lu min_eos=%lu",
                static_cast<unsigned long>(kAudioCaptureTaskStackBytes),
                static_cast<unsigned long>(hwm_before_task_exit),
                static_cast<unsigned long>(minimum_hwm_during_eos_processing));
  audio_stage(transport->audio_turn_id_, "audio_capture_stack_hwm_before_task_exit", true, stack_detail,
              static_cast<uint32_t>((esp_timer_get_time()-started_us)/1000));
  transport->audio_capture_active_ = false;
  transport->audio_capture_cancel_ = false;
  transport->audio_capture_task_handle_ = nullptr;
  transport->audio_capture_state_ = AudioCaptureState::Idle;
  transport->audio_turn_id_[0] = '\0';
  set_audio_console_suppressed(false);
  vTaskDelete(nullptr);
}

void Transport::error(const char* command_id, const char* detail, void* evidence) {
  cJSON* payload = cJSON_CreateObject();
  cJSON_AddStringToObject(payload, "command_id", command_id);
  cJSON_AddStringToObject(payload, "message", detail);
  cJSON_AddStringToObject(payload, "robot_state", robot_state_);
  if (evidence) cJSON_AddItemToObject(payload, "evidence", static_cast<cJSON*>(evidence));
  send_message("error", command_id, payload);
}

void Transport::result(const char* command_id, const char* command_type, bool ok, const char* detail, void* evidence) {
  ESP_LOGI(kTag, "camera_stage command_id=%s stage=command_result_send_begin result=%d elapsed_ms=0", command_id, ok);
  cJSON* payload = cJSON_CreateObject();
  cJSON_AddStringToObject(payload, "command_id", command_id);
  cJSON_AddStringToObject(payload, "command_type", command_type);
  cJSON_AddStringToObject(payload, "status", ok ? "ok" : "error");
  cJSON_AddStringToObject(payload, "detail", detail);
  cJSON_AddStringToObject(payload, "robot_state", robot_state_);
  if (evidence) cJSON_AddItemToObject(payload, "evidence", static_cast<cJSON*>(evidence));
  #if CONFIG_FEEDX_GUEST_AI_FAULT_INJECTION
  if (std::strcmp(command_type, "test_fault_injection") != 0) s_tx_fault_command_id=command_id;
  #endif
  const bool sent = send_message("command_result", command_id, payload);
  ESP_LOGI(kTag, "camera_stage command_id=%s stage=command_result_sent result=%d elapsed_ms=0", command_id, sent);
}

void Transport::capability_status(const char* message_id, const char* capability, const char* status, const char* detail) {
  cJSON* payload = cJSON_CreateObject();
  cJSON* capabilities = cJSON_AddObjectToObject(payload, "capabilities");
  if (capability) {
    add_capability(capabilities, capability, status, detail);
  } else {
    // Only USB framing has runtime evidence before an explicit capability test.
    add_capability(capabilities, "usb_transport", "pass", "USB CDC JSON-lines transport active");
    add_capability(capabilities, "telemetry", "partial", "compiled; runtime telemetry not yet validated on this IDF bridge");
    add_capability(capabilities, "display", "partial", "compiled; physical render not yet validated on this IDF bridge");
    add_capability(capabilities, "servo_x", "partial", "compiled; physical motion not yet validated on this IDF bridge");
    add_capability(capabilities, "servo_y", "partial", "compiled; physical motion not yet validated on this IDF bridge");
    add_capability(capabilities, "speaker", "partial", "compiled; audibility not yet validated on this IDF bridge");
    add_capability(capabilities, "microphone", "partial", "compiled; real PCM capture not yet validated on this IDF bridge");
    const auto camera_state = guest_ai::k151::k151_camera_init_state();
    add_capability(capabilities, "camera", camera_state == guest_ai::k151::CameraInitState::Ready ? "partial" : "blocked",
                   camera_state == guest_ai::k151::CameraInitState::VideoDeviceMissing ? "camera_video_device_missing" :
                   (camera_state == guest_ai::k151::CameraInitState::Ready ? "compiled; real frame capture not yet validated on this IDF bridge" : "camera_initialization_incomplete"));
  }
  send_message("capability_status", message_id, payload);
}

void Transport::device_snapshot(const char* command_id) {
  const auto telemetry = guest_ai::k151::k151_get_telemetry();
  cJSON* evidence = cJSON_CreateObject();
  cJSON* snapshot = cJSON_AddObjectToObject(evidence, "snapshot");
  cJSON_AddStringToObject(snapshot, "device_id", kDeviceId);
  cJSON_AddStringToObject(snapshot, "model", "M5Stack StackChan K151");
  cJSON_AddStringToObject(snapshot, "firmware_version", kBridgeVersion);
  cJSON_AddStringToObject(snapshot, "protocol_version", kProtocolVersion);
  cJSON_AddStringToObject(snapshot, "build_profile", kBuildProfile);
  cJSON_AddBoolToObject(snapshot, "fault_injection_enabled", kFaultInjectionEnabled);
  cJSON_AddStringToObject(snapshot, "robot_state", robot_state_);
  cJSON_AddNumberToObject(snapshot, "uptime_ms", static_cast<double>(telemetry.uptime_ms));
  cJSON* capabilities = cJSON_AddObjectToObject(snapshot, "capabilities");
  add_capability(capabilities, "usb_transport", "pass", "USB CDC JSON-lines transport active");
  add_capability(capabilities, "telemetry", "pass", "runtime telemetry active");
  add_capability(capabilities, "display", "pass", "hardware foundation validated");
  add_capability(capabilities, "servo_x", "pass", "hardware foundation validated");
  add_capability(capabilities, "servo_y", "pass", "hardware foundation validated");
  add_capability(capabilities, "speaker", "pass", "hardware foundation validated");
  add_capability(capabilities, "microphone", "pass", "hardware foundation validated");
  const auto camera_state = guest_ai::k151::k151_camera_init_state();
  add_capability(capabilities, "camera", camera_state == guest_ai::k151::CameraInitState::Ready ? "pass" : "blocked",
                 camera_state == guest_ai::k151::CameraInitState::Ready ? "hardware foundation validated" : "camera_initialization_incomplete");
  result(command_id, "request_device_snapshot", true, "device_snapshot", evidence);
}

void Transport::send_startup_snapshot() {
  // The runtime task invokes this only after USB CDC reports a host connection.
  // It contains no hardware action and can be safely resent after reconnect.
  robot_state_ = "BOOTING";
  ESP_LOGI(kTag, "startup state: BOOTING");
  cJSON* payload = cJSON_CreateObject();
  cJSON_AddStringToObject(payload, "model", "M5Stack StackChan K151");
  cJSON_AddStringToObject(payload, "bridge_version", kBridgeVersion);
  cJSON_AddStringToObject(payload, "firmware_version", kBridgeVersion);
  cJSON_AddStringToObject(payload, "build_profile", kBuildProfile);
  cJSON_AddBoolToObject(payload, "fault_injection_enabled", kFaultInjectionEnabled);
  cJSON_AddStringToObject(payload, "protocol_version", kProtocolVersion);
  cJSON_AddStringToObject(payload, "robot_state", robot_state_);
  send_message("device_connected", "boot", payload);
  capability_status("capabilities");
  robot_state_ = "IDLE";
  ESP_LOGI(kTag, "startup state: IDLE");
  heartbeat();
}

void Transport::heartbeat() {
  const auto telemetry = guest_ai::k151::k151_get_telemetry();
  cJSON* payload = cJSON_CreateObject();
  cJSON_AddNumberToObject(payload, "uptime_ms", static_cast<double>(telemetry.uptime_ms));
  cJSON_AddNumberToObject(payload, "free_heap", telemetry.free_heap);
  cJSON_AddNumberToObject(payload, "min_free_heap", static_cast<double>(telemetry.min_free_heap));
  cJSON_AddNumberToObject(payload, "init_stack_high_water_words", telemetry.init_stack_high_water_words);
  cJSON_AddNumberToObject(payload, "runtime_stack_high_water_words", telemetry.runtime_stack_high_water_words);
  cJSON_AddStringToObject(payload, "robot_state", robot_state_);
  send_message("heartbeat", "heartbeat", payload);
}

void Transport::dispatch(const char* frame) {
  cJSON* message = cJSON_Parse(frame);
  if (!message) {
    const auto& diagnostics = framer_.diagnostics();
    cJSON* evidence = cJSON_CreateObject();
    cJSON_AddNumberToObject(evidence, "frame_length", diagnostics.last_frame_length);
    cJSON_AddNumberToObject(evidence, "frame_hash", diagnostics.last_frame_hash);
    cJSON_AddNumberToObject(evidence, "newline_count", diagnostics.newline_count);
    cJSON_AddNumberToObject(evidence, "buffered_length", diagnostics.buffered_length);
    cJSON_AddBoolToObject(evidence, "begins_with_object", diagnostics.last_begins_object);
    cJSON_AddBoolToObject(evidence, "ends_with_object", diagnostics.last_ends_object);
    cJSON_AddBoolToObject(evidence, "discarding", diagnostics.discarding);
    add_hex_preview(evidence, "first_16_hex", diagnostics.first_bytes, diagnostics.last_preview_length);
    add_hex_preview(evidence, "last_16_hex", diagnostics.last_bytes, diagnostics.last_preview_length);
    const char* parse_error = cJSON_GetErrorPtr();
    const ptrdiff_t position = parse_error ? parse_error - frame : -1;
    cJSON_AddNumberToObject(evidence, "json_error_position", position >= 0 && static_cast<size_t>(position) <= diagnostics.last_frame_length ? position : -1);
    error("invalid", "malformed_json", evidence);
    return;
  }

  const cJSON* id = cJSON_GetObjectItemCaseSensitive(message, "message_id");
  const cJSON* type = cJSON_GetObjectItemCaseSensitive(message, "type");
  const cJSON* version = cJSON_GetObjectItemCaseSensitive(message, "protocol_version");
  const cJSON* payload = cJSON_GetObjectItemCaseSensitive(message, "payload");
  const char* command_id = cJSON_IsString(id) ? id->valuestring : "invalid";
  if (!cJSON_IsString(version) || std::strcmp(version->valuestring, kProtocolVersion) != 0 ||
      !cJSON_IsString(type) || !cJSON_IsObject(payload)) {
    error(command_id, "protocol_version_type_payload_required");
    cJSON_Delete(message);
    return;
  }

  esp_err_t board_result = ESP_ERR_INVALID_ARG;

  if (std::strcmp(type->valuestring, "request_device_snapshot") == 0) {
    device_snapshot(command_id);
  } else if (std::strcmp(type->valuestring, "audio_capture_start") == 0) {
    const cJSON* turn_id = cJSON_GetObjectItemCaseSensitive(payload, "turn_id");
    const cJSON* duration = cJSON_GetObjectItemCaseSensitive(payload, "max_duration_ms");
    if (!cJSON_IsString(turn_id) || !cJSON_IsNumber(duration)) {
      error(command_id, "audio_capture_start_rejected");
    } else {
      start_audio_capture(command_id, turn_id->valuestring, duration->valueint);
    }
  } else if (std::strcmp(type->valuestring, "audio_capture_end") == 0) {
    stop_audio_capture(command_id, "audio_capture_stop_requested");
  } else if (std::strcmp(type->valuestring, "audio_playback_start") == 0) {
    const cJSON* turn_id = cJSON_GetObjectItemCaseSensitive(payload, "turn_id");
    const cJSON* format = cJSON_GetObjectItemCaseSensitive(payload, "format");
    const cJSON* sample_rate = cJSON_GetObjectItemCaseSensitive(payload, "sample_rate_hz");
    const cJSON* channels = cJSON_GetObjectItemCaseSensitive(payload, "channels");
    const cJSON* total_bytes = cJSON_GetObjectItemCaseSensitive(payload, "total_bytes");
    if (!cJSON_IsString(turn_id) || !cJSON_IsString(format) || std::strcmp(format->valuestring, "pcm_s16le") != 0 ||
        !cJSON_IsNumber(sample_rate) || !cJSON_IsNumber(channels) || !cJSON_IsNumber(total_bytes)) error(command_id, "audio_playback_start_rejected");
    else start_audio_playback(command_id, turn_id->valuestring, sample_rate->valueint, channels->valueint, total_bytes->valueint);
  } else if (std::strcmp(type->valuestring, "audio_playback_chunk") == 0) {
    const cJSON* turn_id = cJSON_GetObjectItemCaseSensitive(payload, "turn_id");
    const cJSON* sequence = cJSON_GetObjectItemCaseSensitive(payload, "sequence");
    const cJSON* bytes = cJSON_GetObjectItemCaseSensitive(payload, "byte_count");
    const cJSON* encoding = cJSON_GetObjectItemCaseSensitive(payload, "encoding");
    const cJSON* pcm = cJSON_GetObjectItemCaseSensitive(payload, "pcm");
    if (!cJSON_IsString(turn_id) || !cJSON_IsNumber(sequence) || !cJSON_IsNumber(bytes) || !cJSON_IsString(encoding) ||
        std::strcmp(encoding->valuestring, "base64") != 0 || !cJSON_IsString(pcm)) error(command_id, "audio_playback_chunk_rejected");
    else ingest_audio_playback_chunk(command_id, turn_id->valuestring, sequence->valueint, pcm->valuestring, bytes->valueint);
  } else if (std::strcmp(type->valuestring, "audio_playback_end") == 0) {
    const cJSON* turn_id = cJSON_GetObjectItemCaseSensitive(payload, "turn_id");
    if (!cJSON_IsString(turn_id)) error(command_id, "audio_playback_end_rejected"); else finish_audio_playback(command_id, turn_id->valuestring);
  } else if (std::strcmp(type->valuestring, "audio_playback_cancel") == 0) {
    const cJSON* turn_id = cJSON_GetObjectItemCaseSensitive(payload, "turn_id");
    const cJSON* reason = cJSON_GetObjectItemCaseSensitive(payload, "reason");
    if (!cJSON_IsString(turn_id)) error(command_id, "audio_playback_cancel_rejected");
    else cancel_audio_playback(command_id, turn_id->valuestring, cJSON_IsString(reason) ? reason->valuestring : "audio_playback_cancelled");
  } else if (std::strcmp(type->valuestring, "set_expression") == 0) {
    const cJSON* expression = cJSON_GetObjectItemCaseSensitive(payload, "expression");
    if (!cJSON_IsString(expression) || !rules::is_expression(expression->valuestring)) {
      error(command_id, "invalid_expression");
    } else {
      board_result = guest_ai::k151::k151_display_expression(expression->valuestring);
      result(command_id, type->valuestring, board_result == ESP_OK, board_result == ESP_OK ? "expression_applied" : "display_error");
    }
  } else if (std::strcmp(type->valuestring, "set_gaze") == 0) {
    const cJSON* x = cJSON_GetObjectItemCaseSensitive(payload, "x");
    const cJSON* y = cJSON_GetObjectItemCaseSensitive(payload, "y");
    if (!cJSON_IsNumber(x) || !cJSON_IsNumber(y) || !rules::is_safe_gaze(x->valueint, y->valueint)) {
      error(command_id, "invalid_safe_gaze");
    } else {
      board_result = may_send_servo_packet(MotionSource::SetGaze)
          ? guest_ai::k151::k151_servo_gaze(x->valueint * 10, y->valueint * 10)
          : ESP_ERR_INVALID_STATE;
      result(command_id, type->valuestring, board_result == ESP_OK,
             board_result == ESP_OK ? "servo_ack_verified_goal_position_written" : "servo_ack_timeout_or_error");
    }
  } else if (std::strcmp(type->valuestring, "play_audio") == 0) {
    const cJSON* asset = cJSON_GetObjectItemCaseSensitive(payload, "asset");
    if (!cJSON_IsString(asset) || std::strcmp(asset->valuestring, "test_tone") != 0) {
      error(command_id, "only_test_tone_supported");
    } else {
      board_result = guest_ai::k151::k151_speaker_test_tone();
      result(command_id, type->valuestring, board_result == ESP_OK,
             board_result == ESP_OK ? "tone_pcm_written_tx_verified_physical_audibility_pending" : "speaker_playback_failed");
    }
  } else if (std::strcmp(type->valuestring, "set_robot_state") == 0) {
    const cJSON* requested_state = cJSON_GetObjectItemCaseSensitive(payload, "state");
    if (!cJSON_IsString(requested_state) || !rules::is_robot_state(requested_state->valuestring)) {
      error(command_id, "invalid_robot_state");
    } else {
      robot_state_ = requested_state->valuestring;
      // State is primarily reporting semantics. Rendering is safe and does not move the robot.
      board_result = guest_ai::k151::k151_display_expression(state_expression(robot_state_));
      result(command_id, type->valuestring, board_result == ESP_OK, board_result == ESP_OK ? "state_applied" : "state_applied_display_error");
    }
  }
#if CONFIG_FEEDX_GUEST_AI_FAULT_INJECTION
  else if (std::strcmp(type->valuestring, "test_fault_injection") == 0) {
    const cJSON* action=cJSON_GetObjectItemCaseSensitive(payload,"action");
    guest_ai::fault::Type fault=guest_ai::fault::Type::None;
    if (cJSON_IsString(action)) {
      if (!std::strcmp(action->valuestring,"camera_dqbuf_timeout_once")) fault=guest_ai::fault::Type::CameraDqbufTimeoutOnce;
      else if (!std::strcmp(action->valuestring,"usb_tx_zero_progress_once")) fault=guest_ai::fault::Type::UsbTxZeroProgressOnce;
      else if (!std::strcmp(action->valuestring,"usb_tx_partial_once")) fault=guest_ai::fault::Type::UsbTxPartialOnce;
    }
    const bool armed=fault!=guest_ai::fault::Type::None && guest_ai::fault::arm(fault,command_id);
    result(command_id,type->valuestring,armed,armed?"fault_armed":"fault_invalid_or_already_armed");
  }
#endif
  else if (std::strcmp(type->valuestring, "request_capability_test") == 0) {
    const cJSON* requested_capability = cJSON_GetObjectItemCaseSensitive(payload, "capability");
    if (!cJSON_IsString(requested_capability) || !rules::is_capability(requested_capability->valuestring)) {
      error(command_id, "invalid_capability");
    } else {
      const char* capability = requested_capability->valuestring;
      const char* detail = "capability_test_failed";
      const char* status = "blocked";
      if (std::strcmp(capability, "display") == 0) {
        board_result = guest_ai::k151::k151_display_expression("neutral");
        detail = board_result == ESP_OK ? "render_command_completed_physical_validation_pending" : "display_test_failed";
        status = board_result == ESP_OK ? "partial" : "blocked";
      } else if (std::strcmp(capability, "servo_x") == 0 || std::strcmp(capability, "servo_y") == 0) {
        // Discovery is deliberately non-motion: first prove protocol, position and
        // torque-state reads before any future set_gaze can drive the mechanism.
        guest_ai::k151::ServoProbe probe{};
        const uint8_t id = std::strcmp(capability, "servo_x") == 0 ? 1 : 2;
        board_result = guest_ai::k151::k151_servo_probe(id, &probe);
        detail = board_result == ESP_OK
            ? (probe.torque_enabled ? "servo_ping_position_torque_verified_physical_motion_pending"
                                    : "servo_ping_position_verified_torque_disabled_physical_motion_blocked")
            : "servo_ping_or_read_failed";
        status = board_result == ESP_OK ? "partial" : "blocked";
      } else if (std::strcmp(capability, "speaker") == 0) {
        board_result = guest_ai::k151::k151_speaker_test_tone();
        detail = board_result == ESP_OK ? "tone_pcm_written_tx_verified_physical_audibility_pending" : "speaker_test_failed";
        status = board_result == ESP_OK ? "partial" : "blocked";
      } else if (std::strcmp(capability, "microphone") == 0) {
        guest_ai::k151::AudioLevel level{};
        board_result = guest_ai::k151::k151_microphone_capture_level(&level);
        const bool mic_verified = board_result == ESP_OK && guest_ai::k151::microphone_runtime_capture_verified(level);
        detail = mic_verified ? "pcm_capture_completed_rx_enabled" : "microphone_capture_failed";
        status = mic_verified ? "pass" : "blocked";
        cJSON* evidence = cJSON_CreateObject();
        cJSON_AddNumberToObject(evidence,"sample_count",level.sample_count); cJSON_AddNumberToObject(evidence,"sample_rate_hz",level.sample_rate_hz); cJSON_AddNumberToObject(evidence,"bit_depth",16); cJSON_AddNumberToObject(evidence,"channel_count",level.channel_count); cJSON_AddNumberToObject(evidence,"active_channel_mask",level.active_channel_mask); cJSON_AddNumberToObject(evidence,"peak",level.peak); cJSON_AddNumberToObject(evidence,"rms",level.rms); cJSON_AddNumberToObject(evidence,"mean",level.mean); cJSON_AddNumberToObject(evidence,"zero_sample_count",level.zero_sample_count); cJSON_AddBoolToObject(evidence,"all_zero",level.zero_sample_count==level.sample_count); cJSON_AddNumberToObject(evidence,"capture_duration_ms",level.duration_ms); cJSON_AddNumberToObject(evidence,"free_heap_before",level.free_heap_before); cJSON_AddNumberToObject(evidence,"free_heap_after",level.free_heap_after); cJSON_AddBoolToObject(evidence,"rx_lifecycle_enabled",level.rx_lifecycle_enabled); cJSON_AddBoolToObject(evidence,"rx_channel_enabled_before_read",level.rx_channel_enabled_before_read); cJSON_AddBoolToObject(evidence,"rx_channel_enabled_after_read",level.rx_channel_enabled_after_read); cJSON_AddBoolToObject(evidence,"runtime_verified",mic_verified);
        result(command_id,type->valuestring,mic_verified,detail,evidence);
        capability_status(command_id, capability, status, detail); cJSON_Delete(message); return;
      } else if (std::strcmp(capability, "camera") == 0) {
        ESP_LOGI(kTag, "camera_stage command_id=%s stage=command_received result=1 elapsed_ms=0", command_id);
        ESP_LOGI(kTag, "camera_stage command_id=%s stage=dispatch_started result=1 elapsed_ms=0", command_id);
        guest_ai::k151::CameraFrameInfo frame_info{};
        const auto camera_state = guest_ai::k151::k151_camera_init_state();
        board_result = camera_state == guest_ai::k151::CameraInitState::Ready
            ? guest_ai::k151::k151_camera_capture_one(command_id, &frame_info) : ESP_ERR_INVALID_STATE;
        detail = board_result == ESP_OK ? "camera_metadata_read_runtime_frame_validation_pending" :
                 (camera_state == guest_ai::k151::CameraInitState::VideoDeviceMissing ? "camera_video_device_missing" : "camera_capture_failed");
        status = board_result == ESP_OK ? "partial" : "blocked";
        cJSON* evidence = cJSON_CreateObject();
        cJSON_AddStringToObject(evidence,"device","GC0308 via esp_video DVP"); cJSON_AddNumberToObject(evidence,"width",frame_info.width); cJSON_AddNumberToObject(evidence,"height",frame_info.height); cJSON_AddNumberToObject(evidence,"pixel_format",frame_info.pixel_format); cJSON_AddNumberToObject(evidence,"bytes_used",frame_info.bytes); cJSON_AddNumberToObject(evidence,"buffer_index",frame_info.buffer_index); cJSON_AddNumberToObject(evidence,"sequence",frame_info.sequence); cJSON_AddNumberToObject(evidence,"timestamp_us",frame_info.timestamp_us); cJSON_AddNumberToObject(evidence,"capture_latency_ms",frame_info.latency_ms); cJSON_AddBoolToObject(evidence,"acquire_ok",frame_info.acquired); cJSON_AddBoolToObject(evidence,"release_ok",frame_info.released); cJSON_AddBoolToObject(evidence,"stream_on_ok",frame_info.stream_on); cJSON_AddBoolToObject(evidence,"stream_off_ok",frame_info.stream_off); cJSON_AddNumberToObject(evidence,"free_heap_before",frame_info.free_heap_before); cJSON_AddNumberToObject(evidence,"free_heap_after",frame_info.free_heap_after);
        cJSON_AddBoolToObject(evidence,"querycap_ok",frame_info.querycap_ok); cJSON_AddBoolToObject(evidence,"capabilities_ok",frame_info.capabilities_ok); cJSON_AddStringToObject(evidence,"driver",frame_info.driver); cJSON_AddStringToObject(evidence,"card",frame_info.card); cJSON_AddStringToObject(evidence,"bus_info",frame_info.bus_info); cJSON_AddNumberToObject(evidence,"capabilities",frame_info.capabilities); cJSON_AddNumberToObject(evidence,"device_caps",frame_info.device_caps); cJSON_AddBoolToObject(evidence,"enum_fmt_ok",frame_info.enum_fmt_ok); cJSON_AddStringToObject(evidence,"enumerated_formats",frame_info.enumerated_formats); cJSON* requested_format=cJSON_AddObjectToObject(evidence,"requested_format"); cJSON_AddNumberToObject(requested_format,"width",frame_info.requested_width); cJSON_AddNumberToObject(requested_format,"height",frame_info.requested_height); cJSON_AddNumberToObject(requested_format,"pixel_format",frame_info.requested_pixel_format); cJSON* negotiated_format=cJSON_AddObjectToObject(evidence,"negotiated_format"); cJSON_AddNumberToObject(negotiated_format,"width",frame_info.negotiated_width); cJSON_AddNumberToObject(negotiated_format,"height",frame_info.negotiated_height); cJSON_AddNumberToObject(negotiated_format,"pixel_format",frame_info.negotiated_pixel_format); cJSON_AddBoolToObject(evidence,"s_fmt_ok",frame_info.s_fmt_ok);
        cJSON_AddStringToObject(evidence,"failed_step",frame_info.failed_step); cJSON_AddStringToObject(evidence,"last_stage",frame_info.last_stage); cJSON_AddNumberToObject(evidence,"command_elapsed_ms",frame_info.command_elapsed_ms); cJSON_AddNumberToObject(evidence,"dqbuf_timeout_ms",frame_info.dqbuf_timeout_ms); cJSON_AddBoolToObject(evidence,"dqbuf_timeout_set",frame_info.dqbuf_timeout_set); cJSON_AddNumberToObject(evidence,"io_result",frame_info.failed_result); cJSON_AddNumberToObject(evidence,"errno",frame_info.failed_errno); cJSON_AddStringToObject(evidence,"errno_string",frame_info.failed_errno_string); cJSON_AddNumberToObject(evidence,"fd",frame_info.fd); cJSON_AddNumberToObject(evidence,"fd_at_failure",frame_info.fd_at_failure); cJSON_AddNumberToObject(evidence,"requested_buffer_count",frame_info.requested_buffer_count); cJSON_AddNumberToObject(evidence,"returned_buffer_count",frame_info.returned_buffer_count); cJSON_AddNumberToObject(evidence,"buffer_length",frame_info.buffer_length); cJSON_AddBoolToObject(evidence,"mmap_ok",frame_info.mmap_ok); cJSON_AddBoolToObject(evidence,"initial_qbuf_ok",frame_info.initial_qbuf_ok); cJSON_AddBoolToObject(evidence,"requeue_ok",frame_info.requeue_ok); cJSON_AddBoolToObject(evidence,"buffer_queued",frame_info.buffer_queued); cJSON_AddBoolToObject(evidence,"streaming",frame_info.streaming); cJSON_AddBoolToObject(evidence,"unmap_ok",frame_info.unmap_ok); cJSON_AddBoolToObject(evidence,"close_ok",frame_info.close_ok);
        ESP_LOGI(kTag, "camera_stage command_id=%s stage=camera_capture_end result=%d elapsed_ms=%u", command_id, board_result == ESP_OK, frame_info.command_elapsed_ms);
        result(command_id,type->valuestring,board_result==ESP_OK,detail,evidence);
        capability_status(command_id, capability, status, detail); cJSON_Delete(message); return;
      } else if (std::strcmp(capability, "telemetry") == 0) {
        (void)guest_ai::k151::k151_get_telemetry();
        board_result = ESP_OK;
        detail = "telemetry_read";
        status = "partial";
      } else {  // usb_transport: this command itself proves the current transport.
        board_result = ESP_OK;
        detail = "usb_cdc_transport_active";
        status = "pass";
      }
      result(command_id, type->valuestring, board_result == ESP_OK, detail);
      capability_status(command_id, capability, status, detail);
    }
  } else {
    error(command_id, "unsupported_command");
  }

  cJSON_Delete(message);
}

}  // namespace guest_ai::protocol
