import { describe, expect, it, vi } from "vitest";
import { AudioPlaybackSender, MAX_AUDIO_PLAYBACK_BYTES } from "../device/audio/AudioPlaybackSender.js";

describe("AudioPlaybackSender", () => {
  it("sends an ordered, bounded 24 kHz mono PCM session over canonical commands", async () => {
    const session = {
      startPlaybackAndWait: vi.fn(async () => ({ status: "ok", evidence: { mode: "bounded_prebuffer" } })),
      sendPlaybackChunkAndWait: vi.fn(async ({ sequence }) => ({ status: "ok", evidence: { accepted: true, sequence } })),
      endPlaybackAndWait: vi.fn(async () => ({ status: "ok" })),
      cancelPlayback: vi.fn(async () => {}),
    };
    const pcm = new Uint8Array(2048);
    const result = await new AudioPlaybackSender().send({ session, turnId: "turn-1", pcm });
    expect(session.startPlaybackAndWait).toHaveBeenCalledWith({ turnId: "turn-1", sampleRate: 24000, channels: 1, totalBytes: 2048 });
    expect(session.sendPlaybackChunkAndWait).toHaveBeenCalledTimes(2);
    expect(session.sendPlaybackChunkAndWait.mock.calls.map(([payload]) => payload.sequence)).toEqual([0, 1]);
    expect(session.endPlaybackAndWait).toHaveBeenCalledWith("turn-1");
    expect(result).toMatchObject({ turnId: "turn-1", chunks: 2, byteCount: 2048 });
  });
  it("retries the same sequence after bounded device busy without advancing playback", async () => {
    const responses = [
      { status: "error", detail: "audio_playback_chunk_busy", evidence: { accepted: false, sequence: 0, queued_chunks: 4 } },
      { status: "ok", detail: "audio_playback_chunk_accepted", evidence: { accepted: true, sequence: 0, queued_chunks: 3 } },
    ];
    const session = {
      startPlaybackAndWait: vi.fn(async () => ({ status: "ok" })),
      sendPlaybackChunkAndWait: vi.fn(async () => responses.shift()),
      endPlaybackAndWait: vi.fn(async () => ({ status: "ok" })),
      cancelPlayback: vi.fn(async () => {}),
    };
    const result = await new AudioPlaybackSender().send({ session, turnId: "turn-busy", pcm: new Uint8Array(1024) });
    expect(session.sendPlaybackChunkAndWait.mock.calls.map(([payload]) => payload.sequence)).toEqual([0, 0]);
    expect(result.busyRetries).toBe(1);
    expect(session.cancelPlayback).not.toHaveBeenCalled();
  });
  it("waits for each sequential upload ACK before sending the next chunk", async () => {
    const deferred = [];
    const session = {
      startPlaybackAndWait: vi.fn(async () => ({ status: "ok" })),
      sendPlaybackChunkAndWait: vi.fn(({ sequence }) => new Promise((resolve) => deferred.push(() => resolve({ status: "ok", evidence: { accepted: true, sequence, queued_chunks: sequence + 1, remaining_credit: 0 } })))),
      endPlaybackAndWait: vi.fn(async () => ({ status: "ok" })),
      cancelPlayback: vi.fn(async () => {}),
    };
    const sending = new AudioPlaybackSender().send({ session, turnId: "turn-window", pcm: new Uint8Array(4096) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(session.sendPlaybackChunkAndWait.mock.calls.map(([payload]) => payload.sequence)).toEqual([0]);
    deferred[0]();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(session.sendPlaybackChunkAndWait.mock.calls.map(([payload]) => payload.sequence)).toEqual([0, 1]);
    deferred[1](); await new Promise((resolve) => setTimeout(resolve, 0));
    deferred[2](); await new Promise((resolve) => setTimeout(resolve, 0));
    deferred[3]();
    await expect(sending).resolves.toMatchObject({ chunks: 4, mode: "bounded_prebuffer" });
  });
  it("cancels a failed transfer and never sends a following sequence", async () => {
    const session = {
      startPlaybackAndWait: vi.fn(async () => ({ status: "ok" })),
      sendPlaybackChunkAndWait: vi.fn(async () => ({ status: "error", detail: "audio_playback_sequence_mismatch", evidence: { accepted: false } })),
      endPlaybackAndWait: vi.fn(async () => ({ status: "ok" })),
      cancelPlayback: vi.fn(async () => {}),
    };
    await expect(new AudioPlaybackSender().send({ session, turnId: "turn-fail", pcm: new Uint8Array(1920) })).rejects.toThrow("audio_playback_sequence_mismatch");
    expect(session.sendPlaybackChunkAndWait.mock.calls.map(([payload]) => payload.sequence)).toEqual([0]);
    expect(session.cancelPlayback).toHaveBeenCalledWith("turn-fail", "audio_playback_sequence_mismatch");
  });
  it("returns an exact bounded-playback reason before device transport", async () => {
    const sender = new AudioPlaybackSender(); const session = {};
    await expect(sender.send({ session, turnId: "turn", pcm: new Uint8Array(MAX_AUDIO_PLAYBACK_BYTES + 2) })).rejects.toMatchObject({ code: "audio_playback_exceeds_max_bytes", evidence: { byte_count: MAX_AUDIO_PLAYBACK_BYTES + 2, max_bytes: MAX_AUDIO_PLAYBACK_BYTES, duration_ms: expect.any(Number), max_duration_ms: 6000 } });
    await expect(sender.send({ session, turnId: "turn", pcm: new Uint8Array(3) })).rejects.toMatchObject({ code: "audio_playback_invalid_byte_alignment" });
    await expect(sender.send({ session, turnId: "turn", pcm: new Uint8Array(2), sampleRate: 16000 })).rejects.toMatchObject({ code: "audio_playback_unsupported_sample_rate" });
  });
});
