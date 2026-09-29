import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const authority = readFileSync("supabase/migrations/20260929042209_payroll_period_employment_timeline.sql", "utf8");
const correction = readFileSync("supabase/migrations/20260929042803_payroll_period_employment_scope_correction.sql", "utf8");

it("derives open membership and identity from People evidence but keeps finalized membership pinned", () => {
  expect(authority).toContain("employee_employment_assignment_at(p_employee_id,v_date)");
  expect(authority).toContain("payroll_period_employment_resolve(e.id,period.id)");
  expect(authority).toContain("select s.employee_id from public.payroll_run_profile_snapshots");
  expect(authority).not.toContain("e.legal_entity_id=period.legal_entity_id");
  expect(authority).toContain("'employment_assignment',v_employment");
  expect(authority).toContain("'employment',v_employment");
  expect(authority).toContain("'position',employment->'identity'->>'position'");
  expect(authority).toContain("'workplace',employment->'identity'->>'workplace'");
  expect(authority).toContain("'employment_type',employment->'identity'->>'employment_type'");
});

it("fails closed on unknown or mixed period assignments without rewriting finalized evidence", () => {
  expect(authority).toContain("v_missing_start:=coalesce(v_missing_start,v_date)");
  expect(authority).toContain("elsif v_changed then v_issue:='mid_period_employment_change'");
  expect(authority).toContain("public.payroll_period_employment_scope_issue(v_period.id) is null");
  expect(correction).toContain("'employment_joined_date_missing'");
  expect(authority).toContain("'employment_assignment',v_employment");
  expect(authority).not.toMatch(/update public\.payroll_run_(profile|calculation|statutory)_snapshots/i);
  expect(authority).not.toMatch(/update public\.payroll_payslip_(identity_snapshots|jobs)/i);
});

it("keeps run-scoped authorization historical and final access pinned", () => {
  expect(correction).toContain("from public.payroll_payslip_identity_snapshots");
  expect(correction).toContain("payroll_can_access_run_employee(p_run_id,p_employee_id,'payroll.manage')");
  expect(correction).toContain("from public.payroll_run_employee_ids(p_run_id) member");
  expect(correction).not.toContain("update public.employees");
});
