import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260815090411_duty_roster_bulk_eligibility_scope_fix.sql"),
  "utf8",
);

describe("Duty Roster bulk eligibility scope migration", () => {
  it("exposes only active employees resolved to the requested outlet", () => {
    expect(migration).toContain("create or replace function public.list_roster_eligible_employees");
    expect(migration).toContain("coalesce(e.employment_status, '') = 'active'");
    expect(migration).toContain("public.crew_resolve_employee_outlet(e.id) = p_outlet_id");
    expect(migration).toContain("public.current_user_can_access_outlet(p_outlet_id)");
  });

  it("validates only inserted or materially changed snapshot cells", () => {
    expect(migration).toContain("d.id is null");
    expect(migration).toContain("d.shift_template_id is distinct from r.shift_template_id");
    expect(migration).toContain("coalesce(d.remark, '') is distinct from coalesce(r.remark, '')");
    expect(migration).not.toContain("Roster snapshot contains an ineligible or out-of-scope employee.");
  });

  it("rejects selected inactive, unresolved, and cross-outlet employees with actionable errors", () => {
    expect(migration).toContain("the employee is inactive or no longer employed");
    expect(migration).toContain("the employee has no eligible outlet assignment");
    expect(migration).toContain("the employee belongs to another outlet");
    expect(migration).toContain("public.crew_resolve_employee_outlet(e.id) <> p_outlet_id");
  });

  it("prevents a crafted snapshot from deleting an ineligible historical row by omission", () => {
    expect(migration).toContain("A row omitted from a full-week snapshot is a delete intent");
    expect(migration).toContain("Cannot remove historical roster for %s");
    expect(migration).toContain("this employee is no longer schedulable for the selected outlet");
  });

  it("keeps the authorities authenticated-only with fixed search paths", () => {
    expect(migration.match(/security definer/g)).toHaveLength(2);
    expect(migration.match(/set search_path = public/g)).toHaveLength(2);
    expect(migration).toContain("revoke all on function public.list_roster_eligible_employees(uuid) from public, anon, authenticated");
    expect(migration).toContain("grant execute on function public.list_roster_eligible_employees(uuid) to authenticated");
    expect(migration).toContain("revoke all on function public.save_roster_week_snapshot(uuid, uuid, date, jsonb) from public, anon, authenticated");
  });
});
