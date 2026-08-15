import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  leaveAdminData: vi.fn(),
  reviewLeave: vi.fn(),
  adjustLeaveBalance: vi.fn(),
  leaveAdjustmentHistory: vi.fn(),
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

const adjustmentHistory = [{
  id: "adjustment-1",
  entitlement_id: "employee-a-annual",
  leave_type: "annual",
  amount: 2,
  reason: "Manual entitlement correction",
  adjusted_at: "2026-08-15T03:30:00Z",
  adjusted_by: { id: "admin-1", name: "Isaac" },
  previous_available: 5.5,
  resulting_available: 7.5,
}];

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
  mocks.leaveAdjustmentHistory.mockReset().mockResolvedValue(adjustmentHistory);
  mocks.saveLeavePolicy.mockReset().mockResolvedValue({});
  ui.notify.mockReset();
});

afterEach(cleanup);

describe("Crew Leave Admin UI", () => {
  it("keeps the outlet in the unified toolbar and renders compact request hierarchy", async () => {
    render(<CrewLeaveAdminPage auth={auth} store={store} ui={ui} />);
    expect(await screen.findByText("Alex Tan")).not.toBeNull();
    expect(screen.getByPlaceholderText("Search employee name or position")).not.toBeNull();
    expect(screen.getByText("1 conflict")).not.toBeNull();
    expect(screen.queryByText("None")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    const dialog = screen.getByRole("dialog", { name: "Leave Request" });
    for (const label of ["Balance summary", "Roster impact", "Remaining after approval"]) expect(within(dialog).getByText(label)).not.toBeNull();
    expect(within(dialog).getByText("20/08/2026 – 21/08/2026 · 2 days")).not.toBeNull();
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
    for (const label of ["Annual Leave", "Medical Leave / MC", "Unpaid Leave", "Other Leave", "Entitled", "Used", "Pending", "Available", "Adjustment History"]) expect(within(dialog).getAllByText(label).length).toBeGreaterThan(0);
    expect(await within(dialog).findByText("Manual entitlement correction")).not.toBeNull();
    expect(within(dialog).getByText("7.5 days")).not.toBeNull();
    fireEvent.click(within(dialog).getAllByRole("button", { name: /Adjust/ })[0]);
    const adjustDialog = screen.getByRole("dialog", { name: "Adjust Leave Balance" });
    expect(within(adjustDialog).getByText("Current available")).not.toBeNull();
    expect(within(adjustDialog).getByText("New available")).not.toBeNull();
  });

  it("uses an eye action for finalized requests and keeps pending requests reviewable", async () => {
    mocks.leaveAdminData.mockResolvedValueOnce({ ...data, requests: [data.requests[0], { ...data.requests[0], id: "request-2", status: "approved" }] });
    render(<CrewLeaveAdminPage auth={auth} store={store} ui={ui} />);
    expect(await screen.findByRole("button", { name: "Review" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "View leave request for Alex Tan" })).not.toBeNull();
  });

  it("refreshes balances and immutable adjustment history after save", async () => {
    render(<CrewLeaveAdminPage auth={auth} store={store} ui={ui} />);
    await screen.findByText("Alex Tan");
    fireEvent.click(screen.getByRole("tab", { name: "Balances" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Manage" })[0]);
    const detail = await screen.findByRole("dialog", { name: "Leave Balance" });
    fireEvent.click(within(detail).getAllByRole("button", { name: /Adjust/ })[0]);
    const dialog = screen.getByRole("dialog", { name: "Adjust Leave Balance" });
    fireEvent.change(within(dialog).getByPlaceholderText("+ / -"), { target: { value: "2" } });
    fireEvent.change(within(dialog).getByPlaceholderText("Reason for this permanent adjustment"), { target: { value: "Manual entitlement correction" } });
    expect(within(dialog).getByText("11 days")).not.toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Adjustment" }));
    expect(await screen.findByRole("dialog", { name: "Leave Balance" })).not.toBeNull();
    expect(mocks.adjustLeaveBalance).toHaveBeenCalledWith("employee-a-annual", 2, "Manual entitlement correction");
    expect(mocks.leaveAdminData).toHaveBeenCalledTimes(2);
    expect(mocks.leaveAdjustmentHistory).toHaveBeenCalledTimes(2);
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
