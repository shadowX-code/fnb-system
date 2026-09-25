import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(resolve(process.cwd(),
  "supabase/migrations/20260925142005_payroll_epf_oct2025_percentage_and_bonus.sql"), "utf8");
const categoryGuard = readFileSync(resolve(process.cwd(),
  "supabase/migrations/20260925142352_payroll_epf_supported_category_guard.sql"), "utf8");
const fractionalGate = readFileSync(resolve(process.cwd(),
  "supabase/migrations/20260925142603_payroll_epf_fractional_remittance_gate.sql"), "utf8");

describe("October 2025 KWSP Third Schedule projection", () => {
  it("uses published Part A/E percentage categories above RM20,000 and rounds only the aggregate remittance", () => {
    expect(migration).toContain("v_total:=ceil(v_raw_employee+v_raw_employer)");
    expect(migration).toContain("when v_category='malaysian_60_to_74' then 4");
    expect(migration).toContain("when v_category='malaysian_60_to_74' then 0 else 11");
    expect(migration).toContain("when v_ordinary<=5000 and v_bonus>0 and not v_missing_class then 13 else 12");
    expect(migration).toContain("'remittance_rounding',v_total-v_employee-v_employer");
    expect(migration).toContain("'total_contribution'");
    expect(fractionalGate).toContain("epf_remittance_rounding_allocation_unapproved");
  });

  it("does not count rest-day or holiday overtime as EPF wages", () => {
    expect(migration).toContain("('overtime','rest_day','public_holiday','public_holiday_ot')");
    expect(migration).toContain("v_base_line:=jsonb_set(v_base_line,'{treatment}','\"excluded\"'::jsonb)");
  });

  it("requires sourced, append-only bonus classification and keeps ambiguity in Review Required", () => {
    expect(migration).toContain("payroll_epf_component_classification_versions");
    expect(migration).toContain("'payroll_epf_component_classification_versions')");
    expect(migration).toContain("epf_bonus_threshold_component_classification_missing");
    expect(migration).toContain("epf_mid_period_component_classification_change");
    expect(migration).toContain("case when cardinality(v_issues)=0 then 'ready' else 'review_required'");
    expect(categoryGuard).toContain("v_category='malaysian_under_60' and v_base>5000");
    expect(categoryGuard).toContain("'epf_category_unreviewed'");
  });
});
