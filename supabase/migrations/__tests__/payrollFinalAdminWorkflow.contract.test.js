import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const migration = readFileSync(resolve(root, "supabase/migrations/20260925195344_payroll_admin_history_and_holiday_edit.sql"), "utf8");
const page = readFileSync(resolve(root, "src/features/company-users/pages/PayrollPage.jsx"), "utf8");
const employees = readFileSync(resolve(root, "src/features/company-users/pages/PayrollRunEmployeesPanel.jsx"), "utf8");
const rules = readFileSync(resolve(root, "src/features/company-users/pages/PayrollPayRulesPanel.jsx"), "utf8");
const time = readFileSync(resolve(root, "src/features/company-users/pages/PayrollTimeExceptionsTab.jsx"), "utf8");
const calculation = readFileSync(resolve(root, "src/features/company-users/pages/PayrollRunCalculationPanel.jsx"), "utf8");

describe("Payroll final Admin workflow and shared controls", () => {
  it("keeps one server-scoped history projection and a guarded holiday edit", () => {
    expect(migration).toContain("payroll_run_history_read");
    expect(migration).toContain("payroll_can_manage_entity(p_legal_entity_id,'payroll.view')");
    expect(migration).toContain("payroll_holiday_update");
    expect(migration).toContain("Historical or consumed holiday evidence cannot be edited.");
    expect(migration).toContain("payroll_payable_time_versions");
    expect(migration).toContain("'holiday_updated'");
    expect(migration).toContain("revoke all on function public.payroll_holiday_update");
  });

  it("separates history and monthly exception review without another calculation authority", () => {
    expect(page).toContain('"Review Employees", "Review Payroll", "Finalize"');
    expect(page).toContain("readRunHistory");
    expect(page).toContain("PayrollRunEmployeesPanel");
    expect(time).toContain("payrollService.decideTime");
    expect(employees).toContain("DecisionModal");
    expect(employees).toContain("payrollService.confirmPcb");
    expect(employees).not.toContain("payrollService.createProfile");
    expect(calculation).toContain("payrollService.calculateRun");
  });

  it("uses shared FeedX selects, dates and months instead of native controls", () => {
    for (const source of [page, employees, rules, time, calculation]) {
      expect(source).not.toMatch(/<select\b/i);
      expect(source).not.toMatch(/type=["'](?:date|month)["']/i);
    }
    expect(page).toContain("<MonthPickerField label=\"Pay Period\"");
    expect(page).toContain("<DatePickerField label=\"Date\"");
    expect(rules).toContain("<DatePickerField label=\"Effective From\"");
  });
});
