#pragma once

#include <string>

namespace guest_ai::bridge {

enum class RobotState { Offline, Booting, Idle, Attention, Listening, Thinking, Speaking, Error };
enum class CommandType { SetRobotState, SetExpression, SetGaze, PlayAudio, RequestCapabilityTest, Unsupported };

// Host gaze values are degrees; main.cpp converts them to the BSP's 0.1° unit.
// The official yaw range is -128°..128°. Keep a deliberate 38° mechanical margin.
constexpr int kSafeXMin = -90;
constexpr int kSafeXMax = 90;
constexpr int kSafeYMin = 5;
constexpr int kSafeYMax = 85;

inline int clamp(int value, int minimum, int maximum) { return value < minimum ? minimum : value > maximum ? maximum : value; }
inline bool isSafeGaze(int x, int y) { return x >= kSafeXMin && x <= kSafeXMax && y >= kSafeYMin && y <= kSafeYMax; }
inline RobotState robotStateFromWire(const std::string& state) {
  if (state == "IDLE") return RobotState::Idle;
  if (state == "ATTENTION") return RobotState::Attention;
  if (state == "LISTENING") return RobotState::Listening;
  if (state == "THINKING") return RobotState::Thinking;
  if (state == "SPEAKING") return RobotState::Speaking;
  return RobotState::Error;
}
inline const char* robotStateToWire(RobotState state) {
  switch (state) { case RobotState::Offline: return "OFFLINE"; case RobotState::Booting: return "BOOTING"; case RobotState::Idle: return "IDLE"; case RobotState::Attention: return "ATTENTION"; case RobotState::Listening: return "LISTENING"; case RobotState::Thinking: return "THINKING"; case RobotState::Speaking: return "SPEAKING"; default: return "ERROR"; }
}
inline CommandType commandFromWire(const std::string& type) {
  if (type == "set_robot_state") return CommandType::SetRobotState;
  if (type == "set_expression") return CommandType::SetExpression;
  if (type == "set_gaze") return CommandType::SetGaze;
  if (type == "play_audio") return CommandType::PlayAudio;
  if (type == "request_capability_test") return CommandType::RequestCapabilityTest;
  return CommandType::Unsupported;
}
inline bool isAllowedExpression(const std::string& expression) { return expression == "happy" || expression == "neutral" || expression == "listening" || expression == "thinking" || expression == "speaking" || expression == "blink"; }
inline bool isAllowedCapability(const std::string& capability) { return capability == "display" || capability == "servo_x" || capability == "servo_y" || capability == "speaker" || capability == "microphone" || capability == "camera" || capability == "wifi"; }

}  // namespace guest_ai::bridge
