import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import useToasts from "../useToasts.js";

afterEach(() => { cleanup(); vi.useRealTimers(); });

it("preserves message defaults, explicit dismiss and 3200ms expiry", () => {
  vi.useFakeTimers();
  const { result } = renderHook(useToasts);
  act(() => result.current.notify({ title: "Saved" }));
  expect(result.current.toasts[0]).toMatchObject({ title: "Saved", message: "", tone: "success" });
  act(() => result.current.dismiss(result.current.toasts[0].id));
  expect(result.current.toasts).toEqual([]);
  act(() => result.current.notify({ title: "Failed", message: "Retry", tone: "error" }));
  act(() => vi.advanceTimersByTime(3200));
  expect(result.current.toasts).toEqual([]);
});

it("cleans pending timers and does not transfer messages to a replacement workspace", () => {
  vi.useFakeTimers();
  const first = renderHook(useToasts);
  act(() => first.result.current.notify({ title: "Old workspace" }));
  expect(vi.getTimerCount()).toBe(1);
  first.unmount();
  expect(vi.getTimerCount()).toBe(0);
  const second = renderHook(useToasts);
  expect(second.result.current.toasts).toEqual([]);
});
