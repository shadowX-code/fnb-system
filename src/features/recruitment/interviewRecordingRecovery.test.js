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
import { InterviewRecording } from "./InterviewRecording.js";
import { recruitmentService } from "./recruitmentService.js";
import { recordingStore } from "./interviewRecordingStore.js";
beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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
