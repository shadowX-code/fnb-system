import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260815100938_duty_roster_stale_snapshot_status_guard.sql"),
  "utf8",
);

describe("Duty Roster stale snapshot status guard migration", () => {
  it("limits the draft status transition to currently schedulable outlet employees", () => {
    expect(migration).toContain("coalesce(e.employment_status, '') = 'active'");
    expect(migration).toContain("public.crew_resolve_employee_outlet(e.id) = p_outlet_id");
    expect(migration).toContain("where e.id = d.employee_id");
  });

  it("fails closed if the expected authority body cannot be patched", () => {
    expect(migration).toContain("if position(v_old_fragment in v_definition) = 0 then");
    expect(migration).toContain("Expected save_roster_week_snapshot status transition was not found");
  });

  it("preserves the authority ACL after replacement", () => {
    expect(migration).toContain("revoke all on function public.save_roster_week_snapshot(uuid, uuid, date, jsonb) from public, anon, authenticated");
    expect(migration).toContain("grant execute on function public.save_roster_week_snapshot(uuid, uuid, date, jsonb) to authenticated");
  });
});
