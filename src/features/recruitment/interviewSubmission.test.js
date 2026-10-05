import { describe, it, expect, vi, afterEach } from "vitest";
import { reconcileSubmission } from "./interviewSubmission.js";
afterEach(() => vi.useRealTimers());
describe("bounded submission reconciliation", () => {
  it("physical regression: upload exceeds 30s, canonical completion wins independently of lease", async () => {
    vi.useFakeTimers();
    let started = Date.now();
    const result = vi.fn();
    const read = vi.fn(async () => ({
      available: true,
      status: Date.now() - started >= 36000 ? "completed" : "finalizing",
      recording_state: "complete",
    }));
    const pending = reconcileSubmission({
      read,
      onResult: result,
      timeoutMs: 90000,
    });
    await vi.advanceTimersByTimeAsync(38000);
    expect((await pending).status).toBe("completed");
    expect(result).toHaveBeenCalledOnce();
  });
  it("cold terminal read needs no stale lease, upload or finalize", async () => {
    const finalize = vi.fn();
    const onResult = vi.fn();
    await reconcileSubmission({
      read: async () => ({ available: true, status: "partial" }),
      finalize,
      onResult,
    });
    expect(finalize).not.toHaveBeenCalled();
    expect(onResult).toHaveBeenCalledWith(
      expect.objectContaining({ status: "partial" }),
    );
  });
  it("never fabricates success for forever pending media", async () => {
    vi.useFakeTimers();
    const onResult = vi.fn();
    const pending = reconcileSubmission({
      read: async () => ({ available: true, status: "finalizing" }),
      onResult,
      timeoutMs: 6000,
    });
    const assertion = expect(pending).rejects.toThrow(/not yet confirmed/);
    await vi.advanceTimersByTimeAsync(7000);
    await assertion;
    expect(onResult).not.toHaveBeenCalled();
  });
  it("hung read and finalization converge to retry instead of indefinite pending", async () => {
    vi.useFakeTimers();
    const pending = reconcileSubmission({
      read: () => new Promise(() => {}),
      onResult: vi.fn(),
      timeoutMs: 7000,
    });
    const assertion = expect(pending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(15000);
    await assertion;
  });
  it("disposal cancels reconciliation and prevents late result UI mutation", async () => {
    vi.useFakeTimers();
    const control = new AbortController();
    const onResult = vi.fn();
    const pending = reconcileSubmission({
      read: () => new Promise(() => {}),
      onResult,
      signal: control.signal,
    });
    const assertion = expect(pending).rejects.toThrow();
    control.abort();
    await assertion;
    expect(onResult).not.toHaveBeenCalled();
  });
});
