import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import useCrewSession from "../hooks/useCrewSession.js";
import { crewService } from "../../../services/crewService.js";
import "../../../i18n/index.js";

vi.mock("../../../services/crewService.js", () => ({ crewService: Object.fromEntries(["changePasscode", "myAttendance", "attendanceContext", "growthMobile", "performanceMobile", "rewardMobile", "operationsToday", "myRoster", "myLeave", "myProfile"].map((name) => [name, vi.fn()])) }));
const session = (token) => ({ token, expires_at: "2099-01-01", employee: { id: token } });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
beforeEach(() => {
  localStorage.setItem("feedx.crew.session", JSON.stringify(session("A")));
  for (const fn of Object.values(crewService)) fn.mockReset().mockImplementation(async (token) => ({ owner: token }));
  crewService.myAttendance.mockImplementation(async (token) => [{ owner: token }]);
});
afterEach(() => { cleanup(); localStorage.clear(); });

describe("Crew session orchestration", () => {
  it("keeps token rotation owned by the session after its initiating screen leaves", async () => {
    const pending = deferred();
    crewService.changePasscode.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(useCrewSession);
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
    const { result, unmount } = renderHook(useCrewSession);
    let request;
    act(() => { request = result.current.changePasscode("1234", "5678"); });
    if (mode === "unmount") unmount();
    else act(() => result.current.replaceSession(mode === "logout" ? null : session("B")));
    await act(async () => { pending.resolve(session("stale-rotation")); expect(await request).toBe(false); });
    expect(JSON.parse(localStorage.getItem("feedx.crew.session"))?.token).toBe(mode === "logout" ? undefined : mode === "replacement" ? "B" : "A");
  });

  it.each(["success", "failure"])("discards stale A %s after replacement and clears every projection", async (outcome) => {
    const pending = deferred();
    const { result } = renderHook(useCrewSession);
    await waitFor(() => expect(result.current.data.profile?.owner).toBe("A"));
    const oldRefresh = result.current.refresh;
    crewService.myAttendance.mockImplementationOnce(() => pending.promise);
    let oldRequest;
    act(() => { oldRequest = oldRefresh(); });
    act(() => { result.current.replaceSession(session("B")); });
    expect(result.current.data.profile).toBeNull();
    expect(result.current.data.growth).toBeNull();
    expect(result.current.data.reward).toBeNull();
    expect(result.current.data.operations).toBeNull();
    await waitFor(() => expect(result.current.data.profile?.owner).toBe("B"));
    await act(async () => { outcome === "success" ? pending.resolve([{ owner: "A" }]) : pending.reject(new Error("A revoked")); await oldRequest; });
    expect(result.current.session.token).toBe("B");
    expect(result.current.data.attendance).toEqual([{ owner: "B" }]);
    expect(result.current.data.reward.owner).toBe("B");
    await act(async () => { expect(await oldRefresh()).toBe(false); });
    expect(JSON.parse(localStorage.getItem("feedx.crew.session")).token).toBe("B");
  });

  it("invalidates a pending refresh on logout and on unmount", async () => {
    const pending = deferred();
    crewService.myAttendance.mockImplementationOnce(() => pending.promise);
    const { result, unmount } = renderHook(useCrewSession);
    act(() => result.current.replaceSession(null));
    expect(result.current.data.attendance).toEqual([]);
    unmount();
    await act(async () => { pending.reject(new Error("expired")); await Promise.resolve(); });
    expect(localStorage.getItem("feedx.crew.session")).toBeNull();
  });

  it("lets only the latest current-token refresh apply and preserves replacement notice", async () => {
    const pending = deferred();
    crewService.myAttendance.mockImplementationOnce(() => pending.promise);
    const { result } = renderHook(useCrewSession);
    await act(async () => { await result.current.refresh(); });
    await act(async () => { pending.resolve([{ owner: "older" }]); await Promise.resolve(); });
    expect(result.current.data.attendance).toEqual([{ owner: "A" }]);
    act(() => result.current.replaceSession(session("A-new"), { passcodeChanged: true }));
    await waitFor(() => expect(result.current.data.profile?.owner).toBe("A-new"));
    expect(result.current.passcodeSuccess).toBe(true);
  });
});
