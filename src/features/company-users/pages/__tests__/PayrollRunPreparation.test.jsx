import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
const mocks = vi.hoisted(() => ({ readTime: vi.fn(), readCalculation: vi.fn(), readStatutory: vi.fn(), readPcb: vi.fn(), readPreparation: vi.fn() }));
vi.mock("../../../../services/payrollService.js", () => ({ payrollService: mocks }));
import PayrollRunEmployeesPanel from "../PayrollRunEmployeesPanel.jsx";
afterEach(cleanup);
beforeEach(() => {
  mocks.readTime.mockResolvedValue([]);
  mocks.readCalculation.mockResolvedValue({ results: [], adjustments: [{ id: "line", employee_id: "employee", component_name: "Deduction", component_type: "deduction", amount: 50, reason: "Approved period adjustment" }] });
  mocks.readStatutory.mockResolvedValue({ results: [] });
  mocks.readPcb.mockResolvedValue({ results: [{ employee_id: "employee", applicable: false }] });
  mocks.readPreparation.mockResolvedValue({ results: [{ employee_id: "employee", time_relevant: false, projection: { status: "ready", lines: [] }, statutory_setup: { schemes: { pcb: { applicable: false, state: "not_applicable" } } } }] });
});
const props = { run: { id: "run", status: "draft" }, entityId: "entity", month: "2026-09", canManage: true, data: { employees: [{ id: "employee", name: "QA Employee" }], profiles: [{ employee_id: "employee", compensation: [{ effective_from: "2026-01-01", pay_basis: "monthly", basic_salary: 2000 }], statutory: [{ effective_from: "2026-01-01", pcb_applicable: false }] }] } };
it("keeps monthly time irrelevant and displays persisted deductions before calculation", async () => {
  render(<PayrollRunEmployeesPanel {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "All", exact: true }));
  await screen.findByText("QA Employee");
  expect(screen.getByText("Not required")).toBeTruthy();
  expect(screen.getByText(/1 adjustment/)).toBeTruthy();
  expect(screen.queryByText("Confirm amount")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Review", exact: true }));
  expect(screen.getByText("Deduction")).toBeTruthy();
  expect(screen.getByText("Approved period adjustment · Saved")).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Time & Attendance" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Confirm PCB" })).toBeNull();
});
it("still exposes time-dependent employee evidence", async () => {
  mocks.readPreparation.mockResolvedValue({ results: [{ employee_id: "employee", time_relevant: true, projection: { status: "review_required", issues: ["unreconciled_time:2026-09-01"], lines: [] } }] });
  render(<PayrollRunEmployeesPanel {...props} />);
  await screen.findByText("QA Employee");
  expect(screen.getByText("Time evidence required")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Review", exact: true }));
  expect(screen.getByRole("heading", { name: "Time & Attendance" })).toBeTruthy();
});
