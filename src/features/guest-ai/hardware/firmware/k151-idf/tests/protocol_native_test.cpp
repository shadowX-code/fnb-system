#include <cassert>
#include <cstring>
#include <string>
#include <vector>

#include "feetech_scscl.hpp"
#include "json_lines_framer.hpp"
#include "motion_authority.hpp"
#include "protocol_rules.hpp"
#include "speaker_playback_state.hpp"
#include "mic_rx_lifecycle.hpp"
#include "capture_evidence.hpp"
#include "camera_device_registration.hpp"
#include "usb_rx_pump.hpp"
#include "usb_rx_scheduling.hpp"
#include "usb_tx_full_write.hpp"
#include "fault_state_machine.hpp"
#include "playback_flow_control.hpp"
#include "end_of_speech_detector.hpp"

namespace {

struct Captured {
  std::vector<std::string> frames;
  std::vector<std::string> errors;
};

void on_frame(void* context, const char* frame) {
  static_cast<Captured*>(context)->frames.emplace_back(frame);
}

void on_error(void* context, const char* error) {
  static_cast<Captured*>(context)->errors.emplace_back(error);
}

void feed(guest_ai::protocol::JsonLinesFramer& framer, const char* value) {
  framer.ingest(reinterpret_cast<const unsigned char*>(value), std::strlen(value));
}

void test_framing() {
  Captured captured;
  guest_ai::protocol::JsonLinesFramer framer(on_frame, on_error, &captured);
  feed(framer, "{\"type\":\"one\"}\n");
  feed(framer, "{\"type\":");
  feed(framer, "\"two\"}\n");
  feed(framer, "{\"type\":\"three\"}\n{\"type\":\"four\"}\n");
  feed(framer, "\r\n{\"type\":\"five\"}\r\n");
  assert(captured.frames.size() == 5);  // complete, fragmented, multi-frame, LF, CRLF, empty line

  std::string oversized(guest_ai::protocol::JsonLinesFramer::kMaxFrameSize + 1, 'x');
  feed(framer, oversized.c_str());
  feed(framer, "\n{\"type\":\"recovered\"}\n");
  assert(captured.errors.size() == 1);
  assert(captured.errors[0] == "frame_too_large");
  assert(captured.frames.back() == "{\"type\":\"recovered\"}");
  framer.reset();
}

std::string playback_frame(uint32_t sequence) {
  const std::string pcm(1368, 'A');  // 1024 bytes once Base64-decoded.
  return "{\"protocol_version\":\"1.0\",\"message_id\":\"12345678-1234-1234-1234-123456789012\",\"type\":\"audio_playback_chunk\",\"device_id\":\"k151-idf-pending\",\"sent_at\":\"2026-08-23T13:43:19.000Z\",\"payload\":{\"turn_id\":\"12345678-1234-1234-1234-123456789012\",\"sequence\":" + std::to_string(sequence) + ",\"byte_count\":1024,\"encoding\":\"base64\",\"pcm\":\"" + pcm + "\"}}\n";
}

void test_large_playback_framing() {
  Captured captured;
  guest_ai::protocol::JsonLinesFramer framer(on_frame, on_error, &captured);
  const std::string frame0 = playback_frame(0);
  assert(frame0.size() - 1 < guest_ai::protocol::JsonLinesFramer::kMaxFrameSize);
  std::string worst_case = playback_frame(599);
  const std::string id39(39, 't');
  const std::string id36 = "12345678-1234-1234-1234-123456789012";
  const size_t turn_position = worst_case.find(id36, worst_case.find(id36) + id36.size());
  worst_case.replace(turn_position, id36.size(), id39);
  assert(worst_case.size() - 1 < guest_ai::protocol::JsonLinesFramer::kMaxFrameSize);

  // One real-sized frame fragmented on USB packet/read boundaries, including
  // a final LF in its own read.
  const size_t cuts[] = {64, 128, 256, 511, frame0.size() - 1};
  size_t offset = 0;
  for (const size_t end : cuts) {
    framer.ingest(reinterpret_cast<const unsigned char*>(frame0.data() + offset), end - offset);
    offset = end;
  }
  framer.ingest(reinterpret_cast<const unsigned char*>(frame0.data() + offset), frame0.size() - offset);
  assert(captured.frames.size() == 1 && captured.frames[0] == frame0.substr(0, frame0.size() - 1));
  const auto& first = framer.diagnostics();
  assert(first.last_frame_length == frame0.size() - 1 && first.last_begins_object && first.last_ends_object);

  // Three production-sized frames may arrive in a single driver burst.
  const std::string burst = playback_frame(1) + playback_frame(2) + playback_frame(3);
  for (size_t index = 0; index < burst.size(); index += 128) {
    const size_t count = (burst.size() - index) < 128 ? burst.size() - index : 128;
    framer.ingest(reinterpret_cast<const unsigned char*>(burst.data() + index), count);
  }
  assert(captured.frames.size() == 4 && captured.errors.empty());

  // A syntactically bad body is still one bounded frame; the dispatcher owns
  // JSON parse failure and the next large canonical frame remains intact.
  feed(framer, "{bad-json}\n");
  const std::string recovered = playback_frame(4);
  framer.ingest(reinterpret_cast<const unsigned char*>(recovered.data()), recovered.size());
  assert(captured.frames.back() == recovered.substr(0, recovered.size() - 1));

  for (uint32_t index = 5; index < 105; ++index) {
    const std::string frame = playback_frame(index);
    framer.ingest(reinterpret_cast<const unsigned char*>(frame.data()), frame.size());
  }
  assert(captured.errors.empty());
  assert(captured.frames.size() == 106);
}

void test_dispatch_rules() {
  using guest_ai::protocol::rules::is_capability;
  using guest_ai::protocol::rules::is_expression;
  using guest_ai::protocol::rules::is_robot_state;
  using guest_ai::protocol::rules::is_safe_gaze;
  assert(is_expression("happy"));
  assert(!is_expression("surprise"));
  assert(is_robot_state("OFFLINE"));
  assert(is_robot_state("SPEAKING"));
  assert(!is_robot_state("DANCING"));
  assert(is_capability("camera"));
  assert(is_capability("usb_transport"));
  assert(!is_capability("vision"));
  assert(is_safe_gaze(-90, 5));
  assert(is_safe_gaze(90, 85));
  assert(!is_safe_gaze(-91, 45));
  assert(!is_safe_gaze(0, 86));
}

void test_servo_protocol() {
  using namespace guest_ai::k151::feetech;
  uint8_t yaw[13]{};
  const size_t yaw_size = encode_position_packet(kYawId, yaw_position(0), 20, 0, yaw);
  assert(yaw_size == 13);
  assert(yaw[0] == 0xff && yaw[1] == 0xff && yaw[2] == kYawId);
  assert(yaw[6] == static_cast<uint8_t>(yaw_position(0) >> 8));
  assert(yaw[7] == static_cast<uint8_t>(yaw_position(0)));
  uint8_t packet_checksum = 0;
  for (size_t index = 2; index < 12; ++index) packet_checksum += yaw[index];
  assert(yaw[12] == static_cast<uint8_t>(~packet_checksum));

  uint8_t pitch[13]{};
  encode_position_packet(kPitchId, pitch_position(450), 20, 0, pitch);
  assert(pitch[2] == kPitchId);
  assert(yaw_position(-1280) <= yaw_position(1280));
  assert(pitch_position(50) <= pitch_position(850));
  assert(!is_safe_gaze(-1281, 450));
  assert(!is_safe_gaze(0, 851));

  uint8_t ping[6]{};
  assert(encode_ping_packet(kYawId, ping) == 6);
  assert(ping[0] == 0xff && ping[1] == 0xff && ping[2] == kYawId && ping[3] == 2 && ping[4] == kInstructionPing);
  assert(ping[5] == checksum(ping, 2, 5));
  uint8_t status_packet[] = {0xff, 0xff, kYawId, 2, 0, 0};
  status_packet[5] = checksum(status_packet, 2, 5);
  uint8_t status = 0xff;
  assert(validate_status_packet(status_packet, sizeof(status_packet), kYawId, &status));
  assert(status == 0);
  status_packet[5] ^= 0x01;
  assert(!validate_status_packet(status_packet, sizeof(status_packet), kYawId));

  uint8_t read_packet[8]{};
  assert(encode_read_packet(kPitchId, kPresentPositionRegister, 2, read_packet) == 8);
  assert(read_packet[2] == kPitchId && read_packet[4] == kInstructionRead && read_packet[5] == kPresentPositionRegister);
  uint8_t read_response[] = {0xff, 0xff, kPitchId, 4, 0, 0x02, 0x6c, 0};
  read_response[7] = checksum(read_response, 2, 7);
  assert(validate_read_packet(read_response, sizeof(read_response), kPitchId, 2, &status));
  assert(status == 0);
}

void test_motion_authority() {
  using guest_ai::protocol::MotionSource;
  using guest_ai::protocol::may_send_servo_packet;
  // BOOTING timeout and logical IDLE transitions must never emit FEETECH packets.
  assert(!may_send_servo_packet(MotionSource::StartupTransition));
  assert(!may_send_servo_packet(MotionSource::RobotStateTransition));
  assert(may_send_servo_packet(MotionSource::SetGaze));
}

void test_speaker_playback_gate() {
  using guest_ai::k151::SpeakerPlaybackState;
  SpeakerPlaybackState state;
  assert(!state.can_write());
  assert(!state.succeeded());
  state.codec_open = true;
  assert(!state.can_write());
  state.tx_enabled = true;
  assert(state.can_write());
  assert(!state.succeeded());
  state.pcm_fully_written = true;
  assert(state.succeeded());
  // A failed/open-disabled channel must never be treated as a valid write.
  state.tx_enabled = false;
  assert(!state.succeeded());
}

void test_mic_rx_lifecycle() {
  using guest_ai::k151::MicRxLifecycle;
  using guest_ai::k151::MicRxState;

  MicRxLifecycle mic;
  assert(mic.state() == MicRxState::Created && !mic.may_disable());
  mic.initialized();
  assert(mic.needs_open() && !mic.may_read() && !mic.may_disable());

  // First capture opens once. Ten sequential captures share that enabled
  // session, so there is no per-capture disable or double-disable path.
  mic.opened_with_enabled_rx();
  assert(mic.may_read() && mic.may_disable() && !mic.needs_open());
  for (int capture = 0; capture < 10; ++capture) {
    assert(mic.may_read() && mic.confirm_enabled(true));
  }
  assert(mic.speaker_transition_preserves_rx(true));
  assert(mic.state() == MicRxState::Enabled);

  // Explicit shutdown is legal only from enabled; a later first capture may
  // reopen from the parked state. An already-disabled session cannot run a
  // second disable.
  assert(mic.disabled(true));
  assert(mic.needs_open() && !mic.may_disable() && !mic.disabled(true));
  mic.opened_with_enabled_rx();
  assert(mic.may_read());

  // Read failure does not run cleanup or invalidate an otherwise-enabled RX
  // channel; the next capture remains possible. An explicit cleanup failure,
  // or a speaker transition which actually loses RX, moves to Error instead
  // of permitting a retrying double-disable.
  assert(mic.may_read());
  assert(mic.disabled(false));
  assert(mic.state() == MicRxState::Error && !mic.may_disable());
  mic.initialized();
  mic.opened_with_enabled_rx();
  assert(!mic.speaker_transition_preserves_rx(false));
  assert(mic.state() == MicRxState::Error && !mic.may_read() && !mic.may_disable());
}

enum class CameraMockFailure { None, Open, QueryCap, UnsupportedCapabilities, Format, EnumerateFormat, SetFormat, Request, Query, Map, InitialQueue, StreamOn, Dequeue, Metadata, ReleaseQueue, StreamOff, Unmap, Close };
struct CameraMock {
  CameraMockFailure failure{CameraMockFailure::None};
  int open{}, querycap{}, format{}, enumerate_format{}, set_format{}, request{}, query{}, map{}, queue{}, stream_on{}, dequeue{}, metadata{}, stream_off{}, unmap{}, close{};
  uint32_t requested_format{}, negotiated_format{};
  uint16_t requested_width{}, requested_height{}, negotiated_width{}, negotiated_height{};
  uint32_t bytes_used{1234}, sequence{7}, timestamp_us{45678};
};
bool mock_open(void* p) { auto& m=*static_cast<CameraMock*>(p); ++m.open; return m.failure!=CameraMockFailure::Open; }
bool mock_querycap(void* p) { auto& m=*static_cast<CameraMock*>(p); ++m.querycap; return m.failure!=CameraMockFailure::QueryCap && m.failure!=CameraMockFailure::UnsupportedCapabilities; }
bool mock_format(void* p) { auto& m=*static_cast<CameraMock*>(p); ++m.format; return m.failure!=CameraMockFailure::Format; }
bool mock_enumerate_format(void* p) { auto& m=*static_cast<CameraMock*>(p); ++m.enumerate_format; return m.failure!=CameraMockFailure::EnumerateFormat; }
bool mock_set_format(void* p) { auto& m=*static_cast<CameraMock*>(p); ++m.set_format; m.requested_width=320; m.requested_height=240; m.requested_format=0x50323234; m.negotiated_width=320; m.negotiated_height=240; m.negotiated_format=0x56595559; return m.failure!=CameraMockFailure::SetFormat; }
bool mock_request(void* p) { auto& m=*static_cast<CameraMock*>(p); ++m.request; return m.failure!=CameraMockFailure::Request; }
bool mock_query(void* p) { auto& m=*static_cast<CameraMock*>(p); ++m.query; return m.failure!=CameraMockFailure::Query; }
bool mock_map(void* p) { auto& m=*static_cast<CameraMock*>(p); ++m.map; return m.failure!=CameraMockFailure::Map; }
bool mock_queue(void* p) { auto& m=*static_cast<CameraMock*>(p); ++m.queue; return m.failure != (m.queue==1 ? CameraMockFailure::InitialQueue : CameraMockFailure::ReleaseQueue); }
bool mock_stream_on(void* p) { auto& m=*static_cast<CameraMock*>(p); ++m.stream_on; return m.failure!=CameraMockFailure::StreamOn; }
bool mock_dequeue(void* p) { auto& m=*static_cast<CameraMock*>(p); ++m.dequeue; return m.failure!=CameraMockFailure::Dequeue; }
bool mock_metadata(void* p) { auto& m=*static_cast<CameraMock*>(p); ++m.metadata; return m.failure!=CameraMockFailure::Metadata && m.bytes_used>0 && m.sequence==7 && m.timestamp_us==45678; }
bool mock_stream_off(void* p) { auto& m=*static_cast<CameraMock*>(p); ++m.stream_off; return m.failure!=CameraMockFailure::StreamOff; }
bool mock_unmap(void* p) { auto& m=*static_cast<CameraMock*>(p); ++m.unmap; return m.failure!=CameraMockFailure::Unmap; }
bool mock_close(void* p) { auto& m=*static_cast<CameraMock*>(p); ++m.close; return m.failure!=CameraMockFailure::Close; }

guest_ai::k151::CameraCaptureOps mock_camera_ops(CameraMock* mock) {
  return {mock,mock_open,mock_querycap,mock_format,mock_enumerate_format,mock_set_format,mock_request,mock_query,mock_map,mock_queue,mock_stream_on,mock_dequeue,mock_metadata,mock_stream_off,mock_unmap,mock_close};
}

void test_capture_evidence() {
  guest_ai::k151::AudioLevel level{}; const int16_t silence[]={0,0,0,0}; guest_ai::k151::microphone_metrics_calculate(silence,4,&level); assert(level.rms==0&&level.peak==0&&level.mean==0&&level.zero_sample_count==4);
  const int16_t pcm[]={-4,0,4,8}; guest_ai::k151::microphone_metrics_calculate(pcm,4,&level); assert(level.peak==8&&level.mean==2&&level.zero_sample_count==1&&level.rms>0&&level.rms_q8>static_cast<uint32_t>(level.rms)*256U);
  level.sample_count=960; level.sample_rate_hz=24000; level.channel_count=2; level.active_channel_mask=3; level.rx_lifecycle_enabled=true; level.rx_channel_enabled_before_read=true; level.rx_channel_enabled_after_read=true;
  assert(guest_ai::k151::microphone_runtime_capture_verified(level));
  level.rx_channel_enabled_after_read=false;
  assert(!guest_ai::k151::microphone_runtime_capture_verified(level));
  CameraMock success; auto ops=mock_camera_ops(&success); guest_ai::k151::CameraCaptureResult result{};
  assert(guest_ai::k151::camera_capture_once(ops,&result)); assert(result.final_step==guest_ai::k151::CameraStep::Released); assert(result.failed_step==guest_ai::k151::CameraOperation::None);
  assert(success.querycap==1 && success.enumerate_format==1 && success.set_format==1);
  assert(success.requested_width==320 && success.requested_height==240 && success.requested_format==0x50323234);
  assert(success.negotiated_width==320 && success.negotiated_height==240 && success.negotiated_format==0x56595559);
  assert(success.queue==2 && success.stream_off==1 && success.unmap==1 && success.close==1);
  // A fresh invocation has no residual lifecycle state and repeats each owned cleanup once.
  assert(guest_ai::k151::camera_capture_once(ops,&result)); assert(success.queue==4 && success.stream_off==2 && success.unmap==2 && success.close==2);

  const CameraMockFailure failures[] = {CameraMockFailure::Open,CameraMockFailure::QueryCap,CameraMockFailure::UnsupportedCapabilities,CameraMockFailure::Format,CameraMockFailure::EnumerateFormat,CameraMockFailure::SetFormat,CameraMockFailure::Request,CameraMockFailure::Query,CameraMockFailure::Map,CameraMockFailure::InitialQueue,CameraMockFailure::StreamOn,CameraMockFailure::Dequeue,CameraMockFailure::Metadata,CameraMockFailure::ReleaseQueue,CameraMockFailure::StreamOff,CameraMockFailure::Unmap,CameraMockFailure::Close};
  const guest_ai::k151::CameraOperation expected_steps[] = {guest_ai::k151::CameraOperation::Open,guest_ai::k151::CameraOperation::QueryCapabilities,guest_ai::k151::CameraOperation::QueryCapabilities,guest_ai::k151::CameraOperation::GetFormat,guest_ai::k151::CameraOperation::EnumerateFormat,guest_ai::k151::CameraOperation::SetFormat,guest_ai::k151::CameraOperation::RequestBuffers,guest_ai::k151::CameraOperation::QueryBuffer,guest_ai::k151::CameraOperation::Mmap,guest_ai::k151::CameraOperation::InitialQbuf,guest_ai::k151::CameraOperation::StreamOn,guest_ai::k151::CameraOperation::Dequeue,guest_ai::k151::CameraOperation::Metadata,guest_ai::k151::CameraOperation::Requeue,guest_ai::k151::CameraOperation::StreamOff,guest_ai::k151::CameraOperation::Munmap,guest_ai::k151::CameraOperation::Close};
  size_t failure_index = 0;
  for (const auto failure : failures) {
    CameraMock mock{failure}; auto failing_ops=mock_camera_ops(&mock); result={};
    assert(!guest_ai::k151::camera_capture_once(failing_ops,&result));
    assert(result.failed_step == expected_steps[failure_index++]);
    assert(mock.close <= 1 && mock.unmap <= 1 && mock.stream_off <= 1);  // no double cleanup
    if (failure==CameraMockFailure::Open) { assert(mock.close==0 && mock.unmap==0 && mock.stream_off==0); }
    else { assert(mock.close==1); }
    if (failure==CameraMockFailure::Map) { assert(mock.unmap==0); }
    if (failure==CameraMockFailure::InitialQueue || failure==CameraMockFailure::StreamOn) { assert(mock.queue==1); }
    if (failure==CameraMockFailure::Dequeue) { assert(mock.queue==1 && mock.stream_off==1); }
    if (failure==CameraMockFailure::Metadata || failure==CameraMockFailure::ReleaseQueue) { assert(mock.queue==2 && mock.stream_off==1); }
    if (failure==CameraMockFailure::StreamOff) { assert(mock.unmap==1 && mock.close==1); }
  }
}

void test_camera_video_node_registration() {
  struct NodeMock { int opened{}; int closed{}; int open_result{4}; bool close_result{true}; int error{}; };
  auto open=[](void* context, int* error) { auto& mock=*static_cast<NodeMock*>(context); ++mock.opened; if (error) *error=mock.error; return mock.open_result; };
  auto close=[](void* context, int, int* error) { auto& mock=*static_cast<NodeMock*>(context); ++mock.closed; if (error) *error=mock.error; return mock.close_result; };
  NodeMock present{}; guest_ai::k151::CameraVideoNodeProbeOps ops{&present,open,close}; int error{};
  assert(guest_ai::k151::probe_camera_video_node(ops,&error) == guest_ai::k151::CameraVideoNodeProbeResult::Ready);
  assert(present.opened==1 && present.closed==1 && error==0);
  NodeMock missing{}; missing.open_result=-1; missing.error=2; ops.context=&missing; error=0;
  assert(guest_ai::k151::probe_camera_video_node(ops,&error) == guest_ai::k151::CameraVideoNodeProbeResult::Missing);
  assert(missing.opened==1 && missing.closed==0 && error==2);
  NodeMock close_failure{}; close_failure.close_result=false; close_failure.error=5; ops.context=&close_failure; error=0;
  assert(guest_ai::k151::probe_camera_video_node(ops,&error) == guest_ai::k151::CameraVideoNodeProbeResult::CloseFailed);
  assert(close_failure.opened==1 && close_failure.closed==1 && error==5);
}

void test_usb_rx_pump() {
  struct Mock {
    std::vector<int> reads;
    size_t next{};
    std::string received;
    int resets{};
  } mock{{0, 3, 2, -7, 0}, 0, "", 0};
  auto read=[](void* p, uint8_t* buffer, size_t) {
    auto& mock=*static_cast<Mock*>(p); const int result=mock.reads[mock.next++];
    if (result == 3) { buffer[0]='{'; buffer[1]='}'; buffer[2]='\n'; }
    if (result == 2) { buffer[0]='x'; buffer[1]='\n'; }
    return result;
  };
  auto ingest=[](void* p, const uint8_t* bytes, size_t count) { static_cast<Mock*>(p)->received.append(reinterpret_cast<const char*>(bytes), count); };
  auto reset=[](void* p) { ++static_cast<Mock*>(p)->resets; };
  guest_ai::protocol::UsbRxOps ops{&mock,read,ingest,reset};
  guest_ai::protocol::UsbRxPump pump;
  uint8_t buffer[8]{};
  assert(!pump.poll(ops, false, buffer, sizeof(buffer)));  // disconnected: no read
  assert(!pump.poll(ops, true, buffer, sizeof(buffer)));   // reconnect + zero-byte read
  assert(pump.poll(ops, true, buffer, sizeof(buffer)));    // partial first fragment
  assert(pump.poll(ops, true, buffer, sizeof(buffer)));    // second fragment
  assert(!pump.poll(ops, true, buffer, sizeof(buffer)));   // read error
  assert(!pump.poll(ops, false, buffer, sizeof(buffer)));  // disconnect resets framing
  const auto& diagnostics=pump.diagnostics();
  assert(mock.resets==2 && mock.received=="{}\nx\n");
  assert(diagnostics.reconnects==1 && diagnostics.disconnects==1 && diagnostics.read_calls==4);
  assert(diagnostics.zero_byte_reads==1 && diagnostics.read_errors==1 && diagnostics.bytes_received==5 && diagnostics.newline_count==2);
}

void test_usb_rx_scheduling() {
  using guest_ai::protocol::UsbRxScheduling;
  // The read wait bounds idle latency, while the explicit post-poll delay
  // guarantees a true scheduler yield even if reads return immediately.
  assert(UsbRxScheduling::kReadTimeoutMs == 10);
  assert(UsbRxScheduling::kPostPollDelayMs == 10);
  assert(UsbRxScheduling::kMaxBurstReads == 8);
  assert(UsbRxScheduling::kMaximumIdlePollsPerSecond == 100);
  assert(1000 / UsbRxScheduling::kReadTimeoutMs <= UsbRxScheduling::kMaximumIdlePollsPerSecond);
}

void test_usb_tx_full_write() {
  struct Mock { std::vector<int> returns; size_t next{}; uint64_t now{}; uint32_t waits{}; std::string data; explicit Mock(std::vector<int> values) : returns(std::move(values)) {} };
  auto write=[](void* p, const char* data, size_t count, uint32_t) { auto& m=*static_cast<Mock*>(p); const int value=m.returns[m.next++]; assert(value <= static_cast<int>(count)); if(value>0)m.data.append(data, static_cast<size_t>(value)); return value; };
  auto now=[](void* p) { return static_cast<Mock*>(p)->now; };
  auto wait=[](void* p) { auto& m=*static_cast<Mock*>(p); ++m.waits; m.now+=1000; };
  Mock one({5}); guest_ai::protocol::UsbTxWriteOps ops{&one,write,now,wait}; guest_ai::protocol::UsbTxWriteResult result{};
  assert(guest_ai::protocol::usb_tx_write_full(ops,"hello",5,&result)); assert(result.written==5&&result.calls==1&&one.data=="hello");
  Mock partial({2,2,1}); ops.context=&partial; assert(guest_ai::protocol::usb_tx_write_full(ops,"hello",5,&result)); assert(result.written==5&&result.calls==3&&partial.data=="hello");
  Mock recover({0,0,5}); ops.context=&recover; assert(guest_ai::protocol::usb_tx_write_full(ops,"hello",5,&result)); assert(recover.waits==2&&result.calls==3);
  Mock failure({-1}); ops.context=&failure; assert(!guest_ai::protocol::usb_tx_write_full(ops,"hello",5,&result)); assert(result.permanent_error&&result.written==0);
  Mock timeout({0,0,0}); ops.context=&timeout; assert(!guest_ai::protocol::usb_tx_write_full(ops,"hello",5,&result,20,2)); assert(result.timed_out&&timeout.waits==2);
  Mock newline({1}); ops.context=&newline; assert(guest_ai::protocol::usb_tx_write_full(ops,"\n",1,&result)); assert(result.intended==1&&result.written==1);
}

void test_playback_flow_control() {
  using guest_ai::protocol::PlaybackFlowControl;
  PlaybackFlowControl flow;
  flow.start(5 * 1024);
  for (uint32_t sequence = 0; sequence < 5; ++sequence) {
    assert(flow.validate(sequence, 1024) == PlaybackFlowControl::ChunkDecision::Accepted);
    flow.accepted(1024);
  }
  assert(flow.all_accepted());
  assert(flow.validate(5, 2) == PlaybackFlowControl::ChunkDecision::ByteCountInvalid);
  assert(flow.validate(6, 1) == PlaybackFlowControl::ChunkDecision::SequenceMismatch);
  for (int index = 0; index < 5; ++index) flow.played(1024);
  assert(flow.drained());
  flow.reset();
  assert(flow.total_bytes() == 0 && flow.accepted_bytes() == 0 && flow.expected_sequence() == 0);
}

void test_end_of_speech_detector() {
  using guest_ai::protocol::EndOfSpeechConfig;
  using guest_ai::protocol::EndOfSpeechDetector;
  using guest_ai::k151::AudioLevel;
  EndOfSpeechConfig config{};
  config.calibration_duration_ms = 100;
  config.chunk_duration_ms = 20;
  config.minimum_speech_margin_q8 = 64;
  config.speech_noise_margin_percent = 15;
  config.minimum_release_margin_q8 = 16;
  config.release_noise_envelope_margin_percent = 15;
  config.onset_chunks = 2;
  config.minimum_speech_duration_ms = 100;
  config.possible_end_silence_ms = 40;
  config.final_end_silence_ms = 80;
  EndOfSpeechDetector detector(config);
  const auto level = [](uint32_t rms_q8) { AudioLevel value{}; value.rms_q8 = rms_q8; value.rms = static_cast<int32_t>(rms_q8 / 256); return value; };
  // Opening silence learns a floor but never auto-stops.
  for (uint32_t ms = 0; ms < 100; ms += 20) assert(!detector.observe(level(20 * 256), ms).auto_stop);
  assert(!detector.observe(level(20 * 256), 120).speech_detected);
  // Two speech chunks start speech; a 20 ms pause cannot end it.
  assert(!detector.observe(level(700 * 256), 140).speech_detected);
  assert(detector.observe(level(700 * 256), 160).speech_detected);
  assert(!detector.observe(level(20 * 256), 180).auto_stop);
  assert(!detector.observe(level(700 * 256), 200).auto_stop);
  // Only sustained post-speech silence ends a real utterance.
  assert(!detector.observe(level(20 * 256), 220).auto_stop);
  assert(!detector.observe(level(20 * 256), 240).auto_stop);
  assert(!detector.observe(level(20 * 256), 260).auto_stop);
  const auto final = detector.observe(level(20 * 256), 280);
  assert(final.auto_stop && final.trailing_silence_ms == 80 && final.estimated_speech_end_elapsed_ms == 200);
  assert(final.post_speech_silence_entered);
  assert(final.state == guest_ai::protocol::EndOfSpeechState::AutoStop);
}

void test_end_of_speech_low_signal_calibration() {
  using guest_ai::protocol::EndOfSpeechConfig;
  using guest_ai::protocol::EndOfSpeechDetector;
  using guest_ai::k151::AudioLevel;
  EndOfSpeechConfig config{};
  config.calibration_duration_ms = 240;
  config.chunk_duration_ms = 20;
  config.minimum_speech_margin_q8 = 64;
  config.speech_noise_margin_percent = 15;
  config.minimum_release_margin_q8 = 16;
  config.release_noise_envelope_margin_percent = 15;
  config.onset_chunks = 2;
  const auto level = [](uint32_t rms_q8, uint16_t peak) { AudioLevel value{}; value.rms_q8 = rms_q8; value.rms = static_cast<int32_t>(rms_q8 / 256); value.peak = peak; return value; };
  EndOfSpeechDetector detector(config);
  for (uint32_t ms = 0; ms < 240; ms += 20) detector.observe(level(5 * 256, 12), ms);
  // A low-amplitude utterance is separated from the learned floor using Q8
  // precision rather than a fixed 16-bit-amplitude threshold.
  assert(!detector.observe(level(6 * 256, 24), 240).speech_detected);
  const auto spoken = detector.observe(level(6 * 256, 24), 260);
  assert(spoken.speech_detected && spoken.speech_threshold_rms_q8 == 5 * 256 + 192);
  assert(!detector.observe(level(5 * 256, 12), 280).auto_stop);
}

void test_end_of_speech_release_noise_envelope() {
  using guest_ai::protocol::EndOfSpeechConfig;
  using guest_ai::protocol::EndOfSpeechDetector;
  using guest_ai::protocol::EndOfSpeechState;
  using guest_ai::k151::AudioLevel;
  EndOfSpeechConfig config{};
  config.calibration_duration_ms = 80;
  config.chunk_duration_ms = 20;
  config.minimum_speech_duration_ms = 80;
  config.possible_end_silence_ms = 40;
  config.final_end_silence_ms = 80;
  config.onset_chunks = 2;
  config.silence_onset_chunks = 2;
  config.minimum_speech_margin_q8 = 64;
  config.minimum_release_margin_q8 = 64;
  config.release_noise_envelope_margin_percent = 15;
  const auto level = [](uint32_t rms_q8) {
    AudioLevel value{};
    value.rms_q8 = rms_q8;
    value.rms = static_cast<int32_t>(rms_q8 / 256);
    return value;
  };

  EndOfSpeechDetector detector(config);
  // The frozen baseline envelope peaks at 700 Q8. Its release boundary must
  // be above that ambient envelope, not near the lower baseline average.
  detector.observe(level(400), 0);
  detector.observe(level(500), 20);
  detector.observe(level(600), 40);
  detector.observe(level(700), 60);
  detector.observe(level(2200), 80);
  const auto speaking = detector.observe(level(2200), 100);
  assert(speaking.speech_detected);
  assert(speaking.release_threshold_rms_q8 > 700);

  // Ambient jitter under the frozen release boundary starts trailing silence.
  const auto first_silence = detector.observe(level(760), 120);
  assert(first_silence.trailing_silence_ms == 20);
  assert(!first_silence.post_speech_silence_entered);

  // A genuine resumed speech block clears pending silence; a 300–500 ms pause
  // cannot complete the 720 ms production trailing-silence requirement.
  const auto resumed = detector.observe(level(2200), 140);
  assert(resumed.state == EndOfSpeechState::Speaking);
  assert(resumed.silence_reset_count == 1);
  assert(resumed.trailing_silence_ms == 0);

  detector.observe(level(760), 160);
  detector.observe(level(780), 180);
  detector.observe(level(750), 200);
  const auto complete = detector.observe(level(770), 220);
  assert(complete.post_speech_silence_entered);
  assert(complete.auto_stop);
  assert(complete.state == EndOfSpeechState::AutoStop);
  assert(complete.longest_trailing_silence_ms == 80);
}

void test_end_of_speech_two_stage_natural_pause_protection() {
  using guest_ai::protocol::EndOfSpeechConfig;
  using guest_ai::protocol::EndOfSpeechDetector;
  using guest_ai::protocol::EndOfSpeechState;
  using guest_ai::k151::AudioLevel;
  EndOfSpeechConfig config{};
  config.calibration_duration_ms = 80;
  config.chunk_duration_ms = 20;
  config.minimum_speech_duration_ms = 80;
  config.onset_chunks = 2;
  config.silence_onset_chunks = 2;
  config.possible_end_silence_ms = 640;
  config.final_end_silence_ms = 1120;
  config.minimum_speech_margin_q8 = 64;
  config.minimum_release_margin_q8 = 64;
  const auto level = [](uint32_t rms_q8) {
    AudioLevel value{};
    value.rms_q8 = rms_q8;
    value.rms = static_cast<int32_t>(rms_q8 / 256);
    return value;
  };
  const auto make_speaking_detector = [&]() {
    EndOfSpeechDetector detector(config);
    for (uint32_t ms = 0; ms < 80; ms += 20) detector.observe(level(400), ms);
    detector.observe(level(2200), 80);
    assert(detector.observe(level(2200), 100).speech_detected);
    return detector;
  };
  for (const uint32_t pause_ms : {300u, 500u, 700u, 900u}) {
    auto detector = make_speaking_detector();
    uint32_t elapsed_ms = 120;
    for (; elapsed_ms < 120 + pause_ms; elapsed_ms += 20) {
      assert(!detector.observe(level(450), elapsed_ms).auto_stop);
    }
    const auto resumed = detector.observe(level(2200), elapsed_ms);
    assert(!resumed.auto_stop);
    assert(resumed.state == EndOfSpeechState::Speaking);
    if (pause_ms >= config.possible_end_silence_ms) {
      assert(resumed.possible_end_entered);
      assert(resumed.speech_resumed_during_pending);
      assert(resumed.pending_eos_cancel_count == 1);
    }
  }

  auto detector = make_speaking_detector();
  EndOfSpeechState last_state = EndOfSpeechState::Speaking;
  for (uint32_t elapsed_ms = 120; elapsed_ms <= 1220; elapsed_ms += 20) {
    const auto metrics = detector.observe(level(450), elapsed_ms);
    last_state = metrics.state;
    if (elapsed_ms < 1220) assert(!metrics.auto_stop);
    else {
      assert(metrics.auto_stop);
      assert(metrics.final_end_entered);
      assert(metrics.final_auto_stop_silence_ms == 1120);
    }
  }
  assert(last_state == EndOfSpeechState::AutoStop);

  // Opening silence never becomes EOS; the transport safety cap owns that
  // path, not the detector.
  EndOfSpeechDetector no_speech(config);
  for (uint32_t elapsed_ms = 0; elapsed_ms < 6000; elapsed_ms += 20) {
    assert(!no_speech.observe(level(400), elapsed_ms).auto_stop);
  }
}

void test_end_of_speech_calibration_evidence() {
  using guest_ai::protocol::EndOfSpeechConfig;
  using guest_ai::protocol::EndOfSpeechDetector;
  using guest_ai::k151::AudioLevel;
  EndOfSpeechConfig config{};
  config.calibration_duration_ms = 80;
  config.chunk_duration_ms = 20;
  config.minimum_speech_margin_q8 = 64;
  config.speech_noise_margin_percent = 15;
  config.onset_chunks = 2;
  const auto level = [](uint32_t rms_q8) {
    AudioLevel value{};
    value.rms_q8 = rms_q8;
    value.rms = static_cast<int32_t>(rms_q8 / 256);
    return value;
  };

  EndOfSpeechDetector detector(config);
  // A bounded baseline retains its distribution, including an early speech
  // transient, rather than silently treating it as a later noise update.
  detector.observe(level(20 * 256), 0);
  detector.observe(level(22 * 256), 20);
  detector.observe(level(24 * 256), 40);
  detector.observe(level(80 * 256), 60);
  detector.observe(level(100 * 256), 80);
  detector.observe(level(90 * 256), 100);
  detector.observe(level(30 * 256), 120);

  const auto& evidence = detector.calibration_evidence();
  assert(evidence.baseline.count == 4);
  assert(evidence.baseline.minimum_q8 == 20 * 256);
  assert(evidence.baseline.maximum_q8 == 80 * 256);
  assert(evidence.after_baseline.count == 3);
  assert(evidence.after_baseline.minimum_q8 == 30 * 256);
  assert(evidence.after_baseline.maximum_q8 == 100 * 256);
  assert(evidence.count_above_noise == 2);
  assert(evidence.count_above_entry == 2);
  assert(evidence.maximum_delta_from_noise_q8 == (100 * 256) - (146 * 256) / 4);
  assert(evidence.maximum_ratio_to_noise_q8 == (100 * 256 * 256) / ((146 * 256) / 4));
  assert(evidence.top_candidate_count == 3);
  assert(evidence.top_candidate_rms_q8[0] == 100 * 256);
  assert(evidence.top_candidate_rms_q8[1] == 90 * 256);
  assert(evidence.top_candidate_rms_q8[2] == 30 * 256);

  // The noise floor is fixed after the opening calibration window, so loud
  // speech cannot make the threshold chase the utterance upward.
  assert(detector.metrics().noise_floor_rms_q8 == (146 * 256) / 4);
}

void test_fault_state_machine() { using namespace guest_ai::fault; StateMachine state; assert(state.value.type==Type::None&&state.value.phase==Phase::Idle); assert(state.arm(Type::CameraDqbufTimeoutOnce)); assert(!state.arm(Type::UsbTxZeroProgressOnce)); assert(!state.consume(Type::UsbTxPartialOnce)); assert(state.consume(Type::CameraDqbufTimeoutOnce)); assert(state.value.phase==Phase::AutoCleared&&state.value.type==Type::None); assert(state.arm(Type::UsbTxZeroProgressOnce)); assert(state.consume(Type::UsbTxZeroProgressOnce)); assert(state.arm(Type::UsbTxPartialOnce)); }

}  // namespace

int main() {
  test_framing();
  test_large_playback_framing();
  test_dispatch_rules();
  test_servo_protocol();
  test_motion_authority();
  test_speaker_playback_gate();
  test_mic_rx_lifecycle();
  test_capture_evidence();
  test_camera_video_node_registration();
  test_usb_rx_pump();
  test_usb_rx_scheduling();
  test_usb_tx_full_write();
  test_playback_flow_control();
  test_end_of_speech_detector();
  test_end_of_speech_low_signal_calibration();
  test_end_of_speech_release_noise_envelope();
  test_end_of_speech_two_stage_natural_pause_protection();
  test_end_of_speech_calibration_evidence();
  test_fault_state_machine();
  return 0;
}
