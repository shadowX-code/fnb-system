import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const sql = readFileSync(new URL("../20260926051250_payroll_run_preparation_read.sql", import.meta.url), "utf8");
it("uses existing authority and scoped reads without changing readiness or evidence", () => {
  expect(sql).toContain("payroll_admin_actor()");
  expect(sql).toContain("payroll_can_manage_entity(v_period.legal_entity_id,'payroll.view')");
  expect(sql).toContain("payroll_can_access_employee(v_member.employee_id,'payroll.view')");
  expect(sql).toContain("payroll_calculation_project(p_run_id,v_member.employee_id)");
  expect(sql).toContain("v_period.period_start,null");
  expect(sql).toContain("payroll_run_calculation_snapshots");
  expect(sql).toContain("from public,anon");
  expect(sql).not.toMatch(/\b(insert into|update public|delete from)\b/i);
});
