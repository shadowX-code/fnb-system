import { afterEach, expect, it, vi } from "vitest";
import { factoryBootstrap } from "../factoryBootstrap.js";
afterEach(() => vi.useRealTimers());
it("bounds the real stalled-request scenario and aborts its transport", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const promise = factoryBootstrap(() => new Promise(() => {}), controller);
  const rejected = expect(promise).rejects.toMatchObject({ name: "TimeoutError" });
  await vi.advanceTimersByTimeAsync(30000);
  await rejected;
  expect(controller.signal.aborted).toBe(true);
});
it("allows a fresh retry and preserves the authoritative response", async () => {
  const response = { jobOrders: [], accessIssues: [] };
  expect(await factoryBootstrap(() => Promise.resolve(response), new AbortController())).toBe(response);
});
it("cancels obsolete owners without waiting for their pending promise", async () => {
  const controller = new AbortController();
  const promise = factoryBootstrap(() => new Promise(() => {}), controller);
  controller.abort();
  await expect(promise).rejects.toMatchObject({ name: "AbortError" });
});
it("preserves failures and handles late rejection after cancellation", async () => {
  const error = new Error("Request failed");
  await expect(factoryBootstrap(() => Promise.reject(error), new AbortController())).rejects.toBe(error);
});
