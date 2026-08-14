import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  leaveAdminData: vi.fn(),
  reviewLeave: vi.fn(),
  adjustLeaveBalance: vi.fn(),
  saveLeavePolicy: vi.fn(),
}));

vi.mock("../../../../services/crewService.js", () => ({ crewService: mocks }));

import CrewLeaveAdminPage from "../CrewLeaveAdminPage.jsx";

const employees = [
  { id: "employee-a", name: "Alex Tan", position: "Service Crew" },
  { id: "employee-b", name: "Bea Lim", position: "Kitchen Crew" },
];

function balance(employee, leaveType, overrides = {}) {
  const unlimited = ["unpaid", "other"].includes(leaveType);
  return {
    entitlement_id: `${employee.id}-${leaveType}`,
    employee_id: employee.id,
    employee,
    leave_type: leaveType,
    entitled: unlimited ? null : leaveType === "annual" ? 12 : 14,
    used: unlimited ? null : 2,
    pending: unlimited ? null : 1,
    available: unlimited ? null : leaveType === "annual" ? 9 : 11,
    balance_enforced: !unlimited,
    period_start: "2026-01-01",
    period_end: "2026-12-31",
    ...overrides,
  };
}

const data = {
  requests: [{
    id: "request-1",
    employee: employees[0],
    outlet: { id: "outlet-1", name: "Friends Corner" },
    leave_type: "annual",
    start_date: "2026-08-20",
    end_date: "2026-08-21",
    requested_days: 2,
    reason: "Family commitment",
    status: "pending",
    balance_context: balance(employees[0], "annual"),
    roster_context: [{ date: "2026-08-20", schedule: { entry_type: "working", start_time: "10:00", end_time: "18:00", outlet_name: "Friends Corner" } }],
  }],
  balances: employees.flatMap((employee) => ["annual", "medical", "unpaid", "other"].map((type) => balance(employee, type))),
  policies: [
    { id: "policy-annual", leave_type: "annual", annual_days: 12, balance_enforced: true, proration_enabled: true, carry_forward_enabled: true, max_carry_forward_days: 5, carry_forward_expiry_month: 3, carry_forward_expiry_day: 31 },
    { id: "policy-unpaid", leave_type: "unpaid", annual_days: 0, balance_enforced: false, proration_enabled: false, carry_forward_enabled: false, max_carry_forward_days: 0 },
  ],
};

const auth = {
  canAccessOutlet: () => true,
  hasPermission: () => true,
};
const store = { outlets: [{ id: "outlet-1", name: "Friends Corner" }] };
const ui = { notify: vi.fn() };

beforeEach(() => {
  mocks.leaveAdminData.mockReset().mockResolvedValue(data);
  mocks.reviewLeave.mockReset().mockResolvedValue({});
  mocks.adjustLeaveBalance.mockReset().mockResolvedValue({});
  mocks.saveLeavePolicy.mockReset().mockResolvedValue({});
  ui.notify.mockReset();
});

afterEach(cleanup);

describe("Crew Leave Admin UI", () => {
  it("keeps the outlet in the unified toolbar and renders compact request hierarchy", async () => {
    render(<CrewLeaveAdminPage auth={auth} store={store} ui={ui} />);
    expect(await screen.findByText("Alex Tan")).not.toBeNull();
    expect(screen.getByPlaceholderText("Search employee name or position")).not.toBeNull();
    expect(screen.getByText("1 shift conflict")).not.toBeNull();
    expect(screen.queryByText("None")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    const dialog = screen.getByRole("dialog", { name: "Leave Request" });
    for (const label of ["Request Summary", "Balance Context", "Roster Context", "After approval"]) expect(within(dialog).getByText(label)).not.toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Reject" }));
    expect(within(dialog).getByRole("button", { name: "Confirm Rejection" }).disabled).toBe(true);
    fireEvent.change(within(dialog).getByPlaceholderText("Explain why this request is rejected"), { target: { value: "Coverage unavailable" } });
    expect(within(dialog).getByRole("button", { name: "Confirm Rejection" }).disabled).toBe(false);
  });

  it("groups four entitlements into one row per employee and opens Manage detail", async () => {
    render(<CrewLeaveAdminPage auth={auth} store={store} ui={ui} />);
    await screen.findByText("Alex Tan");
    fireEvent.click(screen.getByRole("tab", { name: "Balances" }));
    expect(document.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(screen.getAllByText("Alex Tan")).toHaveLength(1);
    expect(screen.getAllByText("Unlimited").length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("button", { name: "Manage" })[0]);
    const dialog = screen.getByRole("dialog", { name: "Leave Balance" });
    for (const label of ["Annual Leave", "Medical Leave / MC", "Unpaid Leave", "Other Leave", "Entitled", "Used", "Pending", "Available"]) expect(within(dialog).getAllByText(label).length).toBeGreaterThan(0);
    fireEvent.click(within(dialog).getAllByRole("button", { name: /Adjust/ })[0]);
    expect(screen.getByRole("dialog", { name: "Adjust Leave Balance" })).not.toBeNull();
  });

  it("uses readable policy controls and hides entitlement fields for unlimited leave", async () => {
    render(<CrewLeaveAdminPage auth={auth} store={store} ui={ui} />);
    await screen.findByText("Alex Tan");
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    const rows = document.querySelectorAll("tbody tr");
    fireEvent.click(within(rows[0]).getByRole("button", { name: /Edit/ }));
    let dialog = screen.getByRole("dialog", { name: "Edit Annual Leave" });
    expect(within(dialog).getByText("Annual entitlement")).not.toBeNull();
    expect(within(dialog).getByText("Expiry month")).not.toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close modal" }));
    fireEvent.click(within(rows[1]).getByRole("button", { name: /Edit/ }));
    dialog = screen.getByRole("dialog", { name: "Edit Unpaid Leave" });
    expect(within(dialog).getByText("Unlimited leave")).not.toBeNull();
    expect(within(dialog).queryByText("Annual entitlement")).toBeNull();
  });

  it("shows retry and filter-no-results states", async () => {
    mocks.leaveAdminData.mockRejectedValueOnce(new Error("Staging read failed"));
    const first = render(<CrewLeaveAdminPage auth={auth} store={store} ui={ui} />);
    expect(await screen.findByRole("alert")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Retry" })).not.toBeNull();
    first.unmount();
    mocks.leaveAdminData.mockResolvedValue(data);
    render(<CrewLeaveAdminPage auth={auth} store={store} ui={ui} />);
    await screen.findByText("Alex Tan");
    fireEvent.change(screen.getByPlaceholderText("Search employee name or position"), { target: { value: "Nobody" } });
    expect(screen.getByText("No requests match these filters")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Clear filters" })).not.toBeNull();
  });
});
