import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260929033032_leave_employment_eligibility_v2.sql"), "utf8");
const readCorrection = readFileSync(resolve(process.cwd(), "supabase/migrations/20260929034204_leave_unresolved_balance_read.sql"), "utf8");
const resignedCorrection = readFileSync(resolve(process.cwd(), "supabase/migrations/20260929034548_leave_resigned_year_grant_guard.sql"), "utf8");
const currentEligibility = readFileSync(resolve(process.cwd(), "supabase/migrations/20260929034848_leave_current_eligibility_read.sql"), "utf8");
const correctedCutover = readFileSync(resolve(process.cwd(), "supabase/migrations/20260929170845_people_corrected_cutover_effective_resolution.sql"), "utf8");

describe("Leave Employment Eligibility V2 authority", () => {
  it("uses one versioned policy and People as-of assignment instead of current Employee employment type", () => {
    expect(sql).toContain("create table public.crew_leave_policy_versions");
    expect(sql).toContain("public.employee_employment_assignment_at(p_employee_id,v_lookup)");
    expect(sql).toContain("v_assignment.employment_type=any(v_policy.eligible_employment_types)");
    expect(sql).not.toMatch(/employee\.employment_type\s*=\s*any/);
  });

  it("fails closed before cutover and rounds the aggregate annual contribution once", () => {
    expect(sql).toContain("'Employment assignment is unverified'");
    expect(sql).toContain("'Leave policy version is unverified'");
    expect(sql).toContain("floor(v_raw*2+0.5)/2");
    expect(sql).toContain("v_policy.annual_days*v_days/v_total");
    expect(sql).toContain("v_lookup:=least(v_start,v_asof)");
  });

  it("scans only effective People revisions for entitlement boundaries", () => {
    expect(correctedCutover).toContain("(public.employee_employment_assignment_at(p_employee_id,r.effective_from)).id=r.id");
    expect(correctedCutover).toContain("Leave entitlement employment boundary changed; manual reconciliation required.");
  });

  it("preserves prior grants and replacement Leave while corrections use audited Leave adjustment", () => {
    expect(sql).toContain("if v_result is not null then return v_result; end if;");
    expect(sql).toContain("if p_leave_type='replacement' then");
    expect(sql).toContain("create table public.crew_leave_entitlement_reviews");
    expect(sql).toContain("public.crew_leave_adjust(v_entitlement.id,v_difference");
    expect(sql).toContain("create table public.crew_leave_legacy_balance_cutover");
    expect(sql).toContain("create trigger crew_leave_request_eligibility_guard");
  });

  it("keeps policy and review evidence private and future projection activation server-owned", () => {
    expect(sql).toContain("alter table public.crew_leave_policy_versions enable row level security");
    expect(sql).toContain("revoke all on public.crew_leave_entitlement_reviews");
    expect(sql).toContain("create function public.crew_leave_activate_due_policy_versions()");
    expect(sql).toContain("feedx_crew_leave_activate_due_policy_versions");
    expect(sql).toContain("current_user_can_access_outlet(p_outlet_id)");
  });

  it("shows missing pre-cutover grants as review required and permits only the verified resignation year", () => {
    expect(readCorrection).toContain("create function public.crew_leave_safe_balance(");
    expect(readCorrection).toContain("'eligibility_state','review_required'");
    expect(readCorrection).toContain("public.crew_leave_safe_balance(v_employee.id,v_type");
    expect(readCorrection).toContain("public.crew_leave_safe_balance(employee,leave_type");
    expect(resignedCorrection).toContain("v_start>v_employee.resigned_date");
    expect(resignedCorrection).toContain("manual reconciliation required");
    expect(currentEligibility).toContain("public.employee_employment_assignment_at(p_employee_id,v_today)");
    expect(currentEligibility).toContain("v_assignment.employment_type=any(v_policy.eligible_employment_types)");
    expect(currentEligibility).toContain("'current_eligibility',v_current");
  });
});
