// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import useCrewRoute from "../hooks/useCrewRoute.js";
import { crewRouteUrlForLegacyHash, crewWorkspaceForLocation, parseCrewRoute } from "../crewRoute.js";

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

it("resolves dedicated Crew pathname deep links and maps legacy hashes to the Crew host", () => {
  expect(parseCrewRoute({ hostname: "crew.feedx.my", pathname: "/growth/performance", hash: "" })).toMatchObject({
    screen: "growth",
    growthInitialView: "performance",
    canonicalPath: "/growth/performance",
  });
  expect(parseCrewRoute({ hostname: "crew.feedx.my", pathname: "/", hash: "" })).toMatchObject({
    screen: "home",
    canonicalPath: "/home",
    needsNormalization: true,
  });
  expect(crewRouteUrlForLegacyHash("#crew/tasks")).toBe("https://crew.feedx.my/tasks");
  expect(crewRouteUrlForLegacyHash("#crew/growth/performance")).toBe("https://crew.feedx.my/growth/performance");
});

it("keeps dedicated Crew paths separate from Admin Crew pathnames", () => {
  expect(crewWorkspaceForLocation({ hostname: "crew.feedx.my", pathname: "/tasks", hash: "#dashboard" })).toBe("crew");
  expect(crewWorkspaceForLocation({ hostname: "os.feedx.my", pathname: "/", hash: "#crew/tasks" })).toBe("legacy-crew-redirect");
  expect(crewWorkspaceForLocation({ hostname: "os.feedx.my", pathname: "/crew/workforce/dashboard", hash: "" })).toBe("admin");
  expect(crewWorkspaceForLocation({ hostname: "fnb-system-staging.vercel.app", pathname: "/", hash: "#crew/tasks" })).toBe("crew");
});
