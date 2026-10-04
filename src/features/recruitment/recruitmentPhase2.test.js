import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  boxes,
  tracks,
  verifyMp4,
  MediaIntegrityError,
} from "../../../supabase/functions/recruitment-evidence/mp4.ts";
vi.mock("./recruitmentService.js", () => ({
  recruitmentService: {
    transcriptTurn: vi.fn(),
    providerDisconnected: vi.fn().mockResolvedValue(null),
    annotation: vi.fn(),
    trace: vi.fn(),
    realtimeSecret: vi.fn(),
  },
}));
vi.mock("./interviewTranscriptQueue.js", () => ({
  interviewTranscriptQueue: {
    put: vi.fn(),
    list: vi.fn().mockResolvedValue([]),
    remove: vi.fn(),
  },
}));
import { RecruitmentRealtimeSession } from "./RecruitmentRealtimeSession.js";
import { recruitmentService } from "./recruitmentService.js";
import { interviewTranscriptQueue } from "./interviewTranscriptQueue.js";
const box = (name, data) => {
  const bytes = new Uint8Array(data.length + 8);
  new DataView(bytes.buffer).setUint32(0, bytes.length);
  bytes.set(
    [...name].map((c) => c.charCodeAt(0)),
    4,
  );
  bytes.set(data, 8);
  return bytes;
};
const concat = (...arrays) => new Uint8Array(arrays.flatMap((a) => [...a]));
const track = (kind, width = 0, height = 0) => {
  const tkhd = new Uint8Array(84);
  const view = new DataView(tkhd.buffer);
  view.setUint32(76, width * 65536);
  view.setUint32(80, height * 65536);
  const handler = new Uint8Array(12);
  handler.set(
    [...kind].map((c) => c.charCodeAt(0)),
    8,
  );
  return box(
    "trak",
    concat(box("tkhd", tkhd), box("mdia", box("hdlr", handler))),
  );
};
describe("Finalized MP4 evidence verification", () => {
  it("requires both an audio track and nonzero camera dimensions", () => {
    expect(tracks(concat(track("vide", 480, 640), track("soun")))).toEqual({
      width: 480,
      height: 640,
    });
    expect(() => tracks(concat(track("vide"), track("soun")))).toThrow(
      MediaIntegrityError,
    );
    expect(() => tracks(track("vide", 480, 640))).toThrow(MediaIntegrityError);
  });
  it("rejects incomplete MP4 units rather than treating transport bytes as video", () => {
    expect(() =>
      boxes(new Uint8Array([0, 0, 0, 20, 109, 100, 97, 116])),
    ).toThrow(MediaIntegrityError);
  });
  it("verifies a complete ranged container and distinguishes a transient range failure", async () => {
    const bytes = concat(
      box("ftyp", new Uint8Array(4)),
      box("mdat", new Uint8Array(20)),
      box("moov", concat(track("vide", 480, 640), track("soun"))),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, options) => {
        const [start, end] = options.headers.Range.slice(6)
          .split("-")
          .map(Number);
        return new Response(bytes.slice(start, end + 1), { status: 206 });
      }),
    );
    expect(await verifyMp4("https://private.example", bytes.length)).toEqual({
      width: 480,
      height: 640,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("temporary", { status: 503 })),
    );
    try {
      await verifyMp4("https://private.example", bytes.length);
      throw Error("expected failure");
    } catch (error) {
      expect(error).not.toBeInstanceOf(MediaIntegrityError);
      expect(error.message).toBe("Recording range unavailable");
    }
    vi.unstubAllGlobals();
  });
});
describe("Recruitment realtime transcript and recording boundary", () => {
  beforeEach(() => vi.clearAllMocks());
  it("orders finalized turns by conversation item creation, even when transcription finishes out of order", async () => {
    const session = new RecruitmentRealtimeSession({
      token: "a".repeat(64),
      clientId: "test",
      startedAt: new Date().toISOString(),
      audioElement: {},
    });
    session.attemptKey = "partition";
    session.generation = 1;
    await session.consume(
      JSON.stringify({
        type: "conversation.item.added",
        item: { id: "candidate-1", type: "message", role: "user" },
      }),
    );
    session.responses.request("test");
    await session.consume(JSON.stringify({type:"response.created",response:{id:"response-1",metadata:{owner:"test"}}}));
    await session.consume(
      JSON.stringify({
        type: "response.output_item.added",
        response_id: "response-1",
        item: { id: "ai-1", type: "message", role: "assistant" },
      }),
    );
    await session.consume(
      JSON.stringify({
        type: "response.output_audio_transcript.done",
        response_id: "response-1",
        item_id: "ai-1",
        transcript: "Tell me more.",
      }),
    );
    await session.consume(
      JSON.stringify({
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "candidate-1",
        transcript: "Saya worked at 前台.",
      }),
    );
    await session.consume(JSON.stringify({type:"output_audio_buffer.stopped",response_id:"response-1"}));
    const turns = interviewTranscriptQueue.put.mock.calls.map(([turn]) => turn).filter(turn=>!turn.kind);
    expect(turns.map((t) => t.providerOrder)).toEqual([1, 2]);
    expect(turns[0].transcript).toBe("Saya worked at 前台.");
  });
  it("cannot create a peer after credentials arrive for a closed transport", async () => {
    let resolve;
    recruitmentService.realtimeSecret.mockReturnValue(new Promise(r => { resolve = r; }));
    const peer = vi.fn(); vi.stubGlobal("RTCPeerConnection", peer);
    const session = new RecruitmentRealtimeSession({token:"a".repeat(64),clientId:"test",audioElement:{},startedAt:new Date().toISOString()});
    session.attemptKey = "partition";
    const connect = session.connect(); session.close(); resolve({generation:2,value:"synthetic"});
    await expect(connect).rejects.toThrow("replaced"); expect(peer).not.toHaveBeenCalled(); vi.unstubAllGlobals();
  });
  it("closing AI transport leaves camera and microphone tracks alive", () => {
    const stop = vi.fn();
    const session = new RecruitmentRealtimeSession({
      mediaStream: { getTracks: () => [{ stop }] },
      audioElement: { srcObject: {} },
      startedAt: new Date().toISOString(),
    });
    session.peer = { close: vi.fn() };
    session.channel = { close: vi.fn() };
    session.close();
    expect(stop).not.toHaveBeenCalled();
    expect(session.peer).toBeNull();
  });
});
