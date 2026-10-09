import v4Physical from "../../../qa/recruitment/v4Physical.fixture.json";
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
    session.attemptKey = "partition"; session.recoveryId = "recovery-owner";
    session.generation = 1;
    await session.consume(
      JSON.stringify({
        type: "conversation.item.added",
        item: { id: "candidate-1", type: "message", role: "user" },
      }),
    );
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
    await session.persistence;
    const turns = interviewTranscriptQueue.put.mock.calls.map(([turn]) => turn).filter(turn=>!turn.kind);
    expect(turns.map((t) => t.providerOrder)).toEqual([1, 2]);
    expect(turns[0].transcript).toBe("Saya worked at 前台.");
  });
  it("cannot create a peer after credentials arrive for a closed transport", async () => {
    let resolve;
    recruitmentService.realtimeSecret.mockReturnValue(new Promise(r => { resolve = r; }));
    const peer = vi.fn(); vi.stubGlobal("RTCPeerConnection", peer);
    const session = new RecruitmentRealtimeSession({token:"a".repeat(64),clientId:"test",audioElement:{},startedAt:new Date().toISOString()});
    session.attemptKey = "partition"; session.recoveryId = "recovery-owner";
    const connect = session.connect(); session.close(); resolve({generation:2,value:"synthetic"});
    await expect(connect).rejects.toThrow("replaced"); expect(peer).not.toHaveBeenCalled(); vi.unstubAllGlobals();
  });
  it("a realtime object is single-use even while its old credentials are hung", async () => {
    recruitmentService.realtimeSecret.mockImplementationOnce(()=>new Promise(()=>{}));
    const session = new RecruitmentRealtimeSession({token:"test",clientId:"client",recoveryId:"generation-owner",startedAt:new Date().toISOString(),audioElement:{}});
    session.attemptKey="partition";session.connect().catch(()=>{});
    await expect(session.connect()).rejects.toThrow("fresh connection");session.close();
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

it("hung transcript storage cannot gate provider events or create candidate responses",()=>{
 interviewTranscriptQueue.put.mockImplementationOnce(()=>new Promise(()=>{}));
 const seen=vi.fn();const session=new RecruitmentRealtimeSession({token:"a".repeat(64),clientId:"client",startedAt:new Date().toISOString(),audioElement:{},onEvent:seen});
 session.attemptKey="pending";session.generation=1;
 session.consume(JSON.stringify({type:"input_audio_buffer.speech_started",item_id:"c"}));
 session.consume(JSON.stringify({type:"input_audio_buffer.speech_stopped",item_id:"c"}));
 session.consume(JSON.stringify({type:"input_audio_buffer.committed",item_id:"c"}));
 session.consume(JSON.stringify({type:"conversation.item.input_audio_transcription.completed",item_id:"c",transcript:"Boleh"}));
 session.consume(JSON.stringify({type:"response.created",response:{id:"r"}}));
 expect(seen).toHaveBeenCalledTimes(5);expect(session.conversation.turns.get("c").responded).toBe(true);session.close();
});
it("playback receipt before transcript final still saves evidence without replay",async()=>{
 const session=new RecruitmentRealtimeSession({token:"a".repeat(64),clientId:"client",startedAt:new Date().toISOString(),audioElement:{}});session.attemptKey="p";session.generation=1;
 session.consume(JSON.stringify({type:"response.created",response:{id:"r"}}));
 session.consume(JSON.stringify({type:"response.output_item.added",response_id:"r",item:{id:"a",type:"message",role:"assistant"}}));
 session.consume(JSON.stringify({type:"output_audio_buffer.stopped",response_id:"r"}));
 session.consume(JSON.stringify({type:"response.output_audio_transcript.done",response_id:"r",item_id:"a",transcript:"Next useful question"}));
 await session.persistence;expect(interviewTranscriptQueue.put.mock.calls.some(([t])=>t.itemId==="a" && t.transcript==="Next useful question")).toBe(true);session.close();
});
it("provider-cleared audio is annotated even if text final arrives afterwards",async()=>{
 const session=new RecruitmentRealtimeSession({token:"a".repeat(64),clientId:"client",startedAt:new Date().toISOString(),audioElement:{}});session.attemptKey="p";session.generation=1;
 session.consume(JSON.stringify({type:"response.created",response:{id:"r"}}));
 session.consume(JSON.stringify({type:"response.output_item.added",response_id:"r",item:{id:"a",type:"message",role:"assistant"}}));
 session.consume(JSON.stringify({type:"output_audio_buffer.cleared",response_id:"r"}));
 session.consume(JSON.stringify({type:"response.output_audio_transcript.done",response_id:"r",item_id:"a",transcript:"Unfinished question"}));
 await session.persistence;expect(interviewTranscriptQueue.put.mock.calls.some(([t])=>t.itemId==="a" && t.kind==="truncated")).toBe(true);session.close();
});
it('V4 disputed input overlapping cleared opening is retained with exclusion before transcript persistence',async()=>{
 vi.clearAllMocks();
 const session=new RecruitmentRealtimeSession({token:'a'.repeat(64),clientId:'client',startedAt:new Date().toISOString(),audioElement:{},onStatus:vi.fn()});
 session.attemptKey='physical-v4';session.generation=1;
 session.consume(JSON.stringify({type:'output_audio_buffer.started',response_id:'opening'}));
 session.consume(JSON.stringify({type:'output_audio_buffer.cleared',response_id:'opening'}));
 for(const type of ['speech_started','speech_stopped','committed']) session.consume(JSON.stringify({type:'input_audio_buffer.'+type,item_id:'disputed'}));
 session.consume(JSON.stringify({type:'conversation.item.input_audio_transcription.completed',item_id:'disputed',transcript:'Apa pengalaman kerja awak dalam industri makanan dan minuman?'}));
 await session.persistence;
 const records=interviewTranscriptQueue.put.mock.calls.map(([r])=>r);
 expect(records.some(r=>r.itemId==='disputed'&&r.kind==='unverified_candidate')).toBe(true);
 expect(records.some(r=>r.itemId==='disputed'&&r.speaker==='candidate')).toBe(true);
 expect(records.findIndex(r=>r.kind==='unverified_candidate')).toBeLessThan(records.findIndex(r=>r.speaker==='candidate'));
 session.close();
});
it('transcription without native input boundaries is never silently verified',async()=>{
 vi.clearAllMocks();
 const session=new RecruitmentRealtimeSession({token:'a'.repeat(64),clientId:'client',startedAt:new Date().toISOString(),audioElement:{}});
 session.attemptKey='missing-boundary';session.generation=1;
 session.consume(JSON.stringify({type:'input_audio_buffer.committed',item_id:'ghost'}));
 session.consume(JSON.stringify({type:'conversation.item.input_audio_transcription.completed',item_id:'ghost',transcript:'Invented answer'}));
 await session.persistence;
 expect(interviewTranscriptQueue.put.mock.calls.some(([r])=>r.kind==='unverified_candidate')).toBe(true);session.close();
});

it('original V4 clear/start/commit sequence quarantines the disputed T2 without deleting it',async()=>{
 vi.clearAllMocks();
 const session=new RecruitmentRealtimeSession({token:'a'.repeat(64),clientId:'client',startedAt:new Date().toISOString(),audioElement:{}});
 session.attemptKey='physical-fixture';session.generation=1;
 const disputed=v4Physical.turns.find(t=>t.turn_number===2);
 for(const event of v4Physical.events.filter(e=>e.elapsed_ms<=13374)) {
  // Bounded diagnostics retain identifiers/status but not complete provider payloads.
  // Replay the exact audio/input boundaries; missing payloads are not invented.
  if(event.type.startsWith('output_audio_buffer.') || event.type.startsWith('input_audio_buffer.')) session.consume(JSON.stringify(event));
 }
 session.consume(JSON.stringify({type:'conversation.item.input_audio_transcription.completed',item_id:disputed.provider_item_id,transcript:disputed.transcript}));
 await session.persistence;
 const saved=interviewTranscriptQueue.put.mock.calls.map(([r])=>r);
 expect(saved.some(r=>r.itemId===disputed.provider_item_id && r.kind==='unverified_candidate')).toBe(true);
 expect(saved.some(r=>r.transcript===disputed.transcript)).toBe(true);
 expect(session.evidence.candidateEligible(disputed.provider_item_id)).toBe(false);
 session.close();
});
it('durable exclusion reaches the server before a turn even when IndexedDB returns text first',async()=>{
 vi.clearAllMocks();
 const session=new RecruitmentRealtimeSession({token:'a'.repeat(64),clientId:'client',startedAt:new Date().toISOString(),audioElement:{}});
 session.attemptKey='ordering';session.generation=1;
 interviewTranscriptQueue.list.mockResolvedValueOnce([{key:'text',itemId:'t',speaker:'candidate',generation:1},{key:'annotation',itemId:'t',kind:'unverified_candidate',generation:1,elapsedMs:1}]).mockResolvedValueOnce([]);
 await session.flush();
 expect(recruitmentService.annotation.mock.invocationCallOrder[0]).toBeLessThan(recruitmentService.transcriptTurn.mock.invocationCallOrder[0]);
 session.close();
});
