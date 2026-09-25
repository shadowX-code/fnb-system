import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260925125338_payroll_statutory_phase4.sql"), "utf8");
const correction = readFileSync(resolve(process.cwd(), "supabase/migrations/20260925125642_payroll_phase4_pcb_null_fix.sql"), "utf8");
const service = readFileSync(resolve(process.cwd(), "src/services/payrollService.js"), "utf8");
const page = readFileSync(resolve(process.cwd(), "src/features/company-users/pages/PayrollPage.jsx"), "utf8");

describe("Payroll Phase 4 statutory safety boundary", () => {
  it("versions statutory inputs, official bands, calculations and immutable final snapshots", () => {
    for (const table of ["payroll_statutory_input_versions", "payroll_statutory_schedule_versions",
      "payroll_statutory_schedule_bands", "payroll_run_statutory_versions", "payroll_run_statutory_snapshots"])
      expect(migration).toContain(`create table public.${table}`);
    expect(migration).toContain("payroll_statutory_snapshot_finalized_run");
    expect(migration).toContain("payroll_statutory_run_gate");
    expect(migration).toContain("payroll_run_statutory_readiness");
    expect(migration).toContain("payroll_run_statutory_calculate");
  });

  it("does not fabricate official schedules or PCB amounts", () => {
    expect(migration).not.toMatch(/insert into public\.payroll_statutory_schedule_(versions|bands)/);
    expect(migration).toContain("pcb_2026_official_spec_unvalidated");
    expect(migration).toContain("_official_schedule_unavailable");
    expect(migration).toContain("_wage_treatment_unresolved");
    expect(correction).toContain("when v_scheme='pcb' and v_applicable then 0");
    expect(migration).toContain("v_calc.input_fingerprint is distinct from");
  });

  it("keeps direct tables private and routes Admin through canonical commands", () => {
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("revoke all on public.%I from public,anon,authenticated");
    expect(migration).toContain("payroll_can_manage_entity(v_period.legal_entity_id,'payroll.manage')");
    expect(service).toContain("payroll_run_statutory_calculate");
    expect(service).toContain("payroll_run_statutory_read");
    expect(page).toContain("readiness[run.id]?.statutory?.ready");
  });
});
