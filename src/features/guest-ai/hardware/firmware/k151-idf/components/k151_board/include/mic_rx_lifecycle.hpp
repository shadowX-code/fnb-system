#pragma once

namespace guest_ai::k151 {

// Owns the bridge's logical view of the ES7210/I2S RX session.  The
// esp_codec_dev I2S backend owns the actual enable/disable calls; this state
// prevents the bridge from closing that session after every short capture.
// That matches the StackChan CoreS3AudioCodec EnableInput(true) model.
enum class MicRxState { Created, Initialized, Enabled, Parked, Error };

class MicRxLifecycle {
 public:
  void initialized() { state_ = MicRxState::Initialized; }
  [[nodiscard]] MicRxState state() const { return state_; }
  [[nodiscard]] bool needs_open() const { return state_ == MicRxState::Initialized || state_ == MicRxState::Parked; }
  [[nodiscard]] bool may_read() const { return state_ == MicRxState::Enabled; }
  [[nodiscard]] bool may_disable() const { return state_ == MicRxState::Enabled; }

  // Called only after esp_codec_dev_open and an I2S driver state query both
  // succeed. A short capture then retains this enabled session.
  void opened_with_enabled_rx() { state_ = MicRxState::Enabled; }
  void parked() { state_ = MicRxState::Parked; }
  void failed() { state_ = MicRxState::Error; }

  // For a future explicit subsystem shutdown, callers must ask this boundary
  // before touching the driver. It rejects an already-disabled channel and
  // turns a real disable failure into a non-reusable Error state.
  [[nodiscard]] bool disabled(bool driver_disable_succeeded) {
    if (!may_disable()) return false;
    state_ = driver_disable_succeeded ? MicRxState::Parked : MicRxState::Error;
    return true;
  }

  // Reconcile the logical session with a real i2s_channel_get_info() result.
  [[nodiscard]] bool confirm_enabled(bool rx_is_enabled) {
    if (state_ != MicRxState::Enabled) return true;
    if (rx_is_enabled) return true;
    failed();
    return false;
  }

  // Speaker TX open/close must leave an active RX session untouched.
  [[nodiscard]] bool speaker_transition_preserves_rx(bool rx_is_enabled) {
    return confirm_enabled(rx_is_enabled);
  }

 private:
  MicRxState state_{MicRxState::Created};
};

}  // namespace guest_ai::k151
