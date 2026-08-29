#pragma once

#include <algorithm>
#include <cstdint>

#include <k151_board.hpp>

namespace guest_ai::protocol {

// Capture remains owned by the persistent microphone session.  This helper
// only observes each already-read mono PCM block and decides whether the
// bounded capture may end early.
struct EndOfSpeechConfig {
  uint32_t chunk_duration_ms{20};
  uint32_t calibration_duration_ms{240};
  uint32_t minimum_speech_duration_ms{120};
  // A short quiet interval marks a possible phrase boundary, but does not end
  // capture.  The longer final window is intentionally conservative: a guest
  // may pause briefly while deciding how to continue a sentence.
  uint32_t possible_end_silence_ms{640};
  uint32_t final_end_silence_ms{1120};
  // All thresholds use the canonical S16LE RMS Q8 scale from AudioLevel.
  // There is intentionally no fixed amplitude floor: microphone gain and
  // room noise differ substantially between deployed K151 units.
  uint32_t speech_noise_margin_percent{15};
  uint32_t minimum_speech_margin_q8{64};       // 0.25 S16LE RMS
  // Exit is intentionally based on the *maximum observed baseline*, not the
  // mean noise floor. A mean-derived release threshold can sit inside normal
  // ambient variation and continuously reset trailing-silence timing.
  uint32_t release_noise_envelope_margin_percent{15};
  uint32_t minimum_release_margin_q8{64};      // 0.25 S16LE RMS
  uint32_t onset_chunks{2};
  uint32_t silence_onset_chunks{2};
};

enum class EndOfSpeechState {
  WaitingForSpeech,
  Speaking,
  PossibleEnd,
  FinalEnd,
  AutoStop,
};

inline const char* end_of_speech_state_name(EndOfSpeechState value) {
  switch (value) {
    case EndOfSpeechState::WaitingForSpeech: return "waiting_for_speech";
    case EndOfSpeechState::Speaking: return "speaking";
    case EndOfSpeechState::PossibleEnd: return "possible_end";
    case EndOfSpeechState::FinalEnd: return "final_end";
    case EndOfSpeechState::AutoStop: return "auto_stop";
  }
  return "waiting_for_speech";
}

struct EndOfSpeechMetrics {
  uint32_t current_rms{};
  uint32_t current_peak{};
  uint32_t noise_floor_rms{};
  uint32_t speech_threshold_rms{};
  uint32_t release_threshold_rms{};
  uint32_t current_rms_q8{};
  uint32_t noise_floor_rms_q8{};
  uint32_t speech_threshold_rms_q8{};
  uint32_t release_threshold_rms_q8{};
  uint32_t first_speech_elapsed_ms{};
  uint32_t estimated_speech_end_elapsed_ms{};
  uint32_t trailing_silence_ms{};
  uint32_t longest_trailing_silence_ms{};
  uint32_t possible_end_at_ms{};
  uint32_t longest_pending_pause_ms{};
  uint32_t pending_eos_cancel_count{};
  uint32_t final_auto_stop_silence_ms{};
  uint32_t silence_candidate_blocks{};
  uint32_t silence_reset_count{};
  bool speech_detected{};
  bool post_speech_silence_entered{};
  bool possible_end_entered{};
  bool final_end_entered{};
  bool speech_resumed_during_pending{};
  bool auto_stop{};
  EndOfSpeechState state{EndOfSpeechState::WaitingForSpeech};
};

// Bounded numeric evidence for one capture. This deliberately retains no PCM
// and reports only a small top-N summary after the capture completes.
struct RmsDistribution {
  uint32_t minimum_q8{};
  uint32_t maximum_q8{};
  uint64_t sum_q8{};
  uint32_t count{};

  void observe(uint32_t rms_q8) {
    if (count == 0 || rms_q8 < minimum_q8) minimum_q8 = rms_q8;
    if (count == 0 || rms_q8 > maximum_q8) maximum_q8 = rms_q8;
    sum_q8 += rms_q8;
    ++count;
  }

