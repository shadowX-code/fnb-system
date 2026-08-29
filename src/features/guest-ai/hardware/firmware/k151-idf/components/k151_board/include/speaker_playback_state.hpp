#pragma once

namespace guest_ai::k151 {

// Small, platform-independent state boundary used by the board implementation
// and native tests. It prevents a successful command result until the codec,
// TX channel and full PCM write have all completed.
struct SpeakerPlaybackState {
  bool codec_open{};
  bool tx_enabled{};
  bool pcm_fully_written{};

  [[nodiscard]] bool can_write() const { return codec_open && tx_enabled; }
  [[nodiscard]] bool succeeded() const { return can_write() && pcm_fully_written; }
};

}  // namespace guest_ai::k151
