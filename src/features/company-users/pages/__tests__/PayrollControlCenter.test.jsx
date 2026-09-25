import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  read: vi.fn(), time: vi.fn(), calculation: vi.fn(), statutory: vi.fn(),
  readTime: vi.fn(), readCalculation: vi.fn(), readStatutory: vi.fn(), readPcb: vi.fn(), readRules: vi.fn(),
  readComponentHistory: vi.fn(),
  readHolidayApplicability: vi.fn(),
}));
vi.mock("../../../../services/payrollService.js", () => ({ payrollService: {
  read: mocks.read, runTimeReadiness: mocks.time, calculationReadiness: mocks.calculation,
  statutoryReadiness: mocks.statutory, readTime: mocks.readTime,
  readCalculation: mocks.readCalculation, readStatutory: mocks.readStatutory,
  readPcb: mocks.readPcb, readRules: mocks.readRules,
  readComponentHistory: mocks.readComponentHistory,
  readHolidayApplicability: mocks.readHolidayApplicability,
} }));
vi.mock("../../../../utils/accessControl.js", () => ({ hasPermission: () => true }));

import PayrollPage from "../PayrollPage.jsx";

const fixture = {
  legal_entities: [{ id: "entity-1", name: "QA Employer" }],
  employees: [{ id: "employee-1", name: "QA Employee", employee_code: "QA-001", legal_entity_id: "entity-1" }],
  profiles: [], components: [], holidays: [], periods: [{ id: "period-1", legal_entity_id: "entity-1",
    period_start: "2026-09-01", period_end: "2026-09-30", runs: [{ id: "run-1", status: "review_required", revision: 1 }] }],
};

beforeEach(() => {
  mocks.read.mockReset().mockResolvedValue(fixture);
  mocks.time.mockReset().mockResolvedValue({ ready: false, unresolved: 1, unreconciled: 0, stale: 0 });
  mocks.calculation.mockReset().mockResolvedValue({ ready: false, review_required: 0, uncalculated: 1, stale: 0 });
  mocks.statutory.mockReset().mockResolvedValue({ ready: false, review_required: 0, uncalculated: 1, stale: 0 });
  mocks.readTime.mockReset().mockResolvedValue([]);
  mocks.readCalculation.mockReset().mockResolvedValue({ results: [], adjustments: [] });
  mocks.readStatutory.mockReset().mockResolvedValue({ results: [] });
  mocks.readPcb.mockReset().mockResolvedValue({ results: [] });
  mocks.readRules.mockReset().mockResolvedValue([]);
  mocks.readComponentHistory.mockReset().mockResolvedValue([]);
  mocks.readHolidayApplicability.mockReset().mockResolvedValue({ outlets: [], legal_entities: [] });
});
afterEach(cleanup);

describe("Payroll Control Center", () => {
  it("uses four user-facing destinations and routes a time blocker into the run", async () => {
    render(<PayrollPage auth={{}} />);
    await screen.findByRole("heading", { name: /QA Employer.*2026-09/ });
    expect(screen.getByRole("navigation", { name: "Payroll sections" }).textContent).toBe("OverviewEmployeesPayroll RunsSettings");
    await screen.findByText("1 time exceptions · 0 unreconciled");
    fireEvent.click(screen.getByRole("button", { name: /Review time →/ }));
    expect(screen.getByRole("navigation", { name: "Payroll Run steps" })).not.toBeNull();
    await screen.findByText("No time results for this month. Reconcile source evidence to evaluate payable time.");
    expect(mocks.readTime).toHaveBeenCalledWith("entity-1", "2026-09-01", "2026-09-30");
  });

  it("keeps employee setup and advanced rule publishing progressively disclosed", async () => {
    render(<PayrollPage auth={{}} />);
    await screen.findByRole("heading", { name: /QA Employer.*2026-09/ });
    fireEvent.click(screen.getByRole("button", { name: "Employees" }));
    expect(screen.getAllByText("Set Up Employee").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByText("Manual confirmation")).not.toBeNull();
    expect(mocks.readRules).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Advanced \/ Version History/ }));
    await waitFor(() => expect(mocks.readRules).toHaveBeenCalled());
  });

  it("opens a finalized revision on its immutable summary, not preparation", async () => {
    mocks.read.mockResolvedValueOnce({ ...fixture, periods: [{ ...fixture.periods[0], runs: [{
      id: "run-final", status: "finalized", revision: 2, finalized_at: "2026-09-30T12:00:00Z",
      finalized_by_employee_id: "employee-outside-entity", finalized_by_name: "QA Approver",
    }] }] });
    render(<PayrollPage auth={{}} />);
    await screen.findByRole("heading", { name: /QA Employer.*2026-09/ });
    expect(screen.getByRole("button", { name: /View Finalized Payroll/ })).not.toBeNull();
    expect(screen.getByText("Payroll finalized. The current revision is read-only; any correction creates a new revision.")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /2026-09 · Revision 2/ }));
    await screen.findByText("Revision 2 is immutable. Corrections require a new revision; this evidence is retained.");
    expect(screen.getByText(/QA Approver/)).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Finalize Payroll" })).toBeNull();
  });

  it("filters employees and opens setup-required employees in read-only detail", async () => {
    mocks.read.mockResolvedValueOnce({ ...fixture, employees: [
      ...fixture.employees, { id: "employee-2", name: "Another Employee", employee_code: "QA-002", legal_entity_id: "entity-1" },
    ] });
    render(<PayrollPage auth={{}} />);
    await screen.findByRole("heading", { name: /QA Employer.*2026-09/ });
    fireEvent.click(screen.getByRole("button", { name: "Employees" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search" }), { target: { value: "QA-001" } });
    expect(screen.getByText("QA Employee")).not.toBeNull();
    expect(screen.queryByText("Another Employee")).toBeNull();
    fireEvent.click(screen.getByText("QA Employee"));
    expect(screen.getByRole("dialog")).not.toBeNull();
    expect(screen.getByText(/Pay has not been set up/)).not.toBeNull();
    expect(screen.queryByRole("textbox", { name: "Reason / provenance" })).toBeNull();
  });
});
