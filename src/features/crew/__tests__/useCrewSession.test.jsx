import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import useCrewSession from "../hooks/useCrewSession.js";
import { crewService } from "../../../services/crewService.js";
import "../../../i18n/index.js";

vi.mock("../../../services/crewService.js", () => ({ crewService: Object.fromEntries(["changePasscode", "updateMyProfilePhoto", "myAttendance", "attendanceContext", "growthMobile", "performanceMobile", "rewardMobile", "operationsToday", "myRoster", "myLeave", "myProfile"].map((name) => [name, vi.fn()])) }));
const session = (token) => ({ token, expires_at: "2099-01-01", employee: { id: token } });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
beforeEach(() => {
  localStorage.setItem("feedx.crew.session", JSON.stringify(session("A")));
  for (const fn of Object.values(crewService)) fn.mockReset().mockImplementation(async (token) => ({ owner: token }));
  crewService.myAttendance.mockImplementation(async (token) => [{ owner: token }]);
});
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });

describe("Crew session orchestration", () => {
  it.each(["success", "failure"])("keeps the current route/session when an old optional response has a stale %s", async (outcome) => {
    const pending = deferred();
    crewService.rewardMobile.mockReturnValueOnce(pending.promise);
    const { result, rerender } = renderHook(({ route }) => useCrewSession(route), { initialProps: { route: "reward" } });
    await waitFor(() => expect(crewService.rewardMobile).toHaveBeenCalledWith("A"));
    act(() => result.current.replaceSession(session("B")));
    rerender({ route: "growth" });
    await waitFor(() => expect(result.current.data.growth?.owner).toBe("B"));
    await act(async () => outcome === "success" ? pending.resolve({ owner: "A" }) : pending.reject(new Error("A expired")));
    expect(result.current.session.token).toBe("B");
    expect(result.current.data.reward?.owner).not.toBe("A");
    rerender({ route: "reward" });
    await waitFor(() => expect(result.current.data.reward?.owner).toBe("B"));
    expect(result.current.pageLoading).toBe(false);
  });

  it("clears all populated employee projections on logout and ignores an off-route pending result", async () => {
    const { result, rerender } = renderHook(({ route }) => useCrewSession(route), { initialProps: { route: "home" } });
    for (const [route, key] of [["home", "operations"], ["me", "profile"], ["growth", "growth"], ["growth", "performance"], ["reward", "reward"]]) {
      rerender({ route });
      await waitFor(() => expect(result.current.data[key]?.owner).toBe("A"));
    }
    const pending = deferred();
    crewService.rewardMobile.mockReturnValueOnce(pending.promise);
    let refresh;
    act(() => { refresh = result.current.refresh(); });
    await waitFor(() => expect(crewService.rewardMobile).toHaveBeenCalledTimes(2));
    act(() => result.current.replaceSession(null));
    expect(Object.values(result.current.data).every(value => value == null || value === "" || (Array.isArray(value) && value.length === 0))).toBe(true);
    rerender({ route: "home" });
    await act(async () => { pending.resolve({ owner: "A" }); await refresh; });
    expect(result.current.session).toBeNull();
    expect(result.current.data.reward).toBeNull();
  });

  it("loads only the four Home projections and defers non-Home data", async () => {
    const { result } = renderHook(() => useCrewSession("home"));
    expect(result.current.pageLoading).toBe(true);
    await waitFor(() => expect(result.current.pageLoading).toBe(false));
    for (const name of ["myAttendance", "attendanceContext", "operationsToday", "myRoster"]) expect(crewService[name]).toHaveBeenCalledTimes(1);
    for (const name of ["growthMobile", "performanceMobile", "rewardMobile", "myLeave", "myProfile"]) expect(crewService[name]).not.toHaveBeenCalled();
  });

  it("deduplicates pending reads and reuses route data until TTL expiry", async () => {
    const pending = deferred();
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    crewService.growthMobile.mockReturnValueOnce(pending.promise);
    const { result, rerender } = renderHook(({ route }) => useCrewSession(route), { initialProps: { route: "home" } });
    await waitFor(() => expect(result.current.pageLoading).toBe(false));
    rerender({ route: "growth" });
    expect(result.current.pageLoading).toBe(true);
    await waitFor(() => expect(crewService.growthMobile).toHaveBeenCalledTimes(1));
    rerender({ route: "home" }); rerender({ route: "growth" });
    expect(crewService.growthMobile).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve({ owner: "A" }));
    await waitFor(() => expect(result.current.pageLoading).toBe(false));
    rerender({ route: "reward" });
    await waitFor(() => expect(result.current.data.reward?.owner).toBe("A"));
    rerender({ route: "growth" });
    expect(crewService.growthMobile).toHaveBeenCalledTimes(1);
    now += 61_000;
    rerender({ route: "home" }); rerender({ route: "growth" });
    await waitFor(() => expect(crewService.growthMobile).toHaveBeenCalledTimes(2));
  });

  it("retries a failed optional route read without revoking the session", async () => {
    crewService.rewardMobile.mockRejectedValueOnce(new Error("temporarily unavailable"));
    const { result, rerender } = renderHook(({ route }) => useCrewSession(route), { initialProps: { route: "reward" } });
    await waitFor(() => expect(result.current.pageLoading).toBe(false));
    expect(result.current.session.token).toBe("A");
    expect(result.current.data.reward).toBeNull();
    rerender({ route: "home" }); rerender({ route: "reward" });
    await waitFor(() => expect(result.current.data.reward?.owner).toBe("A"));
    expect(crewService.rewardMobile).toHaveBeenCalledTimes(2);
  });

  it("clears all route caches when a current mandatory read rejects", async () => {
    const { result } = renderHook(() => useCrewSession("reward"));
    await waitFor(() => expect(result.current.data.reward?.owner).toBe("A"));
    crewService.attendanceContext.mockRejectedValueOnce(new Error("revoked"));
    await act(async () => { await result.current.refresh(); });
    expect(result.current.session).toBeNull();
    expect(result.current.data.reward).toBeNull();
    act(() => result.current.replaceSession(session("B")));
    await waitFor(() => expect(result.current.data.reward?.owner).toBe("B"));
  });

  it("invalidates an off-route pending projection after a mutation refresh", async () => {
    const pending = deferred();
    crewService.growthMobile.mockReturnValueOnce(pending.promise);
    const { result, rerender } = renderHook(({ route }) => useCrewSession(route), { initialProps: { route: "growth" } });
    await waitFor(() => expect(crewService.growthMobile).toHaveBeenCalledTimes(1));
    rerender({ route: "home" });
    await act(async () => { await result.current.refresh(); });
    await act(async () => pending.resolve({ owner: "before-mutation" }));
    expect(result.current.data.growth).toBeNull();
    rerender({ route: "growth" });
    await waitFor(() => expect(result.current.data.growth?.owner).toBe("A"));
    expect(crewService.growthMobile).toHaveBeenCalledTimes(2);
  });

  it("does not strand initial loading under StrictMode effect replay", async () => {
    const { result } = renderHook(() => useCrewSession("home"), { wrapper: StrictMode });
    await waitFor(() => expect(result.current.pageLoading).toBe(false));
    expect(result.current.data.operations.owner).toBe("A");
    for (const name of ["myAttendance", "attendanceContext", "operationsToday", "myRoster"]) expect(crewService[name]).toHaveBeenCalledTimes(1);
  });

  it("keeps token rotation owned by the session after its initiating screen leaves", async () => {
    const pending = deferred();
    crewService.changePasscode.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useCrewSession("me"));
    const changeFromMe = result.current.changePasscode;
    let request;
    act(() => { request = changeFromMe("1234", "5678"); });
    // The caller's lifetime is irrelevant; no Me component owns this response.
    await act(async () => { pending.resolve(session("rotated")); await request; });
    expect(result.current.session.token).toBe("rotated");
    expect(result.current.passcodeSuccess).toBe(true);
    expect(crewService.changePasscode).toHaveBeenCalledWith("A", "1234", "5678");
  });

  it.each(["logout", "replacement", "unmount"])("does not apply passcode rotation after %s", async (mode) => {
    const pending = deferred();
    crewService.changePasscode.mockReturnValueOnce(pending.promise);
    const { result, unmount } = renderHook(() => useCrewSession("me"));
    let request;
    act(() => { request = result.current.changePasscode("1234", "5678"); });
    if (mode === "unmount") unmount();
    else act(() => result.current.replaceSession(mode === "logout" ? null : session("B")));
    await act(async () => { pending.resolve(session("stale-rotation")); expect(await request).toBe(false); });
    expect(JSON.parse(localStorage.getItem("feedx.crew.session"))?.token).toBe(mode === "logout" ? undefined : mode === "replacement" ? "B" : "A");
  });

  it("does not apply an old session's profile photo after token replacement", async () => {
    const pending = deferred();
    crewService.updateMyProfilePhoto.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useCrewSession("me"));
    await waitFor(() => expect(result.current.data.profile?.owner).toBe("A"));
    let request;
    act(() => { request = result.current.updateProfilePhoto(new File(["photo"], "photo.webp", { type: "image/webp" })); });
    act(() => result.current.replaceSession(session("B")));
    await act(async () => { pending.resolve({ profile_photo_path: "A/profile.webp", profile_photo_url: "https://old.example/photo.webp" }); expect(await request).toBe(false); });
    await waitFor(() => expect(result.current.data.profile?.owner).toBe("B"));
    expect(result.current.data.profile.profile_photo_url).toBeUndefined();
  });

  it.each(["success", "failure"])("discards stale A %s after replacement and clears every projection", async (outcome) => {
    const pending = deferred();
    const { result } = renderHook(() => useCrewSession("me"));
    await waitFor(() => expect(result.current.data.profile?.owner).toBe("A"));
    const oldRefresh = result.current.refresh;
    crewService.myAttendance.mockImplementationOnce(() => pending.promise);
    let oldRequest;
    act(() => { oldRequest = oldRefresh(); });
    await waitFor(() => expect(crewService.myAttendance).toHaveBeenCalledTimes(2));
    act(() => { result.current.replaceSession(session("B")); });
    expect(result.current.data.profile).toBeNull();
    expect(result.current.data.growth).toBeNull();
    expect(result.current.data.reward).toBeNull();
    expect(result.current.data.operations).toBeNull();
    await waitFor(() => expect(result.current.data.profile?.owner).toBe("B"));
    await act(async () => { outcome === "success" ? pending.resolve([{ owner: "A" }]) : pending.reject(new Error("A revoked")); await oldRequest; });
    expect(result.current.session.token).toBe("B");
    expect(result.current.data.attendance).toEqual([{ owner: "B" }]);
    expect(result.current.data.reward).toBeNull();
    await act(async () => { expect(await oldRefresh()).toBe(false); });
    expect(JSON.parse(localStorage.getItem("feedx.crew.session")).token).toBe("B");
  });

  it("invalidates a pending refresh on logout and on unmount", async () => {
    const pending = deferred();
    crewService.myAttendance.mockImplementationOnce(() => pending.promise);
    const { result, unmount } = renderHook(() => useCrewSession("me"));
    await waitFor(() => expect(crewService.myAttendance).toHaveBeenCalledTimes(1));
    act(() => result.current.replaceSession(null));
    expect(result.current.data.attendance).toEqual([]);
    unmount();
    await act(async () => { pending.reject(new Error("expired")); await Promise.resolve(); });
    expect(localStorage.getItem("feedx.crew.session")).toBeNull();
  });

  it("lets only the latest current-token refresh apply and preserves replacement notice", async () => {
    const pending = deferred();
    crewService.myAttendance.mockImplementationOnce(() => pending.promise);
    const { result } = renderHook(() => useCrewSession("me"));
    await waitFor(() => expect(crewService.myAttendance).toHaveBeenCalledTimes(1));
    await act(async () => { await result.current.refresh(); });
    await act(async () => { pending.resolve([{ owner: "older" }]); await Promise.resolve(); });
    expect(result.current.data.attendance).toEqual([{ owner: "A" }]);
    act(() => result.current.replaceSession(session("A-new"), { passcodeChanged: true }));
    await waitFor(() => expect(result.current.data.profile?.owner).toBe("A-new"));
    expect(result.current.passcodeSuccess).toBe(true);
  });
});
