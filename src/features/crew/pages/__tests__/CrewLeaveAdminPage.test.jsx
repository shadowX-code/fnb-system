import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  leaveRequestsAdminPage: vi.fn(),
  leaveBalancesAdminPage: vi.fn(),
  leaveAdminPolicies: vi.fn(),
  leavePolicyEditContext: vi.fn(),
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
    prorated: unlimited ? 0 : leaveType === "annual" ? 12 : 14,
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
    { id: "policy-annual", outlet_id: "outlet-1", leave_type: "annual", annual_days: 12, balance_enforced: true, proration_enabled: true, proration_rule: "calendar_days", entitlement_method: "annual_allowance", eligible_employment_types: ["full_time", "part_time"], current_version_id: "version-annual", carry_forward_enabled: true, max_carry_forward_days: 5, carry_forward_expiry_month: 3, carry_forward_expiry_day: 31 },
    { id: "policy-unpaid", outlet_id: "outlet-1", leave_type: "unpaid", annual_days: 0, balance_enforced: false, proration_enabled: false, proration_rule: "none", entitlement_method: "unlimited", eligible_employment_types: ["full_time", "part_time"], current_version_id: "version-unpaid", carry_forward_enabled: false, max_carry_forward_days: 0 },
  ],
};

function groupedBalances(rows = data.balances) {
  const grouped = new Map();
  rows.forEach((row) => {
    const key = row.employee.id;
    if (!grouped.has(key)) grouped.set(key, { employee: row.employee, balances: {}, period_start: row.period_start, period_end: row.period_end });
    grouped.get(key).balances[row.leave_type] = row;
  });
  return [...grouped.values()];
}

