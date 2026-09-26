import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
const sql = readFileSync("supabase/migrations/20260926132505_payroll_monthly_entitlement.sql", "utf8");
const windowSql = readFileSync("supabase/migrations/20260926134251_payroll_statutory_employment_window.sql", "utf8");
describe("Monthly calendar-day entitlement authority", () => {
  it("uses a confirmed immutable calendar formula, never the ordinary-rate divisor", () => {
    expect(sql).toContain("formula_code is not distinct from 'ea18a_calendar_days_v1'");
    expect(sql).toContain("v_comp.basic_salary*(v_employed-v_unpaid)/v_days");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("v_actor uuid:=public.payroll_admin_actor()");
    expect(sql).toContain("revoke all on function public.payroll_monthly_entitlement(uuid,uuid,uuid) from public,anon,authenticated");
  });
  it("pins leave and employment evidence without editing it or requiring roster minutes", () => {
    expect(sql).toContain("jsonb_agg(to_jsonb(l)");
    expect(sql).toContain("'approved_unpaid_leaves',v_leaves");
    expect(sql).toContain("'unpaid_dates',v_dates");
    expect(sql).not.toMatch(/(?:update|delete from) public\.(employees|crew_approved_leaves|crew_attendance_records|duty_roster_published_entries)/i);
    const monthlySkip = sql.slice(sql.indexOf("-- Approved Monthly unpaid leave"), sql.indexOf("v_source:=public.payroll_time_evidence"));
    expect(monthlySkip).toContain("l.leave_type='unpaid'");
    expect(monthlySkip).not.toContain("scheduled_minutes");
  });
  it("feeds actual Basic wages through the existing canonical earning code", () => {
    expect(sql).toContain("'code','monthly_basic'");
    expect(sql).toContain("'amount',(v_entitlement->>'amount')::numeric");
    expect(sql).toContain("'monthly_entitlement',v_entitlement->'basis'");
    expect(sql).not.toMatch(/update public\.payroll_.*snapshots/i);
  });
  it("fails closed for unsupported units, conflicts, jurisdiction and salary/component changes", () => {
    for (const issue of ["unpaid_half_day_policy_required", "unpaid_leave_overlap_requires_review", "unpaid_leave_attendance_conflict",
      "monthly_proration_jurisdiction_requires_review", "monthly_rate_change_requires_proration_policy", "monthly_components_entitlement_policy_required"])
      expect(sql).toContain(issue);
    expect(sql).toContain("missing_'||v_rule_code||'_rule");
  });
  it("shares the Monthly joining-date setup cutoff without moving schedules or exposing private reads", () => {
    expect(windowSql).toContain("case when comp.pay_basis='monthly'");
    expect(windowSql).toContain("public.payroll_employee_period_start(p_run_id,v_member.employee_id)");
    expect(windowSql).toContain("public.payroll_employee_period_start(p_run_id,p_employee_id)");
    expect(windowSql).toContain("public.payroll_employee_period_start(p_run_id,member.employee_id)");
    expect(windowSql).toContain("newer.effective_from>v_setup_date");
    expect(windowSql).toContain("category=v_category and effective_from<=v_period.period_start");
    expect(windowSql).toContain("from public,anon,authenticated");
    expect(windowSql).not.toMatch(/(?:update|delete from) public\.payroll_.*snapshots/i);
  });
});
