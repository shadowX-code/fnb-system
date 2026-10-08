import { afterEach, describe, it, expect, vi } from "vitest";
const rpc = vi.hoisted(() => vi.fn());
vi.mock("../../lib/supabase.ts", () => ({ supabase: { rpc } }));
import { recruitmentService } from "./recruitmentService.js";
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});
describe("Profile draft API boundary", () => {
  it("bounds a hung request and aborts it without waiting for transport cleanup", async () => {
    vi.useFakeTimers();
    let signal;
    rpc.mockReturnValue({
      abortSignal: (s) => {
        signal = s;
        return new Promise(() => {});
      },
    });
    const result = expect(
      recruitmentService.saveProfileDraft("draft", 2, {}),
    ).rejects.toThrow(/timed out.*local edits have been kept/);
    await vi.advanceTimersByTimeAsync(15000);
    await result;
    expect(signal.aborted).toBe(true);
  });
  it("returns a permanent revision conflict instead of silently retrying", async () => {
    rpc.mockReturnValue({
      abortSignal: () =>
        Promise.resolve({
          error: { code: "PT409", message: "A newer draft has been saved." },
        }),
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      recruitmentService.saveProfileDraft("draft", 2, {}),
    ).rejects.toMatchObject({ cause: { code: "PT409" } });
    expect(rpc).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });
});
