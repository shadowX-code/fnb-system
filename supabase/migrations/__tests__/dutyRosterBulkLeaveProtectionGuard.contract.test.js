import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260815101423_duty_roster_bulk_leave_protection_guard.sql"),
  "utf8",
);

describe("Duty Roster bulk approved-leave protection guard", () => {
  it("rejects changed Leave-owned cells", () => {
    expect(migration).toContain("d.source = 'approved_leave' or d.approved_leave_id is not null");
    expect(migration).toContain("Approved leave roster cells are protected and cannot be overwritten");
  });

  it("rejects deleting Leave-owned cells by omission", () => {
    expect(migration).toContain("Approved leave roster cells are protected and cannot be removed");
    expect(migration).toContain("and not exists (");
  });

  it("preserves the authenticated-only authority ACL", () => {
    expect(migration).toContain("revoke all on function public.save_roster_week_snapshot(uuid, uuid, date, jsonb) from public, anon, authenticated");
    expect(migration).toContain("grant execute on function public.save_roster_week_snapshot(uuid, uuid, date, jsonb) to authenticated");
  });
});
