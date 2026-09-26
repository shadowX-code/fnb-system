import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260925120914_payroll_calculation_phase3.sql"), "utf8");
const hourlyFix = readFileSync(resolve(process.cwd(), "supabase/migrations/20260925121036_payroll_hourly_midperiod_effective_fix.sql"), "utf8");
const employmentScope = readFileSync(resolve(process.cwd(), "supabase/migrations/20260925123708_payroll_employment_period_scope.sql"), "utf8");
const employmentGuard = readFileSync(resolve(process.cwd(), "supabase/migrations/20260925123715_payroll_employment_date_review_guard.sql"), "utf8");
const page = readFileSync(resolve(process.cwd(), "src/features/company-users/pages/PayrollPage.jsx"), "utf8");
const calculationPanel = readFileSync(resolve(process.cwd(), "src/features/company-users/pages/PayrollRunCalculationPanel.jsx"), "utf8");
const rulesPanel = readFileSync(resolve(process.cwd(), "src/features/company-users/pages/PayrollPayRulesPanel.jsx"), "utf8");

describe("Payroll Phase 3 pre-statutory calculation authority", () => {
  it("uses immutable versioned rules, calculation lines and final snapshots", () => {
    for (const authority of ["payroll_pay_rule_versions", "payroll_run_component_adjustments",
      "payroll_run_calculation_versions", "payroll_run_calculation_snapshots"])
      expect(migration).toContain(`create table public.${authority}`);
    expect(migration).toContain("payroll_calculation_snapshot_finalized_run");
    expect(migration).toContain("input_fingerprint");
    expect(migration).toContain("payroll_calculation_run_gate");
    expect(migration).toContain("payroll_command_guard");
  });

  it("prices approved time at the effective work-date compensation and rule versions", () => {
    expect(migration).toContain("v_time.approved_minutes");
    expect(migration).toContain("v_time.approved_extra_minutes");
    expect(migration).toContain("effective_from<=p_work_date");
    expect(migration).toContain("effective_from<=v_day");
    expect(migration).toContain("v_time.source_fingerprint is distinct from v_source->>'source_fingerprint'");
    expect(hourlyFix).toContain("if v_first.id is null and v_last.pay_basis='hourly' then v_first:=v_last;");
    expect(migration).not.toMatch(/update public\.(crew_attendance_records|duty_roster_published_entries|crew_approved_leaves)/);
  });

  it("blocks unsupported premiums and proration instead of inventing amounts", () => {
    expect(migration).toContain("missing_unpaid_time_rule");
    expect(migration).toContain("monthly_rate_change_requires_proration_policy");
    expect(migration).toContain("partial_month_requires_approved_proration");
    expect(migration).toContain("missing_'||v_rule_code||'_rule");
    expect(migration).not.toContain("epf_amount");
    expect(migration).not.toContain("net_pay");
  });

  it("scopes run members to employment periods and reviews unknown dates", () => {
    expect(employmentScope).toContain("e.joined_date<=period.period_end");
    expect(employmentScope).toContain("e.resigned_date>=period.period_start");
    expect(employmentGuard).toContain("employment_start_date_requires_review");
    expect(employmentGuard).toContain("employee_not_yet_joined");
    expect(employmentGuard).toContain("employment_ended_before_period");
  });

  it("exposes explanation and sourced rule management without statutory amounts", () => {
    expect(page).toContain('stage="review"');
    expect(page).toContain('"Prepare Payroll", "Review Payroll", "Finalize"');
    expect(calculationPanel).toContain('"Employee Payroll statement"');
    expect(page).toContain("Pay Rules");
    expect(page).toContain("Return to Review");
    expect(calculationPanel).toContain("compensation.effective_from");
    expect(calculationPanel).toContain("Employee Deductions");
    expect(calculationPanel).toContain("Calculation evidence");
    expect(rulesPanel).toContain("Missing rules remain Review Required");
  });
});
