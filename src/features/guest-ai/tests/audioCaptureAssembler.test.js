import { describe, expect, it } from "vitest";
import { AudioCaptureAssembler, MAX_AUDIO_CAPTURE_BYTES } from "../device/audio/AudioCaptureAssembler.js";

const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
describe("bounded audio capture transport", () => {
  it("assembles ordered PCM chunks without persisting them", () => {
    const capture = new AudioCaptureAssembler();
    capture.start({ turn_id: "turn-1", format: "pcm_s16le", sample_rate_hz: 24000, channels: 1 });
    capture.append({ turn_id: "turn-1", sequence: 0, byte_count: 2, encoding: "base64", pcm: b64([1, 2]) });
    capture.append({ turn_id: "turn-1", sequence: 1, byte_count: 2, encoding: "base64", pcm: b64([3, 4]) });
    expect([...capture.complete({ turn_id: "turn-1", byte_count: 4, duration_ms: 40, completion: "completed" }).pcm]).toEqual([1, 2, 3, 4]);
  });
  it("rejects duplicate, out-of-order, malformed, and over-limit frames", () => {
    const capture = new AudioCaptureAssembler(); capture.start({ turn_id: "turn", format: "pcm_s16le", sample_rate_hz: 24000, channels: 1 });
    expect(() => capture.append({ turn_id: "turn", sequence: 1, byte_count: 1, encoding: "base64", pcm: b64([1]) })).toThrow("audio_sequence_out_of_order");
    expect(() => capture.append({ turn_id: "turn", sequence: 0, byte_count: 1, encoding: "raw", pcm: "x" })).toThrow("malformed_audio_frame");
    capture.byteCount = MAX_AUDIO_CAPTURE_BYTES;
    expect(() => capture.append({ turn_id: "turn", sequence: 0, byte_count: 1, encoding: "base64", pcm: b64([1]) })).toThrow("audio_capture_size_invalid");
  });
});
