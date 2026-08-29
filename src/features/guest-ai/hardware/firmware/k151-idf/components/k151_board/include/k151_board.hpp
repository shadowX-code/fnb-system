#pragma once

#include <cstddef>
#include <cstdint>
#if __has_include(<esp_err.h>)
#include <esp_err.h>
#else
using esp_err_t = int;
#endif

namespace guest_ai::k151 {

struct AudioLevel {
  uint32_t sample_count{}, sample_rate_hz{}, channel_count{}, active_channel_mask{}, zero_sample_count{}, duration_ms{};
  uint16_t peak{};
  int32_t rms{}, mean{};
  // Canonical S16LE RMS with eight fractional bits.  The integer `rms` field
  // remains the public diagnostics value; rms_q8 keeps low-level capture
  // decisions from collapsing nearby room-noise and quiet-speech values.
  uint32_t rms_q8{};
  uint32_t free_heap_before{}, free_heap_after{};
  bool rx_lifecycle_enabled{};
  bool rx_channel_enabled_before_read{};
  bool rx_channel_enabled_after_read{};
};
struct CameraFrameInfo {
  uint16_t width{}, height{};
  uint32_t pixel_format{}, bytes{}, buffer_index{}, sequence{}, latency_ms{}, free_heap_before{}, free_heap_after{};
  uint64_t timestamp_us{};
  bool acquired{}, released{}, stream_on{}, stream_off{};
  // Runtime V4L2 diagnostic metadata. No frame payload is ever retained.
  char failed_step[24]{};
  int32_t failed_result{}, failed_errno{};
  char failed_errno_string[64]{};
  int32_t fd{-1}, fd_at_failure{-1};
  uint32_t requested_buffer_count{}, returned_buffer_count{}, buffer_length{};
  bool mmap_ok{}, initial_qbuf_ok{}, requeue_ok{}, unmap_ok{}, close_ok{};
  bool buffer_queued{}, streaming{};
  // Negotiation evidence is metadata only. It describes the real V4L2 device
  // and never contains image payload bytes.
  bool querycap_ok{}, capabilities_ok{}, enum_fmt_ok{}, s_fmt_ok{};
  char driver[32]{}, card[32]{}, bus_info[32]{};
  uint32_t capabilities{}, device_caps{};
  uint16_t requested_width{}, requested_height{}, negotiated_width{}, negotiated_height{};
  uint32_t requested_pixel_format{}, negotiated_pixel_format{};
  char enumerated_formats[192]{};
  char last_stage[24]{};
  uint32_t command_elapsed_ms{};
  uint32_t dqbuf_timeout_ms{};
  bool dqbuf_timeout_set{};
};
enum class CameraInitState : uint8_t { Uninitialized, Ready, VideoDeviceMissing, ProbeFailed, InitFailed };
struct Telemetry {
  uint32_t free_heap;
  size_t min_free_heap;
  uint64_t uptime_ms;
  uint32_t init_stack_high_water_words;
  uint32_t runtime_stack_high_water_words;
};

struct ServoProbe {
  bool ping_ok{};
  bool position_ok{};
  bool torque_state_ok{};
  uint16_t present_position{};
  bool torque_enabled{};
  uint8_t status{};
};

// The sole owner of K151 buses, PMIC rails, display, audio and camera resources.
esp_err_t k151_board_init();
esp_err_t k151_display_expression(const char* expression);
esp_err_t k151_servo_center();
esp_err_t k151_servo_gaze(int x_degrees_tenths, int y_degrees_tenths);
esp_err_t k151_servo_probe(uint8_t servo_id, ServoProbe* probe);
esp_err_t k151_speaker_test_tone();
// Bounded 24 kHz / S16LE / mono playback session.  These functions reuse the
// factory-proven AW88298/TX ownership path and deliberately do not touch the
// persistent MicRxLifecycle session.
esp_err_t k151_speaker_playback_begin(uint32_t sample_rate_hz, uint8_t channels);
esp_err_t k151_speaker_playback_write(const uint8_t* pcm, size_t byte_count, size_t* bytes_written);
// Allows the final codec/I2S DMA block to reach AW88298 before mute/close.
esp_err_t k151_speaker_playback_drain();
esp_err_t k151_speaker_playback_end();
esp_err_t k151_microphone_capture_level(AudioLevel* level);
constexpr size_t k151_audio_capture_chunk_bytes = 960;
// Selects channel 0 from a 20 ms ES7210 stereo read into PCM S16LE mono while
// preserving the established persistent MicRxLifecycle session.
esp_err_t k151_microphone_read_mono_chunk(uint8_t* destination, size_t capacity,
                                          AudioLevel* mono_level = nullptr);
esp_err_t k151_camera_capture_one(const char* command_id, CameraFrameInfo* frame);
CameraInitState k151_camera_init_state();
Telemetry k151_get_telemetry();
void k151_record_init_stack_high_water(uint32_t words);
void k151_record_runtime_stack_high_water(uint32_t words);

}  // namespace guest_ai::k151
