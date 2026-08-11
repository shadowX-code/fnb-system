import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/202608100012_duty_roster_trusted_week_snapshot_phase_1.sql"), "utf8");

describe("Duty Roster week snapshot migration contract", () => {
  it("defines one authenticated, locked, request-idempotent roster-week authority", () => {
    expect(migration).toContain("create table if not exists public.duty_roster_lifecycle_requests");
    expect(migration).toContain("create or replace function public.save_roster_week_snapshot");
    expect(migration).toContain("auth.uid()");
    expect(migration).toContain("current_user_can_access_outlet(p_outlet_id)");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("payload_fingerprint");
    expect(migration).toContain("group by r.employee_id, r.roster_date");
  });

  it("preserves canonical UUID rows through update/insert/delete snapshot reconciliation and drafts a published period atomically", () => {
    expect(migration).toContain("update public.duty_rosters record set");
    expect(migration).toContain("insert into public.duty_rosters");
    expect(migration).toContain("delete from public.duty_rosters record");
    expect(migration).toContain("v_period.status = 'published'");
    expect(migration).toContain("status = 'draft'");
    expect(migration).toContain("created_by, updated_by");
  });
});
