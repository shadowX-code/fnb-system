// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import useCrewRoute from "../hooks/useCrewRoute.js";

afterEach(cleanup);

it("preserves native back/forward and restores a deep link on remount", async () => {
  window.history.replaceState(null, "", "#crew/home");
  const first = renderHook(useCrewRoute);
  act(() => first.result.current.navigate("learn"));
  act(() => first.result.current.navigate("growth", { growthInitialView: "performance" }));
  expect(window.location.hash).toBe("#crew/growth/performance");
  act(() => window.history.back());
  await waitFor(() => expect(first.result.current.screen).toBe("learn"));
  act(() => window.history.forward());
  await waitFor(() => expect(first.result.current.growthInitialView).toBe("performance"));
  first.unmount();
  const restored = renderHook(useCrewRoute);
  expect(restored.result.current.screen).toBe("growth");
  expect(restored.result.current.growthInitialView).toBe("performance");
});

it.each(["#crew", "#crew/unknown"])("normalizes %s without adding a history entry", (hash) => {
  window.history.replaceState(null, "", hash);
  const length = window.history.length;
  const { result } = renderHook(useCrewRoute);
  expect(result.current.screen).toBe("home");
  expect(window.location.hash).toBe("#crew/home");
  expect(window.history.length).toBe(length);
});

it("does not rewrite an Admin hash delivered while Crew is unmounting", () => {
  window.history.replaceState(null, "", "#crew/home");
  const { result } = renderHook(useCrewRoute);
  act(() => {
    window.history.pushState(null, "", "#dashboard");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  expect(result.current.screen).toBe("home");
  expect(window.location.hash).toBe("#dashboard");
});