const page = (rows) => ({ rows, totalCount: rows.length, page: 1, pageSize: 20 });

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
  mocks.leaveRequestsAdminPage.mockReset().mockResolvedValue(page(data.requests));
  mocks.leaveBalancesAdminPage.mockReset().mockResolvedValue(page(groupedBalances()));
  mocks.leaveAdminPolicies.mockReset().mockResolvedValue(data.policies);
  mocks.leavePolicyEditContext.mockReset().mockImplementation((outletId, leaveType, effectiveFrom) => {
    const policy = data.policies.find((row) => row.leave_type === leaveType);
    const historical = effectiveFrom < "2026-09-29";
    return Promise.resolve({ verified_cutover_from: "2026-09-29", historical,
      expected_version_id: historical ? null : policy.current_version_id,
      expected_next_version_id: historical ? policy.current_version_id : null,
      next_effective_from: historical ? "2026-09-29" : null,
      version: historical ? null : { ...policy, id: policy.current_version_id },
    });
  });
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
    await screen.findAllByRole("button", { name: "Manage" });
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

  it("labels an existing pre-cutover grant without claiming reconstructed eligibility evidence", async () => {
    render(<CrewLeaveAdminPage auth={auth} store={store} ui={ui} />);
    await screen.findByText("Alex Tan");
    fireEvent.click(screen.getByRole("tab", { name: "Balances" }));
    await screen.findAllByRole("button", { name: "Manage" });
    fireEvent.click(screen.getAllByRole("button", { name: "Manage" })[0]);
    const dialog = screen.getByRole("dialog", { name: "Leave Balance" });
    expect(within(dialog).getAllByText(/original employment eligibility and policy basis were not verified at cutover/).length).toBeGreaterThan(0);
    expect(within(dialog).getByText(/Existing grant: 12 days/)).not.toBeNull();
    expect(within(dialog).getAllByText(/Existing grant: Unlimited \/ no balance limit/).length).toBeGreaterThan(0);
    expect(within(dialog).queryByText(/days days/)).toBeNull();
  });

  it("uses an eye action for finalized requests and keeps pending requests reviewable", async () => {
    mocks.leaveRequestsAdminPage.mockResolvedValueOnce(page([data.requests[0], { ...data.requests[0], id: "request-2", status: "approved" }]));
    render(<CrewLeaveAdminPage auth={auth} store={store} ui={ui} />);
    expect(await screen.findByRole("button", { name: "Review" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "View leave request for Alex Tan" })).not.toBeNull();
  });

  it("refreshes balances and immutable adjustment history after save", async () => {
    render(<CrewLeaveAdminPage auth={auth} store={store} ui={ui} />);
    await screen.findByText("Alex Tan");
    fireEvent.click(screen.getByRole("tab", { name: "Balances" }));
    await screen.findAllByRole("button", { name: "Manage" });
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
    expect(mocks.leaveBalancesAdminPage).toHaveBeenCalledTimes(2);
    expect(mocks.leaveAdjustmentHistory).toHaveBeenCalledTimes(2);
  });

  it("uses readable policy controls and hides entitlement fields for unlimited leave", async () => {
    render(<CrewLeaveAdminPage auth={auth} store={store} ui={ui} />);
    await screen.findByText("Alex Tan");
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    await screen.findAllByRole("button", { name: /Edit/ });
    const rows = document.querySelectorAll("tbody tr");
    fireEvent.click(within(rows[0]).getByRole("button", { name: /Edit/ }));
    let dialog = screen.getByRole("dialog", { name: "Edit Annual Leave" });
    expect(await within(dialog).findByText("Annual entitlement")).not.toBeNull();
    expect(within(dialog).getByText("Expiry month")).not.toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close modal" }));
    fireEvent.click(within(rows[1]).getByRole("button", { name: /Edit/ }));
    dialog = screen.getByRole("dialog", { name: "Edit Unpaid Leave" });
    expect(await within(dialog).findByText("Unlimited / no balance limit")).not.toBeNull();
    expect(await within(dialog).findByText("Eligible Employment Types")).not.toBeNull();
    expect(within(dialog).queryByText("Annual entitlement")).toBeNull();
  });

  it("shows dated policy eligibility and a reason before saving a version", async () => {
    render(<CrewLeaveAdminPage auth={auth} store={store} ui={ui} />);
    await screen.findByText("Alex Tan");
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    await screen.findAllByRole("button", { name: /Edit/ });
    fireEvent.click(within(document.querySelectorAll("tbody tr")[0]).getByRole("button", { name: /Edit/ }));
    const dialog = screen.getByRole("dialog", { name: "Edit Annual Leave" });
    expect(await within(dialog).findByText("Eligible Employment Types")).not.toBeNull();
    expect(within(dialog).getByText("Proration Rule")).not.toBeNull();
    const confirm = within(dialog).getByRole("button", { name: "Confirm Policy" });
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByPlaceholderText("Why is this policy changing?"), { target: { value: "Eligibility update" } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.saveLeavePolicy).toHaveBeenCalledWith("outlet-1", "annual", expect.objectContaining({
      eligible_employment_types: ["full_time", "part_time"],
      entitlement_method: "annual_allowance",
      proration_rule: "calendar_days",
      expected_version_id: "version-annual",
      reason: "Eligibility update",
    })));
  });

  it("requires complete evidenced terms before saving a January historical baseline", async () => {
    render(<CrewLeaveAdminPage auth={auth} store={store} ui={ui} />);
    await screen.findByText("Alex Tan");
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    await screen.findAllByRole("button", { name: /Edit/ });
    fireEvent.click(within(document.querySelectorAll("tbody tr")[0]).getByRole("button", { name: /Edit/ }));
    const dialog = screen.getByRole("dialog", { name: "Edit Annual Leave" });
    fireEvent.change(within(dialog).getByPlaceholderText("28 May 2026"), { target: { value: "01/01/2026" } });
    expect(await within(dialog).findByText(/This date precedes the verified 29\/09\/2026 cutover/)).not.toBeNull();
    const confirm = within(dialog).getByRole("button", { name: "Establish Historical Policy" });
    expect(confirm.disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole("button", { name: "Select employment types" }));
    fireEvent.click(screen.getByRole("button", { name: "Full-Time" }));
    fireEvent.click(screen.getByRole("button", { name: "Part-Time" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Select method" }));
    fireEvent.click(screen.getByRole("button", { name: "Annual allowance" }));
    fireEvent.change(within(dialog).getByText("Annual entitlement").closest("label").querySelector("input"), { target: { value: "12" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Select rule" }));
    fireEvent.click(screen.getByRole("button", { name: "Eligible calendar days ÷ year days" }));
    fireEvent.change(within(dialog).getByPlaceholderText("Why does this policy apply from this earlier date?"), { target: { value: "Approved annual policy" } });
    fireEvent.change(within(dialog).getByPlaceholderText("Document title, approval reference or record location"), { target: { value: "HR policy 2026 section 4" } });
    expect(confirm.disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole("checkbox"));
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.saveLeavePolicy).toHaveBeenCalledWith("outlet-1", "annual", expect.objectContaining({
      effective_from: "2026-01-01", annual_days: 12, eligible_employment_types: ["full_time", "part_time"],
      evidence_reference: "HR policy 2026 section 4", historical_terms_verified: true,
      expected_version_id: null, expected_next_version_id: "version-annual",
    })));
  });

  it("shows retry and filter-no-results states", async () => {
    mocks.leaveRequestsAdminPage.mockRejectedValueOnce(new Error("Staging read failed"));
    render(<CrewLeaveAdminPage auth={auth} store={store} ui={ui} />);
    expect(await screen.findByRole("alert")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Alex Tan")).not.toBeNull();
    mocks.leaveRequestsAdminPage.mockImplementation(({ filters }) => Promise.resolve(page(filters.query ? [] : data.requests)));
    fireEvent.change(screen.getByPlaceholderText("Search employee name or position"), { target: { value: "Nobody" } });
    expect(await screen.findByText("No requests match these filters")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Clear all" })).not.toBeNull();
  });

  it("applies request filters and balance search through separate paged authorities", async () => {
    render(<CrewLeaveAdminPage auth={auth} store={store} ui={ui} />);
    await screen.findByText("Alex Tan");
    fireEvent.change(screen.getByPlaceholderText("Search employee name or position"), { target: { value: "Alex" } });
    await waitFor(() => expect(mocks.leaveRequestsAdminPage).toHaveBeenLastCalledWith(expect.objectContaining({ filters: { query: "Alex", type: "all", status: "all" }, page: 1 })));
    fireEvent.click(screen.getByRole("tab", { name: "Balances" }));
    await waitFor(() => expect(mocks.leaveBalancesAdminPage).toHaveBeenLastCalledWith(expect.objectContaining({ filters: { query: "Alex" }, page: 1 })));
  });
});
