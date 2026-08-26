import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("../../../lib/supabase.ts", () => ({ supabase: { functions: { invoke } } }));
const { SupabaseSttProvider } = await import("../voice/SttProvider.js");
const { SupabaseSttBenchmarkProvider } = await import("../voice/SttBenchmarkProvider.js");

describe("SupabaseSttProvider", () => {
  beforeEach(() => invoke.mockReset());
  it("sends transient PCM to only the authenticated voice function with explicit metadata", async () => {
    invoke.mockResolvedValue({ data: { ok: true, stage: "stt", turn_id: "turn-1", transcript: "hello", outcome: "transcribed" }, error: null });
    const result = await new SupabaseSttProvider().transcribe({ pcm: new Uint8Array([1, 2]), sampleRate: 24000, channels: 1, turnId: "turn-1" });
    expect(result.transcript).toBe("hello");
    expect(invoke).toHaveBeenCalledWith("guest-ai-stt", expect.objectContaining({ body: expect.any(ArrayBuffer), timeout: 30_000, headers: expect.objectContaining({ "X-Guest-AI-Turn-ID": "turn-1", "X-Guest-AI-Byte-Count": "2" }) }));
  });
  it("rejects a stage or turn mismatch without inventing a transcript", async () => {
    invoke.mockResolvedValue({ data: { ok: true, stage: "stt", turn_id: "other" }, error: null });
    await expect(new SupabaseSttProvider().transcribe({ pcm: new Uint8Array([1, 2]), sampleRate: 24000, channels: 1, turnId: "turn-1" })).rejects.toMatchObject({ code: "stt_turn_mismatch" });
  });
});

describe("SupabaseSttBenchmarkProvider", () => {
  beforeEach(() => invoke.mockReset());
  it("sends one transient PCM payload to the authenticated benchmark function, never a source phrase", async () => {
    invoke.mockResolvedValue({ data: { ok: true, stage: "stt_benchmark", turn_id: "turn-1", candidates: [] }, error: null });
    await expect(new SupabaseSttBenchmarkProvider().transcribe({ pcm: new Uint8Array([1, 2]), sampleRate: 24000, channels: 1, turnId: "turn-1" })).resolves.toMatchObject({ turn_id: "turn-1" });
    expect(invoke).toHaveBeenCalledWith("guest-ai-stt-benchmark", expect.objectContaining({ body: expect.any(ArrayBuffer), timeout: 70_000, headers: expect.not.objectContaining({ source: expect.anything() }) }));
  });

  it("rejects benchmark stage and correlation mismatches", async () => {
    invoke.mockResolvedValue({ data: { ok: true, stage: "stt", turn_id: "other" }, error: null });
    await expect(new SupabaseSttBenchmarkProvider().transcribe({ pcm: new Uint8Array([1, 2]), sampleRate: 24000, channels: 1, turnId: "turn-1" })).rejects.toMatchObject({ code: "stt_benchmark_response_invalid" });
  });
});
