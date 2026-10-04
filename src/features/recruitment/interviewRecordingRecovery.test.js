import { Blob as NodeBlob } from "node:buffer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("./recruitmentService.js", () => ({
  recruitmentService: { evidence: vi.fn(), interruption: vi.fn() },
}));
vi.mock("../../lib/supabase.ts", () => ({
  supabase: {
    storage: {
      from: vi.fn(() => ({
        uploadToSignedUrl: vi.fn().mockResolvedValue({ error: null }),
      })),
    },
  },
}));
vi.mock("./interviewRecordingStore.js", () => ({
  interviewLocalKey: vi.fn().mockResolvedValue("partition"),
  recordingStore: {
    units: vi.fn(),
    chunks: vi.fn(),
    unit: vi.fn(),
    chunk: vi.fn(),
    removeUnit: vi.fn(),
  },
}));
import {
  InterviewRecording,
  recordingTransportChunks,
} from "./InterviewRecording.js";
import { recruitmentService } from "./recruitmentService.js";
import { recordingStore } from "./interviewRecordingStore.js";
beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("assembles a finalized unit only after every local transport chunk has a server acknowledgement", async () => {
  const create = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag) => {
    const element = create(tag);
    if (tag === "video") {
      Object.defineProperties(element, {
        videoWidth: { value: 480 },
        videoHeight: { value: 640 },
      });
      element.load = () => element.onloadedmetadata();
    }
    return element;
  });
  vi.stubGlobal("URL", {
    createObjectURL: () => "blob:test",
    revokeObjectURL: vi.fn(),
  });
  const chunk = {
    unitId: "unit",
    index: 0,
    blob: new Blob(["stopped container"]),
    ack: false,
  };
  recordingStore.chunks.mockResolvedValue([chunk]);
  recruitmentService.evidence.mockImplementation(async (action) =>
    action === "chunk"
      ? { path: "private", upload_token: "signed" }
      : { verified: false },
  );
  const recorder = new InterviewRecording({
    token: "a".repeat(64),
    clientId: "client",
    startedAt: new Date().toISOString(),
    onStatus: vi.fn(),
  });
  await recorder.uploadUnit({
    id: "unit",
    closed: true,
    elapsedEndMs: 1000,
    reason: "completed",
  });
  const calls = recruitmentService.evidence.mock.calls.map(
    ([action]) => action,
  );
  expect(calls).toEqual(["upload", "chunk", "chunk_ack", "assemble", "verify"]);
  expect(recordingStore.removeUnit).toHaveBeenCalledWith("unit");
});
it("recovers a stopped unit from fully acknowledged server bytes after local storage is lost", async () => {
  recordingStore.units.mockResolvedValue([]);
  recruitmentService.evidence.mockImplementation(async (action) =>
    action === "state"
      ? {
          units: [{ id: "unit", status: "pending", expected_bytes: 123 }],
          chunks: [
            {
              unit_id: "unit",
              chunk_index: 0,
              expected_bytes: 123,
              acknowledged_at: "now",
            },
          ],
        }
      : {},
  );
  const recorder = new InterviewRecording({
    token: "a".repeat(64),
    clientId: "client",
    startedAt: new Date().toISOString(),
    onStatus: vi.fn(),
  });
  await recorder.recover();
  expect(
    recruitmentService.evidence.mock.calls.map(([action]) => action),
  ).toEqual(["state", "assemble", "verify"]);
});
it("marks missing unacknowledged bytes interrupted instead of fabricating a complete unit", async () => {
  recordingStore.units.mockResolvedValue([]);
  recruitmentService.evidence.mockImplementation(async (action) =>
    action === "state"
      ? {
          units: [{ id: "unit", status: "pending", expected_bytes: 123 }],
          chunks: [
            { unit_id: "unit", expected_bytes: 100, acknowledged_at: "now" },
          ],
        }
      : {},
  );
  const recorder = new InterviewRecording({
    token: "a".repeat(64),
    clientId: "client",
    startedAt: new Date().toISOString(),
    onStatus: vi.fn(),
  });
  await recorder.recover();
  expect(
    recruitmentService.evidence.mock.calls.map(([action]) => action),
  ).toEqual(["state", "abandon"]);
});

it("bounds delayed mobile transport blobs without changing stopped-container bytes", async () => {
  const bytes = new Uint8Array(13 * 1024 * 1024 + 3);
  bytes[0] = 11;
  bytes[6 * 1024 * 1024] = 22;
  bytes[bytes.length - 1] = 33;
  const chunks = [...recordingTransportChunks(new NodeBlob([bytes]))];
  expect(chunks.map((c) => c.size)).toEqual([
    6 * 1024 * 1024,
    6 * 1024 * 1024,
    1024 * 1024 + 3,
  ]);
  const reassembled = new Uint8Array(await new NodeBlob(chunks).arrayBuffer());
  expect(Buffer.compare(Buffer.from(reassembled), Buffer.from(bytes))).toBe(0);
});

it("suspended-context close cannot hold captureStopped or the next recording acquisition",async()=>{
  recordingStore.unit.mockResolvedValue();recordingStore.chunks.mockResolvedValue([]);
  recruitmentService.evidence.mockResolvedValue({});
  const stopTrack=vi.fn(),close=vi.fn(()=>new Promise(()=>{}));
  const recorder=new InterviewRecording({token:"a".repeat(64),clientId:"client",startedAt:new Date().toISOString(),stream:{getTracks:()=>[{stop:stopTrack}]},onStatus:vi.fn()});
  recorder.unit={id:"old",closed:false};recorder.context={close};
  recorder.recorder={state:"recording",stop:()=>queueMicrotask(()=>recorder.resolveStop())};
  const upload=recorder.stop("media_track_muted");
  const result=await recorder.captureStopped;
  expect(result.closed).toBe(true);expect(stopTrack).toHaveBeenCalledTimes(1);expect(close).toHaveBeenCalledTimes(1);
  await upload;
});
it("independent old-upload recovery never abandons the new live unit",async()=>{
  recordingStore.units.mockResolvedValue([]);
  recruitmentService.evidence.mockResolvedValue({units:[{id:"fresh",status:"capturing"}],chunks:[]});
  const recorder=new InterviewRecording({token:"a".repeat(64),clientId:"client",startedAt:new Date().toISOString(),onStatus:vi.fn()});
  await recorder.recover({deferUploads:true,excludeUnit:()=>"fresh"});await recorder.uploadRecovery;
  expect(recruitmentService.evidence.mock.calls.map(([action])=>action)).toEqual(["state"]);
});

it("activates audio synchronously and exposes a finite error if native resume never settles",async()=>{
  vi.useFakeTimers();
  const resume=vi.fn(()=>new Promise(()=>{}));
  vi.stubGlobal("AudioContext",class {constructor(){this.state="suspended";}resume(){return resume();}});
  vi.stubGlobal("MediaRecorder",{isTypeSupported:()=>true});
  const activation=InterviewRecording.activateAudio();expect(resume).toHaveBeenCalledTimes(1);
  const recorder=new InterviewRecording({token:"a".repeat(64),clientId:"client",startedAt:new Date().toISOString(),audioActivation:activation,onStatus:vi.fn()});
  const start=recorder.start();const assertion=expect(start).rejects.toThrow(/Microphone audio timed out/);
  await vi.advanceTimersByTimeAsync(10100);await assertion;
  expect(recruitmentService.evidence).not.toHaveBeenCalled();vi.useRealTimers();
});
