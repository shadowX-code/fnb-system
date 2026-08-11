import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/202608100014_duty_roster_trusted_lock_status.sql"), "utf8");

describe("Duty Roster trusted lock migration contract", () => {
  it("uses the shared request ledger and week lock to update the period and all roster rows together", () => {
    expect(migration).toContain("lock_roster_week");
    expect(migration).toContain("duty_roster_lifecycle_requests");
    expect(migration).toContain("lock_roster_week'");
    expect(migration).toContain("auth.uid()");
    expect(migration).toContain("duty_roster.manage");
    expect(migration).toContain("current_user_can_access_outlet(p_outlet_id)");
    expect(migration).toContain("roster_week_snapshot:");
    expect(migration).toContain("status='locked'");
    expect(migration).toContain("update public.duty_rosters set status='locked'");
  });
});
