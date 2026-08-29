#pragma once

#include <cstddef>
#include <cstdint>

namespace guest_ai::protocol {

struct UsbTxWriteOps {
  void* context;
  int (*write)(void*, const char*, size_t, uint32_t);
  uint64_t (*now_us)(void*);
  void (*wait_tick)(void*);
};

struct UsbTxWriteResult { size_t intended{}, written{}; uint32_t calls{}; bool timed_out{}; bool permanent_error{}; };

inline bool usb_tx_write_full(const UsbTxWriteOps& ops, const char* data, size_t length, UsbTxWriteResult* result,
                              uint32_t slice_ms = 20, uint32_t timeout_ms = 500) {
  *result = {length};
  const uint64_t deadline = ops.now_us(ops.context) + static_cast<uint64_t>(timeout_ms) * 1000;
  while (result->written < length && ops.now_us(ops.context) < deadline) {
    const int count = ops.write(ops.context, data + result->written, length - result->written, slice_ms);
    ++result->calls;
    if (count < 0) { result->permanent_error = true; return false; }
    if (count > 0) { result->written += static_cast<size_t>(count); continue; }
    ops.wait_tick(ops.context);
  }
  result->timed_out = result->written != length;
  return !result->timed_out;
}
}  // namespace guest_ai::protocol