  uint32_t average_q8() const { return count ? static_cast<uint32_t>(sum_q8 / count) : 0; }
};

struct EndOfSpeechCalibrationEvidence {
  RmsDistribution baseline{};
  RmsDistribution after_baseline{};
  uint32_t top_candidate_rms_q8[8]{};
  uint32_t top_candidate_count{};
  uint32_t count_above_noise{};
  uint32_t count_above_entry{};
  uint32_t maximum_delta_from_noise_q8{};
  uint32_t maximum_ratio_to_noise_q8{};
};

class EndOfSpeechDetector {
 public:
  explicit EndOfSpeechDetector(EndOfSpeechConfig config = {}) : config_(config) {}

  EndOfSpeechMetrics observe(const guest_ai::k151::AudioLevel& level, uint32_t elapsed_ms) {
    const uint32_t rms_q8 = level.rms_q8;
    metrics_.current_rms = level.rms;
    metrics_.current_peak = level.peak;
    metrics_.current_rms_q8 = rms_q8;
    if (elapsed_ms < config_.calibration_duration_ms) {
      calibration_.baseline.observe(rms_q8);
      noise_sum_q8_ += rms_q8;
      ++noise_samples_;
      metrics_.noise_floor_rms_q8 = static_cast<uint32_t>(noise_sum_q8_ / noise_samples_);
      update_display_metrics();
      return metrics_;
    }
    if (!noise_samples_) {
      metrics_.noise_floor_rms_q8 = rms_q8;
      update_display_metrics();
    }

    const uint32_t speech_threshold_q8 = enter_threshold_q8();
    const uint32_t release_threshold_q8 = exit_threshold_q8();
    metrics_.speech_threshold_rms_q8 = speech_threshold_q8;
    metrics_.release_threshold_rms_q8 = release_threshold_q8;
    update_display_metrics();
    record_after_baseline(rms_q8, speech_threshold_q8);
    if (!metrics_.speech_detected) {
      if (rms_q8 >= speech_threshold_q8) ++onset_chunks_;
      else onset_chunks_ = 0;
      if (onset_chunks_ >= config_.onset_chunks) {
        metrics_.speech_detected = true;
        metrics_.first_speech_elapsed_ms = elapsed_ms - (config_.onset_chunks - 1) * config_.chunk_duration_ms;
        metrics_.estimated_speech_end_elapsed_ms = elapsed_ms;
        metrics_.state = EndOfSpeechState::Speaking;
      }
      return metrics_;
    }

    if (rms_q8 >= release_threshold_q8) {
      if (metrics_.silence_candidate_blocks > 0) {
        ++metrics_.silence_reset_count;
        if (metrics_.possible_end_entered) {
          ++metrics_.pending_eos_cancel_count;
          metrics_.speech_resumed_during_pending = true;
        }
      }
      metrics_.estimated_speech_end_elapsed_ms = elapsed_ms;
      metrics_.trailing_silence_ms = 0;
      metrics_.silence_candidate_blocks = 0;
      metrics_.state = EndOfSpeechState::Speaking;
    } else {
      ++metrics_.silence_candidate_blocks;
      metrics_.trailing_silence_ms += config_.chunk_duration_ms;
      metrics_.longest_trailing_silence_ms = std::max(
          metrics_.longest_trailing_silence_ms, metrics_.trailing_silence_ms);
      if (metrics_.silence_candidate_blocks >= config_.silence_onset_chunks) {
        metrics_.post_speech_silence_entered = true;
      }
      if (metrics_.silence_candidate_blocks >= config_.silence_onset_chunks &&
          metrics_.trailing_silence_ms >= config_.possible_end_silence_ms) {
        if (!metrics_.possible_end_entered) metrics_.possible_end_at_ms = elapsed_ms;
        metrics_.possible_end_entered = true;
        metrics_.longest_pending_pause_ms = std::max(
            metrics_.longest_pending_pause_ms, metrics_.trailing_silence_ms);
        metrics_.state = EndOfSpeechState::PossibleEnd;
      }
      const uint32_t spoken_ms = elapsed_ms - metrics_.first_speech_elapsed_ms;
      metrics_.auto_stop = metrics_.silence_candidate_blocks >= config_.silence_onset_chunks &&
                           spoken_ms >= config_.minimum_speech_duration_ms &&
                           metrics_.trailing_silence_ms >= config_.final_end_silence_ms;
      if (metrics_.auto_stop) {
        metrics_.final_end_entered = true;
        metrics_.final_auto_stop_silence_ms = metrics_.trailing_silence_ms;
        metrics_.state = EndOfSpeechState::AutoStop;
      }
    }
    return metrics_;
  }

