import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "../App.jsx";

const mocks = vi.hoisted(() => ({
  session: { user: { id: "admin", email: "test@example.test" } },
  getSession: vi.fn(), getUserContext: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn(),
  signIn: vi.fn(), recovery: vi.fn(), reads: vi.fn(), crewMount: vi.fn(), crewUnmount: vi.fn(),
}));
vi.mock("../../auth/authService.js", () => ({ authService: {
  getSession: mocks.getSession, getUserContext: mocks.getUserContext,
  onAuthStateChange: mocks.subscribe, signInWithPassword: mocks.signIn,
  setSessionFromRecoveryTokens: mocks.recovery, isPasswordSetupRequiredError: () => false,
} }));
vi.mock("../../features/crew/CrewMobileApp.jsx", async () => {
  const { useEffect, useState } = await import("react");
  const { default: useCrewRoute } = await import("../../features/crew/hooks/useCrewRoute.js");
  return { default: function CrewProbe() {
    const route = useCrewRoute();
    const [count, setCount] = useState(0);
    useEffect(() => { mocks.crewMount(); return mocks.crewUnmount; }, []);
    return <><h1>Crew {route.screen}</h1><button onClick={() => { setCount(count + 1); route.navigate("learn"); }}>Learn {count}</button></>;
  } };
});
vi.mock("../routes.jsx", () => ({ salesPurchaseRoutes: [
  { id: "dashboard", label: "Dashboard", permission: "dashboard.view", component: () => <h1>Dashboard probe</h1> },
  { id: "reports", label: "Reports", permission: "reports.view", component: () => <h1>Reports probe</h1> },
  { id: "crew_dashboard", label: "Crew Admin", permission: "dashboard.view", component: () => <h1>Crew Admin probe</h1> },
] }));
vi.mock("../../layouts/AppShell.jsx", () => ({ default: ({ children }) => <main aria-label="Admin shell">{children}</main> }));
vi.mock("../../features/crew/CrewGuestFeedback.jsx", () => ({ default: () => <h1>Feedback probe</h1>, isPublicFeedbackRoute: () => window.location.hash.startsWith("#feedback") || window.location.pathname.startsWith("/feedback/") }));
vi.mock("../../features/sales-purchase/services/operationsService.js", () => ({ operationsService: { getBootstrapData: () => ({ outlets: [], purchaseCategories: [] }) } }));
vi.mock("../../services/outletService.js", () => ({ outletService: { listActiveOutlets: mocks.reads } }));
vi.mock("../../services/supplierService.js", () => ({ supplierService: { listSuppliers: mocks.reads } }));
vi.mock("../../services/purchaseCategoryService.js", () => ({ purchaseCategoryService: { listPurchaseCategories: mocks.reads } }));
vi.mock("../../services/salesChannelService.js", () => ({ salesChannelService: { listSalesChannels: mocks.reads } }));
vi.mock("../../services/outletTaxConfigService.js", () => ({ outletTaxConfigService: { listOutletTaxConfigs: mocks.reads } }));
vi.mock("../../services/salesRecordService.js", () => ({ salesRecordService: { listSalesRecords: mocks.reads } }));
vi.mock("../../services/purchaseRecordService.js", () => ({ purchaseRecordService: { listPurchaseRecords: mocks.reads } }));
vi.mock("../../services/operatingExpenseService.js", () => ({ operatingExpenseService: { listOperatingExpenses: mocks.reads } }));

