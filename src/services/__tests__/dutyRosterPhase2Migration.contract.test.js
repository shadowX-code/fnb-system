import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/202608100013_duty_roster_trusted_copy_publish_phase_2.sql"), "utf8");

describe("Duty Roster Phase 2 migration contract", () => {
  it("reuses the lifecycle ledger for authenticated locked Copy, Publish, and Unlock authorities", () => {
    expect(migration).toContain("copy_roster_week");
    expect(migration).toContain("publish_roster_week");
    expect(migration).toContain("unpublish_roster_week");
    expect(migration).toContain("duty_roster_lifecycle_requests");
    expect(migration).toContain("auth.uid()");
    expect(migration).toContain("pg_advisory_xact_lock(hashtext('roster_week_snapshot:'");
    expect(migration).toContain("duty_roster.manage");
  });
});
