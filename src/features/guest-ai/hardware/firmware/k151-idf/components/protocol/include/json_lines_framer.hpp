#pragma once

#include <cstddef>
#include <cstdint>
#include <cstring>

namespace guest_ai::protocol {

class JsonLinesFramer {
 public:
  static constexpr size_t kMaxFrameSize = 2048;
  struct Diagnostics {
    uint32_t cumulative_bytes{};
    uint32_t newline_count{};
    size_t buffered_length{};
    size_t last_frame_length{};
    uint32_t last_frame_hash{};
    size_t last_preview_length{};
    uint8_t first_bytes[16]{};
    uint8_t last_bytes[16]{};
    bool last_begins_object{};
    bool last_ends_object{};
    bool discarding{};
  };
  using FrameHandler = void (*)(void*, const char*);
  using ErrorHandler = void (*)(void*, const char*);

  JsonLinesFramer(FrameHandler frame_handler, ErrorHandler error_handler, void* context)
      : frame_handler_(frame_handler), error_handler_(error_handler), context_(context) {}

  void ingest(const unsigned char* bytes, size_t count) {
    for (size_t index = 0; index < count; ++index) {
      const char byte = static_cast<char>(bytes[index]);
      ++diagnostics_.cumulative_bytes;
      if (byte == '\r') continue;
      if (byte == '\n') {
        ++diagnostics_.newline_count;
        finish_line();
        continue;
      }
      if (discarding_) continue;
      if (used_ >= kMaxFrameSize) {
        discarding_ = true;
        diagnostics_.discarding = true;
        if (error_handler_) error_handler_(context_, "frame_too_large");
        continue;
      }
      buffer_[used_++] = byte;
      diagnostics_.buffered_length = used_;
    }
  }

  void reset() {
    used_ = 0;
    discarding_ = false;
    diagnostics_.buffered_length = 0;
    diagnostics_.discarding = false;
  }

  const Diagnostics& diagnostics() const { return diagnostics_; }

 private:
  void finish_line() {
    if (discarding_) {
      reset();
      return;
    }
    if (used_ == 0) return;
    diagnostics_.last_frame_length = used_;
    diagnostics_.last_frame_hash = hash_frame(buffer_, used_);
    diagnostics_.last_preview_length = used_ < sizeof(diagnostics_.first_bytes) ? used_ : sizeof(diagnostics_.first_bytes);
    std::memset(diagnostics_.first_bytes, 0, sizeof(diagnostics_.first_bytes));
    std::memset(diagnostics_.last_bytes, 0, sizeof(diagnostics_.last_bytes));
    std::memcpy(diagnostics_.first_bytes, buffer_, diagnostics_.last_preview_length);
    const size_t tail = used_ < sizeof(diagnostics_.last_bytes) ? used_ : sizeof(diagnostics_.last_bytes);
    std::memcpy(diagnostics_.last_bytes, buffer_ + used_ - tail, tail);
    diagnostics_.last_begins_object = buffer_[0] == '{';
    diagnostics_.last_ends_object = buffer_[used_ - 1] == '}';
    buffer_[used_] = '\0';
    if (frame_handler_) frame_handler_(context_, buffer_);
    used_ = 0;
    diagnostics_.buffered_length = 0;
  }

  static uint32_t hash_frame(const char* bytes, size_t count) {
    uint32_t hash = 2166136261u;
    for (size_t index = 0; index < count; ++index) hash = (hash ^ static_cast<uint8_t>(bytes[index])) * 16777619u;
    return hash;
  }

  char buffer_[kMaxFrameSize + 1]{};
  size_t used_{};
  bool discarding_{};
  Diagnostics diagnostics_{};
  FrameHandler frame_handler_{};
  ErrorHandler error_handler_{};
  void* context_{};
};

}  // namespace guest_ai::protocol