function visit(hash, event = "hashchange") {
  act(() => {
    window.history.replaceState(null, "", `/${hash}`);
    window.dispatchEvent(new Event(event));
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.getSession.mockResolvedValue(mocks.session);
  mocks.getUserContext.mockResolvedValue({ profile: { id: "employee-admin", role_name: "Owner" }, permissions: ["dashboard.view", "reports.view"], source: "database" });
  mocks.subscribe.mockReturnValue({ data: { subscription: { unsubscribe: mocks.unsubscribe } } });
  mocks.reads.mockResolvedValue([]);
  mocks.signIn.mockResolvedValue({ session: mocks.session });
  mocks.recovery.mockResolvedValue(mocks.session);
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it.each(["#crew", "#crew/home", "#crew/not-a-route", "#crew/growth/performance"])("restores %s without mounting Admin Auth or master-data reads", async (hash) => {
  visit(hash);
  render(<App />);
  expect(await screen.findByRole("heading", { name: /Crew (home|growth)/ })).toBeTruthy();
  expect(mocks.getSession).not.toHaveBeenCalled();
  expect(mocks.subscribe).not.toHaveBeenCalled();
  expect(mocks.reads).not.toHaveBeenCalled();
  expect(screen.queryByText(/Smart Operations/)).toBeNull();
  expect(window.location.hash).toBe(hash.includes("performance") ? hash : "#crew/home");
});

it("keeps Crew mounted for internal navigation and history, then recovers Admin on entry switch", async () => {
  visit("#crew/home");
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Learn 0" }));
  expect(window.location.hash).toBe("#crew/learn");
  visit("#crew/home", "popstate");
  visit("#crew/learn", "popstate");
  expect(screen.getByRole("button", { name: "Learn 1" })).toBeTruthy();
  expect(mocks.crewMount).toHaveBeenCalledTimes(1);
  visit("#dashboard", "popstate");
  expect(await screen.findByRole("heading", { name: "Dashboard probe" })).toBeTruthy();
  expect(mocks.crewUnmount).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(mocks.reads).toHaveBeenCalledTimes(8));
  visit("#crew/reward");
  expect(await screen.findByRole("heading", { name: "Crew reward" })).toBeTruthy();
  expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
  expect(screen.queryByLabelText("Admin shell")).toBeNull();
});

it.each(["#dashboard", "#reports", "#crew_dashboard"])("recovers Admin session and route %s without mounting Crew", async (hash) => {
  visit(hash);
  const view = render(<App />);
  expect(await screen.findByRole("heading", { name: /probe/ })).toBeTruthy();
  expect(mocks.getUserContext).toHaveBeenCalledWith(mocks.session.user);
  await waitFor(() => expect(mocks.reads).toHaveBeenCalledTimes(8));
  expect(mocks.crewMount).not.toHaveBeenCalled();
  view.unmount();
  render(<App />);
  expect(await screen.findByRole("heading", { name: /probe/ })).toBeTruthy();
  expect(window.location.hash).toBe(hash);
});

it("supports anonymous Admin login through the unchanged AuthProvider", async () => {
  mocks.getSession.mockResolvedValue(null);
  visit("#dashboard");
  render(<App />);
  fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "test@example.test" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "test-password" } });
  fireEvent.submit(screen.getByLabelText("Email").closest("form"));
  expect(await screen.findByRole("heading", { name: "Dashboard probe" })).toBeTruthy();
  expect(mocks.signIn).toHaveBeenCalledWith({ email: "test@example.test", password: "test-password" });
});

it("retains password recovery without Admin master-data bootstrap", async () => {
  visit("#type=recovery&access_token=fixture-access&refresh_token=fixture-refresh");
  render(<App />);
  await waitFor(() => expect(window.location.pathname).toBe("/setup-password"));
  expect(mocks.recovery).toHaveBeenCalledWith({ accessToken: "fixture-access", refreshToken: "fixture-refresh" });
  expect(mocks.reads).not.toHaveBeenCalled();
  expect(mocks.crewMount).not.toHaveBeenCalled();
});

it("discards a pending Admin session restoration when entering Crew", async () => {
  let resolve;
  mocks.getSession.mockReturnValue(new Promise((done) => { resolve = done; }));
  visit("#dashboard");
  render(<App />);
  await waitFor(() => expect(mocks.getSession).toHaveBeenCalled());
  visit("#crew/home");
  expect(await screen.findByRole("heading", { name: "Crew home" })).toBeTruthy();
  await act(async () => resolve(mocks.session));
  expect(mocks.getUserContext).not.toHaveBeenCalled();
  expect(mocks.reads).not.toHaveBeenCalled();
  expect(screen.queryByText(/Smart Operations/)).toBeNull();
});

it("keeps permission denial in Admin without admitting Crew identity", async () => {
  mocks.getUserContext.mockResolvedValue({ profile: { id: "limited", role_name: "Custom" }, permissions: [], source: "database" });
  visit("#reports");
  render(<App />);
  expect(await screen.findByRole("heading", { name: "No modules are available for your role" })).toBeTruthy();
  expect(screen.queryByText("Reports probe")).toBeNull();
  expect(mocks.crewMount).not.toHaveBeenCalled();
});

it("does not apply pending Admin master data after switching to Crew", async () => {
  let resolve;
  const pending = new Promise((done) => { resolve = done; });
  mocks.reads.mockReturnValue(pending);
  visit("#dashboard");
  render(<App />);
  await waitFor(() => expect(mocks.reads).toHaveBeenCalledTimes(8));
  visit("#crew/home");
  expect(await screen.findByRole("heading", { name: "Crew home" })).toBeTruthy();
  await act(async () => resolve([]));
  expect(screen.queryByLabelText("Admin shell")).toBeNull();
  expect(localStorage.getItem("feedx.cachedOutlets")).toBeNull();
});