  const EndOfSpeechMetrics& metrics() const { return metrics_; }
  const EndOfSpeechCalibrationEvidence& calibration_evidence() const { return calibration_; }
  bool calibrated() const { return noise_samples_ > 0; }

 private:
  static uint32_t round_q8(uint32_t value) { return (value + 128) / 256; }

  static uint32_t adaptive_margin_q8(uint32_t reference_q8, uint32_t percent, uint32_t minimum) {
    return std::max(minimum, (reference_q8 * percent + 99) / 100);
  }

  uint32_t enter_threshold_q8() const {
    return metrics_.noise_floor_rms_q8 + adaptive_margin_q8(
        metrics_.noise_floor_rms_q8, config_.speech_noise_margin_percent, config_.minimum_speech_margin_q8);
  }

  uint32_t exit_threshold_q8() const {
    const uint32_t frozen_noise_envelope_q8 = calibration_.baseline.count
        ? calibration_.baseline.maximum_q8
        : metrics_.noise_floor_rms_q8;
    return frozen_noise_envelope_q8 + adaptive_margin_q8(
        frozen_noise_envelope_q8, config_.release_noise_envelope_margin_percent,
        config_.minimum_release_margin_q8);
  }

  void update_display_metrics() {
    metrics_.speech_threshold_rms_q8 = enter_threshold_q8();
    metrics_.release_threshold_rms_q8 = exit_threshold_q8();
    metrics_.noise_floor_rms = round_q8(metrics_.noise_floor_rms_q8);
    metrics_.speech_threshold_rms = round_q8(metrics_.speech_threshold_rms_q8);
    metrics_.release_threshold_rms = round_q8(metrics_.release_threshold_rms_q8);
  }

  void record_after_baseline(uint32_t rms_q8, uint32_t entry_threshold_q8) {
    calibration_.after_baseline.observe(rms_q8);
    if (rms_q8 >= metrics_.noise_floor_rms_q8) ++calibration_.count_above_noise;
    if (rms_q8 >= entry_threshold_q8) ++calibration_.count_above_entry;
    if (rms_q8 > metrics_.noise_floor_rms_q8) {
      calibration_.maximum_delta_from_noise_q8 = std::max(
          calibration_.maximum_delta_from_noise_q8, rms_q8 - metrics_.noise_floor_rms_q8);
    }
    if (metrics_.noise_floor_rms_q8) {
      const uint32_t ratio_q8 = static_cast<uint32_t>((static_cast<uint64_t>(rms_q8) * 256) /
                                                       metrics_.noise_floor_rms_q8);
      calibration_.maximum_ratio_to_noise_q8 = std::max(calibration_.maximum_ratio_to_noise_q8, ratio_q8);
    }
    const uint32_t bounded = std::min<uint32_t>(calibration_.top_candidate_count, 8);
    uint32_t insertion = bounded;
    for (uint32_t index = 0; index < bounded; ++index) {
      if (rms_q8 > calibration_.top_candidate_rms_q8[index]) { insertion = index; break; }
    }
    if (insertion == 8) return;
    const uint32_t last = bounded < 8 ? bounded : 7;
    for (uint32_t index = last; index > insertion; --index) {
      calibration_.top_candidate_rms_q8[index] = calibration_.top_candidate_rms_q8[index - 1];
    }
    calibration_.top_candidate_rms_q8[insertion] = rms_q8;
    if (calibration_.top_candidate_count < 8) ++calibration_.top_candidate_count;
  }

  EndOfSpeechConfig config_;
  EndOfSpeechMetrics metrics_{};
  uint64_t noise_sum_q8_{};
  uint32_t noise_samples_{};
  uint32_t onset_chunks_{};
  EndOfSpeechCalibrationEvidence calibration_{};
};

}  // namespace guest_ai::protocol
