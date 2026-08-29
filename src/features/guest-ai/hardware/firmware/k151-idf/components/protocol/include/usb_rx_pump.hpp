#pragma once

#include <cstddef>
#include <cstdint>

namespace guest_ai::protocol {

struct UsbRxOps {
  void* context;
  int (*read)(void* context, uint8_t* buffer, size_t capacity);
  void (*ingest)(void* context, const uint8_t* bytes, size_t count);
  void (*reset)(void* context);
};

struct UsbRxDiagnostics {
  uint32_t reconnects{};
  uint32_t disconnects{};
  uint32_t read_calls{};
  uint32_t zero_byte_reads{};
  uint32_t read_errors{};
  uint32_t bytes_received{};
  uint32_t newline_count{};
  int last_read_result{};
  uint32_t last_read_newlines{};
  uint8_t last_first_byte{};
  uint8_t last_last_byte{};
};

// Owns only the RX transport boundary. Protocol framing and dispatch remain in
// Transport::ingest(), so partial and multi-frame input follow the one existing
// JSON-lines path.
class UsbRxPump {
 public:
  bool poll(UsbRxOps& ops, bool connected, uint8_t* buffer, size_t capacity) {
    if (!connected) {
      if (connected_) { connected_ = false; ++diagnostics_.disconnects; ops.reset(ops.context); }
      return false;
    }
    if (!connected_) { connected_ = true; ++diagnostics_.reconnects; ops.reset(ops.context); }
    ++diagnostics_.read_calls;
    const int count = ops.read(ops.context, buffer, capacity);
    diagnostics_.last_read_result = count;
    if (count > 0) {
      const size_t received = static_cast<size_t>(count);
      diagnostics_.bytes_received += static_cast<uint32_t>(received);
      diagnostics_.last_read_newlines = 0;
      diagnostics_.last_first_byte = buffer[0];
      diagnostics_.last_last_byte = buffer[received - 1];
      for (size_t index = 0; index < received; ++index) if (buffer[index] == '\n') { ++diagnostics_.newline_count; ++diagnostics_.last_read_newlines; }
      ops.ingest(ops.context, buffer, received);
      return true;
    }
    if (count == 0) ++diagnostics_.zero_byte_reads;
    else ++diagnostics_.read_errors;
    return false;
  }

  const UsbRxDiagnostics& diagnostics() const { return diagnostics_; }

 private:
  bool connected_{};
  UsbRxDiagnostics diagnostics_{};
};

}  // namespace guest_ai::protocol
