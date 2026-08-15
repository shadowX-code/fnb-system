import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(path.resolve("supabase/migrations/20260815113100_duty_roster_leave_projection_clear_refresh.sql"), "utf8");

describe("Duty Roster Leave projection and canonical read model migration", () => {
  it("pins new Leave projections to the employment outlet while preserving the superseded schedule evidence", () => {
    expect(migration).toContain("projection_outlet := row.employment_outlet_id");
    expect(migration).toContain("superseded_roster_entry");
    expect(migration).toContain("source_publication_id");
    expect(migration).not.toContain("projection_outlet := coalesce(nullif(current_schedule");
    expect(migration).toContain("select generate_series(row.start_date, row.end_date, interval '1 day')::date");
    expect(migration).toContain("when 'annual' then 'AL'");
    expect(migration).toContain("when 'medical' then 'MC'");
    expect(migration).toContain("when 'unpaid' then 'UL'");
    expect(migration).toContain("else 'OL'");
    expect(migration).toContain("if p_decision = 'reject' then");
  });

  it("repairs only derived cross-outlet Leave rows and retains immutable audit history", () => {
    expect(migration).toContain("where p.outlet_id is distinct from a.employment_outlet_id");
    expect(migration).toContain("and source = 'approved_leave'");
    expect(migration).toContain("'canonical_outlet_repair'");
    expect(migration).not.toMatch(/delete from public\.crew_approved_leaves/i);
    expect(migration).not.toMatch(/delete from public\.crew_leave_requests/i);
  });

  it("exposes one authenticated outlet-scoped read authority with fixed search path", () => {
    expect(migration).toContain("create or replace function public.list_duty_roster_read_model");
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = public");
    expect(migration).toContain("public.current_user_can_access_outlet(p_outlet_id)");
    expect(migration).toContain("public.current_user_has_permission('crew_roster.view')");
    expect(migration).toContain("revoke all on function public.list_duty_roster_read_model(uuid, date, date) from public, anon, authenticated");
    expect(migration).toContain("grant execute on function public.list_duty_roster_read_model(uuid, date, date) to authenticated");
  });
});
