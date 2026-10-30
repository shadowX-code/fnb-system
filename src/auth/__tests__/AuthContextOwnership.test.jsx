import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getSession: vi.fn(), getUserContext: vi.fn(), onAuthStateChange: vi.fn(), isPasswordSetupRequiredError: () => false }));
vi.mock("../authService.js", () => ({ authService: mocks }));
import { AuthProvider, useAuth } from "../AuthContext.jsx";
const session = { user: { id: "user-1" }, access_token: "test-session-1" };
let event;
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
const result = (name, permissions = ["factory_finished_goods.view"]) => ({ profile: { id: name, role_name: "staff" }, permissions, source: "employees" });
function Probe() { const auth=useAuth(); return <><span>{auth.loading || auth.contextLoading ? "Loading" : auth.error || auth.profile?.id || "Signed out"}</span><span>{auth.permissions.join(",")}</span><button onClick={auth.refreshContext}>Refresh permissions</button></>; }
beforeEach(() => { vi.clearAllMocks(); mocks.getSession.mockResolvedValue(session); mocks.onAuthStateChange.mockImplementation(callback => { event=callback; return { data: { subscription: { unsubscribe: vi.fn() } } }; }); });
afterEach(cleanup);
it("coalesces concurrent equivalent session events into one authorized context read", async () => {
 const pending=deferred(); mocks.getUserContext.mockReturnValue(pending.promise);
 render(<AuthProvider><Probe /></AuthProvider>);
 await waitFor(() => expect(mocks.getUserContext).toHaveBeenCalledTimes(1));
 act(() => { event("INITIAL_SESSION",session); event("SIGNED_IN",{...session}); });
 expect(mocks.getUserContext).toHaveBeenCalledTimes(1);
 await act(async () => pending.resolve(result("first")));
 expect(screen.getByText("first")).toBeTruthy();
});
it("does not let an obsolete context restore identity or permissions after sign-out", async () => {
 const pending=deferred(); mocks.getUserContext.mockReturnValue(pending.promise);
 render(<AuthProvider><Probe /></AuthProvider>);
 await waitFor(() => expect(mocks.getUserContext).toHaveBeenCalledTimes(1));
 await act(async () => event("SIGNED_OUT",null));
 await act(async () => pending.resolve(result("obsolete")));
 expect(screen.getByText("Signed out")).toBeTruthy(); expect(screen.queryByText("factory_finished_goods.view")).toBeNull();
});
it("keeps a new session authoritative when older success or failure arrives later", async () => {
 const old=deferred(), next=deferred(); mocks.getUserContext.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
 render(<AuthProvider><Probe /></AuthProvider>);
 await waitFor(() => expect(mocks.getUserContext).toHaveBeenCalledTimes(1));
 act(() => event("SIGNED_IN",{ user:{id:"user-2"}, access_token:"test-session-2" }));
 await act(async () => next.resolve(result("current",["factory_job_orders.view"])));
 await act(async () => old.reject(new Error("old failure")));
 expect(screen.getByText("current")).toBeTruthy(); expect(screen.getByText("factory_job_orders.view")).toBeTruthy();
});
it("explicit refresh bypasses in-flight coalescing and applies revoked permissions", async () => {
 const pending=deferred(); mocks.getUserContext.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(result("restricted",[]));
 render(<AuthProvider><Probe /></AuthProvider>);
 await waitFor(() => expect(mocks.getUserContext).toHaveBeenCalledTimes(1));
 fireEvent.click(screen.getByText("Refresh permissions"));
 await screen.findByText("restricted");
 await act(async () => pending.resolve(result("obsolete")));
 expect(screen.getByText("restricted")).toBeTruthy(); expect(screen.queryByText("factory_finished_goods.view")).toBeNull();
});
it("preserves canonical denial and never enters the workspace on context failure", async () => {
 mocks.getUserContext.mockRejectedValue(new Error("denied"));
 render(<AuthProvider><Probe /></AuthProvider>);
 expect(await screen.findByText("Unable to load your access permissions. Please contact admin.")).toBeTruthy();
 expect(screen.queryByText("factory_finished_goods.view")).toBeNull();
});
it("does not restore an old initial session after a sign-out event", async () => {
 const initial=deferred(); mocks.getSession.mockReturnValue(initial.promise);
 render(<AuthProvider><Probe /></AuthProvider>);
 await act(async () => event("SIGNED_OUT",null));
 await act(async () => initial.resolve(session));
 expect(screen.getByText("Signed out")).toBeTruthy(); expect(mocks.getUserContext).not.toHaveBeenCalled();
});
it("invalidates pending access context when password recovery takes ownership", async () => {
 const pending=deferred(); mocks.getUserContext.mockReturnValue(pending.promise);
 render(<AuthProvider><Probe /></AuthProvider>);
 await waitFor(() => expect(mocks.getUserContext).toHaveBeenCalledTimes(1));
 await act(async () => event("PASSWORD_RECOVERY",session));
 await act(async () => pending.resolve(result("obsolete")));
 expect(screen.queryByText("obsolete")).toBeNull(); expect(screen.queryByText("factory_finished_goods.view")).toBeNull();
});
