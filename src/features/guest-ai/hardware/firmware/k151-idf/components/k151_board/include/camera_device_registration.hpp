#pragma once

namespace guest_ai::k151 {

// This is intentionally separate from camera_capture_once().  It only proves
// that esp_video registered the expected V4L2 node during board initialization.
struct CameraVideoNodeProbeOps {
  void* context{};
  int (*open_readwrite)(void* context, int* error){};
  bool (*close)(void* context, int fd, int* error){};
};

enum class CameraVideoNodeProbeResult { Ready, Missing, CloseFailed };

inline CameraVideoNodeProbeResult probe_camera_video_node(CameraVideoNodeProbeOps& ops, int* error) {
  int operation_error = 0;
  const int fd = ops.open_readwrite(ops.context, &operation_error);
  if (fd < 0) {
    if (error) *error = operation_error;
    return CameraVideoNodeProbeResult::Missing;
  }
  if (!ops.close(ops.context, fd, &operation_error)) {
    if (error) *error = operation_error;
    return CameraVideoNodeProbeResult::CloseFailed;
  }
  if (error) *error = 0;
  return CameraVideoNodeProbeResult::Ready;
}

}  // namespace guest_ai::k151
