import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(resolve(process.cwd(),
  "supabase/migrations/20260925143613_payroll_manual_pcb_v1.sql"), "utf8");
const scope = readFileSync(resolve(process.cwd(),
  "supabase/migrations/20260925144113_payroll_pcb_read_employee_scope.sql"), "utf8");
const guard = readFileSync(resolve(process.cwd(),
  "supabase/migrations/20260925144939_payroll_command_guard_table_scope_fix.sql"), "utf8");
const categories = readFileSync(resolve(process.cwd(),
  "supabase/migrations/20260925145221_payroll_statutory_input_scoped_read.sql"), "utf8");
const service = readFileSync(resolve(process.cwd(), "src/services/payrollService.js"), "utf8");
const panel = readFileSync(resolve(process.cwd(),
  "src/features/company-users/pages/PayrollRunCalculationPanel.jsx"), "utf8");

describe("Payroll V1 manual PCB statutory authority", () => {
  it("pins per-Run/employee/period confirmations and retains append-only correction history", () => {
    expect(migration).toContain("create table public.payroll_run_pcb_confirmations");
    expect(migration).toContain("request_id uuid not null unique");
    expect(migration).toContain("period_id uuid not null references public.payroll_periods");
    expect(migration).toContain("supersedes_id uuid references public.payroll_run_pcb_confirmations");
    expect(migration).toContain("'payroll_run_pcb_confirmations')");
    expect(migration).toContain("'pcb_manual_confirmed'");
    expect(migration).toContain("v_run.status not in ('draft','review_required')");
  });

  it("keeps applicable PCB missing until explicitly confirmed and deducts it through statutory Net Pay", () => {
    expect(migration).toContain("'pcb_manual_confirmation_missing'");
    expect(migration).toContain("'scheme','pcb'");
    expect(migration).toContain("'method',case when v_pcb.id is not null then 'manual_confirmed'");
    expect(migration).toContain("v_calc.pre_statutory_pay-v_employee_total");
    expect(migration).toContain("case when v_pcb.id is null then null else to_jsonb(v_pcb) end");
    expect(migration).toContain("'input_fingerprint',md5(v_inputs::text)");
    expect(migration).toContain("'epf_remittance_rounding_policy','employer_funded_residual_v1'");
  });

  it("uses only canonical Admin commands and exposes confirmation/revision UI", () => {
    expect(migration).toContain("payroll_can_manage_entity(v_period.legal_entity_id,'payroll.manage')");
    expect(migration).toContain("payroll_can_access_employee(p_employee_id,'payroll.manage')");
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("revoke all on public.payroll_run_pcb_confirmations");
    expect(scope).toContain("payroll_can_access_employee(member.employee_id,'payroll.view')");
    expect(guard).toContain("if tg_op='UPDATE' and tg_table_name='payroll_runs' then\n    if old.status");
    expect(categories).toContain("payroll_can_access_employee(v_employee_id,'payroll.view')");
    expect(service).toContain('command("payroll_run_pcb_confirm"');
    expect(service).toContain('command("payroll_run_pcb_read"');
    expect(panel).toContain("Draft corrections retain audit history.");
    expect(panel).toContain("Confirm PCB / MTD");
  });
});
