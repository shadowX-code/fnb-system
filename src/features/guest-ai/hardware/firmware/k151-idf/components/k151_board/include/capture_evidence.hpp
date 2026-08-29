#pragma once
#include <cstddef>
#include <cstdint>
#include <cmath>
#include <algorithm>
#include "k151_board.hpp"
namespace guest_ai::k151 {
inline void microphone_metrics_calculate(const int16_t* samples, size_t count, AudioLevel* out) {
  out->sample_count=count; uint64_t squares{}; int64_t sum{}; out->peak=0; out->zero_sample_count=0;
  for(size_t i=0;i<count;++i){ const int value=samples[i]; const uint32_t magnitude=std::abs(value); out->peak=std::max(out->peak,static_cast<uint16_t>(magnitude)); squares+=uint64_t(magnitude)*magnitude; sum+=value; if(value==0)++out->zero_sample_count; }
  const double rms = count ? std::sqrt(static_cast<double>(squares) / count) : 0.0;
  out->rms=static_cast<int32_t>(rms); out->rms_q8=static_cast<uint32_t>(rms * 256.0 + 0.5); out->mean=count?static_cast<int32_t>(sum/static_cast<int64_t>(count)):0;
}

// A PASS capability is earned only after a real codec-device read plus both
// persistent-lifecycle and physical I2S RX checks.  Signal amplitude is not a
// prerequisite: a quiet room can validly produce near-silent PCM.
inline bool microphone_runtime_capture_verified(const AudioLevel& level) {
  return level.sample_count > 0 && level.sample_rate_hz == 24000 &&
         level.channel_count == 2 && level.active_channel_mask == 3 &&
         level.rx_lifecycle_enabled && level.rx_channel_enabled_before_read &&
         level.rx_channel_enabled_after_read;
}
enum class CameraStep { Idle, Opened, Capabilities, Format, Enumerated, Negotiated, Requested, Queried, Mapped, Queued, Streaming, Acquired, Released };
enum class CameraOperation { None, Open, QueryCapabilities, GetFormat, EnumerateFormat, SetFormat, RequestBuffers, QueryBuffer, Mmap, InitialQbuf, StreamOn, Dequeue, Metadata, Requeue, StreamOff, Munmap, Close };
constexpr const char* camera_operation_name(CameraOperation operation) {
  switch (operation) {
    case CameraOperation::Open: return "open";
    case CameraOperation::QueryCapabilities: return "QUERYCAP";
    case CameraOperation::GetFormat: return "G_FMT";
    case CameraOperation::EnumerateFormat: return "ENUM_FMT";
    case CameraOperation::SetFormat: return "S_FMT";
    case CameraOperation::RequestBuffers: return "REQBUFS";
    case CameraOperation::QueryBuffer: return "QUERYBUF";
    case CameraOperation::Mmap: return "mmap";
    case CameraOperation::InitialQbuf: return "initial_QBUF";
    case CameraOperation::StreamOn: return "STREAMON";
    case CameraOperation::Dequeue: return "DQBUF";
    case CameraOperation::Metadata: return "metadata";
    case CameraOperation::Requeue: return "release_QBUF";
    case CameraOperation::StreamOff: return "STREAMOFF";
    case CameraOperation::Munmap: return "munmap";
    case CameraOperation::Close: return "close";
    default: return "none";
  }
}
struct CameraCaptureResult { CameraStep final_step{CameraStep::Idle}; CameraOperation failed_step{CameraOperation::None}; };
// Operations are deliberately I/O-only. This helper is the sole lifecycle and
// cleanup owner for both production V4L2 and native mock implementations.
struct CameraCaptureOps {
  void* context;
  bool (*open)(void*); bool (*querycap)(void*); bool (*format)(void*); bool (*enumerate_format)(void*); bool (*set_format)(void*); bool (*request)(void*); bool (*query)(void*); bool (*map)(void*);
  bool (*queue)(void*); bool (*stream_on)(void*); bool (*dequeue)(void*); bool (*metadata_valid)(void*);
  bool (*stream_off)(void*); bool (*unmap)(void*); bool (*close)(void*);
};
inline bool camera_capture_once(CameraCaptureOps& ops, CameraCaptureResult* result) {
  *result = {};
  CameraStep step=CameraStep::Idle;
  auto fail = [&result](CameraOperation operation) { if (result->failed_step == CameraOperation::None) result->failed_step = operation; };
  bool opened=false, mapped=false, streaming=false, ok=ops.open(ops.context);
  if (!ok) fail(CameraOperation::Open);
  opened=ok;
  if(ok){step=CameraStep::Opened; ok=ops.querycap(ops.context); if(!ok)fail(CameraOperation::QueryCapabilities);}
  if(ok){step=CameraStep::Capabilities; ok=ops.format(ops.context); if(!ok)fail(CameraOperation::GetFormat);}
  if(ok){step=CameraStep::Format; ok=ops.enumerate_format(ops.context); if(!ok)fail(CameraOperation::EnumerateFormat);}
  if(ok){step=CameraStep::Enumerated; ok=ops.set_format(ops.context); if(!ok)fail(CameraOperation::SetFormat);}
  if(ok){step=CameraStep::Negotiated; ok=ops.request(ops.context); if(!ok)fail(CameraOperation::RequestBuffers);}
  if(ok){step=CameraStep::Requested; ok=ops.query(ops.context); if(!ok)fail(CameraOperation::QueryBuffer);}
  if(ok){step=CameraStep::Queried; mapped=ops.map(ops.context); ok=mapped; if(!ok)fail(CameraOperation::Mmap);}
  if(ok){step=CameraStep::Mapped; ok=ops.queue(ops.context); if(!ok)fail(CameraOperation::InitialQbuf);}
  if(ok){step=CameraStep::Queued; streaming=ops.stream_on(ops.context); ok=streaming; if(!ok)fail(CameraOperation::StreamOn);}
  if(ok){step=CameraStep::Streaming; const bool dequeued=ops.dequeue(ops.context); ok=dequeued;
    if(!dequeued)fail(CameraOperation::Dequeue);
    if(dequeued){step=CameraStep::Acquired; const bool metadata_ok=ops.metadata_valid(ops.context); if(!metadata_ok)fail(CameraOperation::Metadata); const bool released=ops.queue(ops.context); if(!released)fail(CameraOperation::Requeue); ok=metadata_ok && released; if(released)step=CameraStep::Released;}
  }
  // Cleanup is attempted exactly once per acquired resource, even after a prior
  // failure. A failed STREAMOFF must not suppress munmap/close.
  if(streaming) { const bool cleanup_ok=ops.stream_off(ops.context); if(!cleanup_ok)fail(CameraOperation::StreamOff); ok=cleanup_ok && ok; }
  if(mapped) { const bool cleanup_ok=ops.unmap(ops.context); if(!cleanup_ok)fail(CameraOperation::Munmap); ok=cleanup_ok && ok; }
  if(opened) { const bool cleanup_ok=ops.close(ops.context); if(!cleanup_ok)fail(CameraOperation::Close); ok=cleanup_ok && ok; }
  result->final_step=step;
  return ok;
}
inline bool camera_capture_once(CameraCaptureOps& ops, CameraStep* final_step) {
  CameraCaptureResult result{};
  const bool ok = camera_capture_once(ops, &result);
  *final_step = result.final_step;
  return ok;
}
}
