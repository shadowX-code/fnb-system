import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260925184831_payroll_holiday_geography.sql"), "utf8");
const page = readFileSync(resolve(process.cwd(), "src/features/company-users/pages/PayrollPage.jsx"), "utf8");
const outlet = readFileSync(resolve(process.cwd(), "src/services/outletService.js"), "utf8");

describe("Payroll UI and holiday ownership consolidation", () => {
  it("creates shared geographic holidays without rewriting historical company evidence", () => {
    expect(migration).toContain("p_legal_entity_id is not null");
    expect(migration).toContain("New public holidays are shared");
    expect(migration).toContain("h.legal_entity_id is null or h.legal_entity_id");
    expect(migration).toContain("public.payroll_time_evidence_base");
    expect(migration).toContain("h.state_code=v_state");
    expect(migration).toContain("payroll_outlet_state_versions");
    expect(migration).toContain("effective_from<=p_work_date");
    expect(migration).toContain("payroll_outlet_state_immutable");
    expect(migration).toContain("state_holiday_scope_review");
    expect(migration).not.toMatch(/delete from public\.payroll_public_holidays|update public\.payroll_public_holidays/i);
    expect(outlet).toContain("state_code");
  });

  it("keeps component identity fixed and protects finalized payroll from mutable treatment", () => {
    expect(migration).toContain("payroll_component_update");
    expect(migration).toContain("r.status in ('finalized','paid')");
    expect(migration).toContain("Create a new component for changed name or statutory treatment");
    expect(migration).toContain("'before',to_jsonb(v_old),'after',v_new");
    expect(migration).toContain("payroll_component_history_read");
    expect(page).toContain("Advanced / System Information");
    expect(page).toContain("Set Up Employee");
    expect(page).toContain("AdminUnderlineTabs");
  });
});
