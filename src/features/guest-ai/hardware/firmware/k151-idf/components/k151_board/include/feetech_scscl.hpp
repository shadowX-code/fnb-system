#pragma once

#include <cstddef>
#include <cstdint>

namespace guest_ai::k151::feetech {

constexpr uint8_t kYawId = 1;
constexpr uint8_t kPitchId = 2;
constexpr int kYawMin = -1280;
constexpr int kYawMax = 1280;
constexpr int kPitchMin = 50;
constexpr int kPitchMax = 850;
constexpr uint8_t kInstructionPing = 0x01;
constexpr uint8_t kInstructionRead = 0x02;
constexpr uint8_t kInstructionWrite = 0x03;
constexpr uint8_t kTorqueEnableRegister = 40;
constexpr uint8_t kGoalPositionRegister = 42;
constexpr uint8_t kPresentPositionRegister = 56;

inline bool is_safe_gaze(int x_tenths, int y_tenths) {
  return x_tenths >= kYawMin && x_tenths <= kYawMax && y_tenths >= kPitchMin && y_tenths <= kPitchMax;
}

inline uint16_t yaw_position(int x_tenths) {
  const int value = 460 + x_tenths * 16 / 50;
  return static_cast<uint16_t>(value < 0 ? 0 : (value > 1000 ? 1000 : value));
}

inline uint16_t pitch_position(int y_tenths) {
  const int value = 620 + (y_tenths - 450) * 16 / 50;
  return static_cast<uint16_t>(value < 0 ? 0 : (value > 1000 ? 1000 : value));
}

inline uint8_t checksum(const uint8_t* packet, size_t first, size_t last_exclusive) {
  uint8_t value = 0;
  for (size_t index = first; index < last_exclusive; ++index) value += packet[index];
  return static_cast<uint8_t>(~value);
}

inline size_t encode_ping_packet(uint8_t id, uint8_t out[6]) {
  out[0] = 0xff; out[1] = 0xff; out[2] = id; out[3] = 2; out[4] = kInstructionPing;
  out[5] = checksum(out, 2, 5);
  return 6;
}

inline size_t encode_read_packet(uint8_t id, uint8_t address, uint8_t bytes_to_read, uint8_t out[8]) {
  out[0] = 0xff; out[1] = 0xff; out[2] = id; out[3] = 4; out[4] = kInstructionRead;
  out[5] = address; out[6] = bytes_to_read; out[7] = checksum(out, 2, 7);
  return 8;
}

inline bool validate_status_packet(const uint8_t* packet, size_t size, uint8_t id, uint8_t* status = nullptr) {
  if (size != 6 || packet[0] != 0xff || packet[1] != 0xff || packet[2] != id || packet[3] != 2 ||
      packet[5] != checksum(packet, 2, 5)) return false;
  if (status) *status = packet[4];
  return true;
}

inline bool validate_read_packet(const uint8_t* packet, size_t size, uint8_t id, uint8_t data_size, uint8_t* status = nullptr) {
  if (size != static_cast<size_t>(data_size) + 6 || packet[0] != 0xff || packet[1] != 0xff || packet[2] != id ||
      packet[3] != static_cast<uint8_t>(data_size + 2) || packet[size - 1] != checksum(packet, 2, size - 1)) return false;
  if (status) *status = packet[4];
  return true;
}

inline size_t encode_position_packet(uint8_t id, uint16_t position, uint16_t time, uint16_t speed, uint8_t out[13]) {
  out[0] = 0xff;
  out[1] = 0xff;
  out[2] = id;
  out[3] = 9;
  out[4] = kInstructionWrite;
  out[5] = kGoalPositionRegister;
  out[6] = static_cast<uint8_t>(position >> 8);
  out[7] = static_cast<uint8_t>(position);
  out[8] = static_cast<uint8_t>(time >> 8);
  out[9] = static_cast<uint8_t>(time);
  out[10] = static_cast<uint8_t>(speed >> 8);
  out[11] = static_cast<uint8_t>(speed);
  out[12] = checksum(out, 2, 12);
  return 13;
}

}  // namespace guest_ai::k151::feetech
