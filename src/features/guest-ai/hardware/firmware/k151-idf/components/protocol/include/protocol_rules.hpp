#pragma once

#include <cstring>

namespace guest_ai::protocol::rules {

inline bool equals_one_of(const char* value, const char* const* values, size_t count) {
  if (!value) return false;
  for (size_t index = 0; index < count; ++index) {
    if (std::strcmp(value, values[index]) == 0) return true;
  }
  return false;
}

inline bool is_expression(const char* value) {
  static constexpr const char* values[] = {
      "neutral", "happy", "listening", "thinking", "speaking", "blink"};
  return equals_one_of(value, values, sizeof(values) / sizeof(values[0]));
}

inline bool is_robot_state(const char* value) {
  static constexpr const char* values[] = {
      "OFFLINE", "BOOTING", "IDLE", "ATTENTION", "LISTENING", "THINKING", "SPEAKING", "ERROR"};
  return equals_one_of(value, values, sizeof(values) / sizeof(values[0]));
}

inline bool is_capability(const char* value) {
  static constexpr const char* values[] = {
      "display", "servo_x", "servo_y", "speaker", "microphone", "camera", "telemetry", "usb_transport"};
  return equals_one_of(value, values, sizeof(values) / sizeof(values[0]));
}

inline bool is_safe_gaze(int x, int y) {
  return x >= -90 && x <= 90 && y >= 5 && y <= 85;
}

}  // namespace guest_ai::protocol::rules
