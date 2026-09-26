import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
const mocks = vi.hoisted(() => ({ readFinalizedRecord: vi.fn() }));
vi.mock("../../../../services/payrollService.js", () => ({ payrollService: mocks }));
import PayrollFinalizedRecord from "../PayrollFinalizedRecord.jsx";
afterEach(cleanup);
it("shows frozen employee identity, earnings and contributions without editable actions", async () => {
  mocks.readFinalizedRecord.mockResolvedValue({run:{revision:1,finalized_at:"2026-07-31T12:00:00Z"},period:{period_start:"2026-07-01"},finalized_by_name:"Approver",results:[{
    employee_id:"employee",employee_name:"Frozen Employee",calculation:{revision:1,inputs:{compensation_start:{pay_basis:"monthly",effective_from:"2026-07-01"}},lines:[{kind:"earning",label:"Basic Salary",amount:2000}],gross_earnings:2000,non_statutory_deductions:50,reimbursements:0},
    statutory:{lines:[{scheme:"epf",applicable:true,category:"malaysian_under_60",source_row:"Part A line 134",schedule_version_id:"schedule",employee_amount:220,employer_amount:260},{scheme:"socso",employee_amount:9.75,employer_amount:34.15},{scheme:"eis",employee_amount:3.9,employer_amount:3.9},{scheme:"pcb",applicable:false,employee_amount:0}],net_pay:1716.35,employer_statutory_cost:298.05,total_employer_cost:2298.05},
  }]});
  render(<PayrollFinalizedRecord run={{id:"final"}} />);
  await screen.findByText("Frozen Employee");
  expect(mocks.readFinalizedRecord).toHaveBeenCalledWith("final");
  expect(screen.getByRole("columnheader",{name:"Other Deductions"})).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"View",exact:true}));
  expect(screen.getByText("2026-07 · Finalized read-only Payroll statement")).toBeTruthy();
  expect(screen.getByRole("heading",{name:"Employee Deductions"})).toBeTruthy();
  expect(screen.getByRole("heading",{name:"Employer Contributions"})).toBeTruthy();
  expect(screen.getAllByText(/1,716.35/).length).toBeGreaterThan(1);
  expect(screen.queryByRole("button",{name:/Edit|Remove|Add Adjustment/})).toBeNull();
  fireEvent.click(screen.getByText("Calculation evidence",{exact:true}));
  expect(screen.getByText(/EPF · Part A line 134/)).toBeTruthy();
  expect(screen.queryByText(/EPF · Not Applicable/)).toBeNull();
});
it("keeps the canonical append-only cores and snapshot-only financial reads", () => {
  const sql=readFileSync("supabase/migrations/20260926122835_payroll_operational_record.sql","utf8");
  expect(sql).toContain("public.payroll_run_component_reverse(v_reverse_id,v_source.id,v_reason)");
  expect(sql).toContain("public.payroll_run_component_add(p_request_id,p_run_id,p_employee_id,p_component_id,p_amount,v_reason)");
  expect(sql).toContain("for update");
  expect(sql).toContain("'40001'");
  expect(sql).not.toMatch(/delete from|update public\.payroll_run_.*snapshots/i);
  const record=sql.slice(sql.indexOf("public.payroll_finalized_record_read"));
  expect(record).toContain("p.employee_name_snapshot");
  expect(record).toContain("c.calculation,'statutory',s.result");
  expect(record).not.toContain("payroll_run_statutory_versions");
  expect(record).not.toContain("payroll_compensation_versions");
  expect(record).toContain("'payroll.view'");
  expect(record).toContain("from public,anon");
});
