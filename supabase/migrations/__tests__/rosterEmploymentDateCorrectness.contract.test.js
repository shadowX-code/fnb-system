import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260929050707_roster_employment_date_eligibility.sql"), "utf8");
const dateKeys = readFileSync(resolve(process.cwd(), "supabase/migrations/20260929051529_roster_employment_picker_date_keys.sql"), "utf8");
const directWrites = readFileSync(resolve(process.cwd(), "supabase/migrations/20260929051713_roster_direct_write_date_scope.sql"), "utf8");
const republish = readFileSync(resolve(process.cwd(), "supabase/migrations/20260929052542_roster_republish_retained_identity.sql"), "utf8");

describe("Roster date-specific People employment authority", () => {
  it("uses one People as-of revision and exact roster date for status, workplace, position and type", () => {
    expect(migration).toContain("employee_employment_assignment_at(p_employee_id,p_on)");
    for (const field of ["employment_status", "workplace", "position", "employment_type"])
      expect(migration).toContain(`v_assignment.${field}`);
    expect(migration).toContain("v_employee.joined_date");
    expect(migration).toContain("v_employee.resigned_date");
    expect(migration).toContain("v_state:='unresolved'");
    expect(migration).toContain("v_state:='other_outlet'");
  });

  it("keeps the picker dated, scoped and keyed by ISO business date", () => {
    expect(migration).toContain("list_roster_eligible_employees(p_outlet_id uuid,p_start_date date,p_end_date date)");
    expect(migration).toContain("current_user_can_access_outlet(p_outlet_id)");
    expect(migration).toContain("roster_employment_on_date(e.id,p_outlet_id,day_date::date)");
    expect(dateKeys).toContain("jsonb_object_agg(day_date::date::text,eligibility)");
  });

  it("guards trusted save, copy and legacy direct writes without replacing Roster lifecycle authority", () => {
    expect(migration).toContain("roster_employment_on_date(e.id,p_outlet_id,d.roster_date)");
    expect(migration).toContain("roster_employment_on_date(e.id,p_outlet_id,r.roster_date)");
    expect(migration).toContain("p_target_week_start_date+(source.roster_date-p_source_week_start_date)");
    expect(directWrites).toContain("as restrictive for insert to authenticated");
    expect(directWrites).toContain("as restrictive for update to authenticated");
    expect(directWrites).toContain("as restrictive for delete to authenticated");
    expect(directWrites).toContain("current_user_can_access_outlet(p_outlet_id)");
  });

  it("pins dated position on new publications without rewriting old published evidence", () => {
    expect(migration).toContain("roster_employment_on_date(employee.id,p_outlet_id,r.roster_date)");
    expect(republish).toContain("->>''state''=''eligible''");
    expect(republish).toContain("r.position_snapshot");
    expect(migration).not.toMatch(/update public\.duty_roster_published_entries/);
    expect(republish).not.toMatch(/update public\.duty_roster_published_entries/);
    expect(migration).not.toMatch(/delete from public\.duty_roster_publications/);
  });
});
