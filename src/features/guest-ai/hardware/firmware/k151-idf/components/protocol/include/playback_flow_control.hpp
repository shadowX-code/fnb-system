#pragma once

#include <cstdint>

namespace guest_ai::protocol {

// Shared by the USB upload producer and the local output worker. This owns
// only bounded, sequential upload accounting; the PCM store is one bounded
// full-turn prebuffer owned by Transport.
class PlaybackFlowControl {
 public:
  enum class ChunkDecision : uint8_t { Accepted, SequenceMismatch, ByteCountInvalid };

  void start(uint32_t total_bytes) {
    total_bytes_ = total_bytes;
    accepted_bytes_ = played_bytes_ = expected_sequence_ = accepted_chunks_ = played_chunks_ = 0;
  }
  void reset() { start(0); }

  ChunkDecision validate(uint32_t sequence, uint32_t byte_count) const {
    if (sequence != expected_sequence_) return ChunkDecision::SequenceMismatch;
    if (byte_count == 0 || accepted_bytes_ + byte_count > total_bytes_) return ChunkDecision::ByteCountInvalid;
    return ChunkDecision::Accepted;
  }
  void accepted(uint32_t byte_count) {
    accepted_bytes_ += byte_count;
    ++expected_sequence_;
    ++accepted_chunks_;
  }
  void played(uint32_t byte_count) { played_bytes_ += byte_count; ++played_chunks_; }
  bool all_accepted() const { return total_bytes_ != 0 && accepted_bytes_ == total_bytes_; }
  bool drained() const { return all_accepted() && played_bytes_ == accepted_bytes_; }

  uint32_t total_bytes() const { return total_bytes_; }
  uint32_t accepted_bytes() const { return accepted_bytes_; }
  uint32_t played_bytes() const { return played_bytes_; }
  uint32_t expected_sequence() const { return expected_sequence_; }
  uint32_t accepted_chunks() const { return accepted_chunks_; }
  uint32_t played_chunks() const { return played_chunks_; }

 private:
  uint32_t total_bytes_{};
  uint32_t accepted_bytes_{};
  uint32_t played_bytes_{};
  uint32_t expected_sequence_{};
  uint32_t accepted_chunks_{};
  uint32_t played_chunks_{};
};

}  // namespace guest_ai::protocol
