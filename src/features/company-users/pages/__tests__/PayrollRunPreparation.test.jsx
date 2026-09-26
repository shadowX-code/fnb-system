import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const mocks = vi.hoisted(() => ({ readTime: vi.fn(), readCalculation: vi.fn(), readStatutory: vi.fn(), readPcb: vi.fn(), readPreparation: vi.fn(), recalculateEmployee: vi.fn(), reverseRunComponent: vi.fn() }));
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
  expect(screen.getByText("Deduction · Approved period adjustment · Saved")).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Time & Attendance" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Review Hours" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Confirm PCB" })).toBeNull();
});
it("resolves period-effective categories and PCB N/A beside current amounts", async () => {
  mocks.readCalculation.mockResolvedValue({ results: [{ employee_id: "employee", status: "ready", gross_earnings: 2000, lines: [{kind:"earning",label:"Basic Salary",amount:2000}] }], adjustments: [] });
  mocks.readStatutory.mockResolvedValue({ results: [{ employee_id:"employee",status:"ready", net_pay:1766.35, non_statutory_deductions:0, lines:[
    {scheme:"epf",applicable:true,employee_amount:220,employer_amount:260},
    {scheme:"socso",applicable:true,employee_amount:9.75,employer_amount:34.15},
    {scheme:"eis",applicable:true,employee_amount:3.9,employer_amount:3.9},
    {scheme:"pcb",applicable:false,employee_amount:0,employer_amount:0},
  ] }] });
  mocks.readPreparation.mockResolvedValue({results:[{employee_id:"employee",statutory_setup:{complete:true,schemes:{
    epf:{state:"confirmed",applicable:true,category:"malaysian_under_60"},
    socso:{state:"confirmed",applicable:true,category:"first_category_base"},
    eis:{state:"confirmed",applicable:true,category:"standard"},
    pcb:{state:"not_applicable",applicable:false},
  }},projection:{status:"ready",inputs:{compensation_start:{id:"pay",pay_basis:"monthly",basic_salary:2000,effective_from:"2026-01-01"}}}}]});
  render(<PayrollRunEmployeesPanel {...props} />);
  fireEvent.click(screen.getByRole("button", {name:"All",exact:true}));
  await screen.findByText("Ready · EPF / SOCSO / EIS");
  fireEvent.click(screen.getByRole("button",{name:"Review",exact:true}));
  expect(screen.getByText("Malaysian · under 60")).toBeTruthy();
  expect(screen.getByText("Act 4 · First Category")).toBeTruthy();
  expect(screen.queryByText("Setup Required")).toBeNull();
  expect(screen.getAllByText(/1,766.35/).length).toBe(2);
  expect(screen.queryByRole("heading",{name:"Time & Attendance"})).toBeNull();
});
it("reverses an adjustment then refreshes only that employee's calculations", async () => {
  mocks.reverseRunComponent.mockResolvedValue({});
  mocks.recalculateEmployee.mockResolvedValue({});
  render(<PayrollRunEmployeesPanel {...props} />);
  await screen.findByText("QA Employee");
  fireEvent.click(screen.getByRole("button",{name:"Review",exact:true}));
  fireEvent.click(screen.getByRole("button",{name:"Reverse",exact:true}));
  fireEvent.change(screen.getByRole("textbox",{name:/Reason/}),{target:{value:"QA reversal"}});
  fireEvent.click(screen.getByRole("button",{name:"Reverse Adjustment"}));
  await waitFor(()=>expect(mocks.recalculateEmployee).toHaveBeenCalledWith("run","employee"));
  expect(mocks.reverseRunComponent.mock.invocationCallOrder.at(-1)).toBeLessThan(mocks.recalculateEmployee.mock.invocationCallOrder.at(-1));
});
it("still exposes time-dependent employee evidence", async () => {
  mocks.readPreparation.mockResolvedValue({ results: [{ employee_id: "employee", time_relevant: true, projection: { status: "review_required", issues: ["unreconciled_time:2026-09-01"], lines: [] } }] });
  render(<PayrollRunEmployeesPanel {...props} />);
  await screen.findByText("QA Employee");
  expect(screen.getByText("Time evidence required")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Review", exact: true }));
  expect(screen.getByRole("heading", { name: "Time & Attendance" })).toBeTruthy();
});
