#pragma once

#include <cstdint>

namespace guest_ai::protocol {

// Keep host-to-device command acquisition responsive while guaranteeing that a
// no-data USB Serial/JTAG session cannot spin a runtime task at CPU speed.
struct UsbRxScheduling {
  static constexpr uint32_t kReadTimeoutMs = 10;
  static constexpr uint32_t kPostPollDelayMs = 10;
  // A bounded drain runs only after data is available. With 256-byte reads,
  // eight reads per scheduler pass sustain >200 KB/s while the no-data path
  // remains bounded by the existing 10 ms wait + yield.
  static constexpr uint32_t kMaxBurstReads = 8;
  static constexpr uint32_t kMaximumIdlePollsPerSecond = 100;
};

}  // namespace guest_ai::protocol
