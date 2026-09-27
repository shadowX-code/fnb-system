import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ read: vi.fn(), reconcile: vi.fn(), decide: vi.fn() }));
vi.mock("../../../../services/payrollService.js", () => ({ payrollService: {
  readTime: mocks.read, reconcileTime: mocks.reconcile, decideTime: mocks.decide,
} }));

import { DecisionModal } from "../PayrollTimeExceptionsTab.jsx";

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
    render(<DecisionModal row={early} onClose={() => {}} onSaved={() => {}} />);
    expect(screen.getByText("Early Departure")).not.toBeNull();
    expect(screen.getByText("Published Roster")).not.toBeNull();
    expect(screen.getByText("Attendance")).not.toBeNull();
    fireEvent.change(screen.getByLabelText(/Decision reason/), { target: { value: "Reviewed early departure evidence" } });
    fireEvent.click(screen.getByRole("button", { name: "Record Decision" }));
    await waitFor(() => expect(mocks.decide).toHaveBeenCalledWith({
      id: "time-1", action: "approve", approvedMinutes: 270, extraMinutes: 0,
      classification: "regular", reason: "Reviewed early departure evidence",
    }));
  });

  it("requires a reason and preserves source-only review", () => {
    render(<DecisionModal row={early} onClose={() => {}} onSaved={() => {}} />);
    expect(screen.getByRole("button", { name: "Record Decision" }).disabled).toBe(true);
    expect(mocks.decide).not.toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });
});
