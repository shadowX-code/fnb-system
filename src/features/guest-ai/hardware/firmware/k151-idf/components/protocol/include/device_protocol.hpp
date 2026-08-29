#pragma once

#include <cstddef>
#include <cstdint>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>

#include "json_lines_framer.hpp"
#include "playback_flow_control.hpp"

namespace guest_ai::protocol {

class Transport {
 public:
  Transport();

  // Once the application transport is online, USB Serial/JTAG is reserved for
  // complete canonical JSON-lines frames. ROM/bootloader output precedes this
  // boundary, but runtime ESP_LOG output must never share the protocol wire.
  static void enable_protocol_exclusive_wire();
  void ingest(const uint8_t* bytes, size_t count);
  void reset();
  void send_startup_snapshot();
  void heartbeat();

 private:
  JsonLinesFramer framer_;
  const char* robot_state_{"BOOTING"};
  volatile bool audio_capture_active_{false};
  volatile bool audio_capture_cancel_{false};
  TaskHandle_t audio_capture_task_handle_{};
  enum class AudioCaptureState : uint8_t { Idle, Starting, Capturing, Completing, Failed };
  volatile AudioCaptureState audio_capture_state_{AudioCaptureState::Idle};
  char audio_turn_id_[40]{};
  uint32_t audio_max_duration_ms_{};

  enum class AudioPlaybackState : uint8_t { Idle, Receiving, Ready, Playing };
  volatile bool audio_playback_active_{false};
  volatile bool audio_playback_abort_requested_{false};
  volatile AudioPlaybackState audio_playback_state_{AudioPlaybackState::Idle};
  TaskHandle_t audio_playback_task_handle_{};
  uint8_t* audio_playback_buffer_{};
  uint32_t audio_playback_allocated_bytes_{};
  uint32_t audio_playback_free_heap_before_{};
  char audio_playback_turn_id_[40]{};
  char audio_playback_failure_[48]{};
  PlaybackFlowControl audio_playback_flow_{};

  static void handle_frame(void* context, const char* frame);
  static void handle_framing_error(void* context, const char* code);
  void dispatch(const char* frame);
  void capability_status(const char* message_id, const char* capability = nullptr, const char* status = nullptr, const char* detail = nullptr);
  void device_snapshot(const char* command_id);
  void error(const char* command_id, const char* detail, void* evidence = nullptr);
  void result(const char* command_id, const char* command_type, bool ok, const char* detail, void* evidence = nullptr);
  static void audio_capture_task(void* context);
  bool start_audio_capture(const char* command_id, const char* turn_id, uint32_t max_duration_ms);
  void stop_audio_capture(const char* command_id, const char* reason);
  bool start_audio_playback(const char* command_id, const char* turn_id, uint32_t sample_rate_hz, uint32_t channels, uint32_t total_bytes);
  void ingest_audio_playback_chunk(const char* command_id, const char* turn_id, uint32_t sequence, const char* encoded, uint32_t declared_bytes);
  void finish_audio_playback(const char* command_id, const char* turn_id);
  void cancel_audio_playback(const char* command_id, const char* turn_id, const char* reason);
  void abort_audio_playback(const char* reason);
  void release_audio_playback_buffer();
  static void audio_playback_task(void* context);
};

}  // namespace guest_ai::protocol

#if CONFIG_FEEDX_GUEST_AI_FAULT_INJECTION
extern "C" bool feedx_test_send_message(const char* type, const char* command_id, const char* detail);
#endif
