#pragma once

namespace guest_ai::protocol {

enum class MotionSource {
  StartupTransition,
  RobotStateTransition,
  SetGaze,
};

// Protocol and state transitions are deliberately not hardware motion policy.
inline constexpr bool may_send_servo_packet(MotionSource source) {
  return source == MotionSource::SetGaze;
}

}  // namespace guest_ai::protocol
