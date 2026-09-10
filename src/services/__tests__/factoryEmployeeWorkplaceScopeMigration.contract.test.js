import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260908071357_factory_employee_workplace_scope.sql"), "utf8");

describe("Factory employee workplace scope migration contract", () => {
  it("defines one canonical active Factory or Management eligibility source", () => {
    expect(sql).toContain("create or replace function public.factory_eligible_employees()");
    expect(sql).toContain("e.is_active");
    expect(sql).toContain("coalesce(e.employment_status, 'active') = 'active'");
    expect(sql).toContain("in ('factory', 'management')");
    expect(sql).toContain("revoke all on function public.factory_eligible_employees() from public, anon, authenticated;");
  });

  it("uses the shared eligibility source for Health Declaration and Operator Hygiene selection and saves", () => {
    expect(sql).toContain("join public.factory_eligible_employees() eligible on eligible.id = e.id");
    expect(sql).toContain("from public.factory_eligible_employees() employee");
    expect(sql).toContain("join public.factory_eligible_employees() eligible on eligible.id = employee.id");
  });

  it("retains monthly historical inspection evidence even after an employee leaves the current Factory scope", () => {
    expect(sql).toContain("historical_entry.employee_id = employee.id");
    expect(sql).toContain("historical_session.inspection_date >= date_trunc('month', p_month)::date");
  });
});
