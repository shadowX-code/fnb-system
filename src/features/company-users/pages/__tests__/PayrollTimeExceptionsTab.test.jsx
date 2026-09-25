import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ read: vi.fn(), reconcile: vi.fn(), decide: vi.fn() }));
vi.mock("../../../../services/payrollService.js", () => ({ payrollService: {
  readTime: mocks.read, reconcileTime: mocks.reconcile, decideTime: mocks.decide,
} }));

import PayrollTimeExceptionsTab from "../PayrollTimeExceptionsTab.jsx";

const data = { legal_entities: [{ id: "entity-1", display_name: "QA Employer" }] };
const early = {
  id: "time-1", employee_id: "employee-1", employee_name: "QA Hourly Employee",
  employee_code: "QA-001", pay_basis: "hourly", work_date: "2026-09-24",
  revision: 1, status: "review_required", issue_codes: ["early_departure"],
  classification: "regular", scheduled_minutes: 510, actual_minutes: 360,
  proposed_minutes: 270, approved_minutes: null, approved_extra_minutes: 0,
  evidence: {
    scheduled_start_at: "2026-09-24T04:00:00Z", scheduled_end_at: "2026-09-24T14:00:00Z",
    clock_in_at: "2026-09-24T04:00:00Z", clock_out_at: "2026-09-24T10:00:00Z",
    roster_break_minutes: 90, roster_entry_id: "roster-1", attendance_id: "attendance-1",
    extra_candidate_minutes: 0,
  },
  history: [{ id: "time-1", revision: 1, status: "review_required", approved_minutes: null }],
};

beforeEach(() => {
  mocks.read.mockReset().mockResolvedValue([early]);
  mocks.reconcile.mockReset().mockResolvedValue({ created: 0, unchanged: 1 });
  mocks.decide.mockReset().mockResolvedValue({ id: "time-2", status: "approved_manual" });
});
afterEach(cleanup);

describe("Payroll Time Exceptions workspace", () => {
  it("reviews canonical evidence and sends a reasoned Payroll-only decision", async () => {
    render(<PayrollTimeExceptionsTab data={data} canManage />);
    await screen.findByText("QA Hourly Employee");
    expect(screen.getByText("Early Departure")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(screen.getByText("Published Roster")).not.toBeNull();
    expect(screen.getByText("Attendance")).not.toBeNull();
    fireEvent.change(screen.getByLabelText(/Decision reason/), { target: { value: "Reviewed early departure evidence" } });
    fireEvent.click(screen.getByRole("button", { name: "Record Decision" }));
    await waitFor(() => expect(mocks.decide).toHaveBeenCalledWith({
      id: "time-1", action: "approve", approvedMinutes: 270, extraMinutes: 0,
      classification: "regular", reason: "Reviewed early departure evidence",
    }));
  });

  it("keeps approved normal shifts out of the default exception queue", async () => {
    mocks.read.mockResolvedValueOnce([{ ...early, id: "time-2", status: "approved_auto", issue_codes: [], approved_minutes: 510 }]);
    render(<PayrollTimeExceptionsTab data={data} canManage={false} />);
    await screen.findByText("No Time Exceptions require review.");
    expect(screen.queryByText("QA Hourly Employee")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show all results" }));
    expect(screen.getByText("QA Hourly Employee")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Reconcile Evidence" })).toBeNull();
  });
});
