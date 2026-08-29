#pragma once

#include <cstddef>
#include <cstdint>

namespace guest_ai::k151 {

// I2S0 TX is configured as two 16-bit standard-I2S slots.  The Voice
// protocol remains mono S16LE; this adapter makes each protocol sample an
// explicit L/R frame before it reaches the factory-owned TX channel.
constexpr size_t kSpeakerWireSlots = 2;

constexpr size_t speaker_stereo_bytes_for_mono(size_t mono_bytes) {
  return mono_bytes * kSpeakerWireSlots;
}

inline bool expand_mono_s16le_to_stereo(const uint8_t* mono, size_t mono_bytes,
                                        uint8_t* stereo, size_t stereo_capacity) {
  if (!mono || !stereo || mono_bytes == 0 || mono_bytes % 2 != 0 ||
      stereo_capacity < speaker_stereo_bytes_for_mono(mono_bytes)) return false;
  for (size_t offset = 0; offset < mono_bytes; offset += 2) {
    const size_t target = offset * kSpeakerWireSlots;
    stereo[target] = mono[offset];
    stereo[target + 1] = mono[offset + 1];
    stereo[target + 2] = mono[offset];
    stereo[target + 3] = mono[offset + 1];
  }
  return true;
}

}  // namespace guest_ai::k151
