import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const originalSql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260908071357_factory_employee_workplace_scope.sql"), "utf8");
const refinementSql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260921180000_factory_employee_workplace_role_outlet_scope.sql"), "utf8");

describe("Factory employee workplace scope migration contract", () => {
  it("refines the canonical active eligibility source to Factory workforce only", () => {
    expect(originalSql).toContain("create or replace function public.factory_eligible_employees()");
    expect(refinementSql).toContain("create or replace function public.factory_eligible_employees()");
    expect(refinementSql).toContain("e.is_active");
    expect(refinementSql).toContain("coalesce(e.employment_status, 'active') = 'active'");
    expect(refinementSql).toContain("= 'factory'");
    expect(refinementSql).not.toContain("in ('factory', 'management')");
    expect(refinementSql).toContain("revoke all on function public.factory_eligible_employees() from public, anon, authenticated;");
  });

  it("uses the shared eligibility source for Health Declaration and Operator Hygiene selection and saves", () => {
    expect(originalSql).toContain("join public.factory_eligible_employees() eligible on eligible.id = e.id");
    expect(originalSql).toContain("from public.factory_eligible_employees() employee");
    expect(originalSql).toContain("join public.factory_eligible_employees() eligible on eligible.id = employee.id");
  });

  it("retains monthly historical inspection evidence even after an employee leaves the current Factory scope", () => {
    expect(originalSql).toContain("historical_entry.employee_id = employee.id");
    expect(originalSql).toContain("historical_session.inspection_date >= date_trunc('month', p_month)::date");
  });
});
