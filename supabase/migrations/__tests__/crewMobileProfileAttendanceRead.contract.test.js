import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260821115233_crew_mobile_profile_attendance_read.sql"),
  "utf8",
);

describe("Crew Mobile profile and attendance month reads", () => {
  it("keeps the profile read token-bound and limited to safe employee fields", () => {
    expect(migration).toContain("create or replace function public.crew_my_profile(p_token text)");
    expect(migration).toContain("public.crew_session_employee(p_token)");
    expect(migration).toContain("full_name");
    expect(migration).toContain("nickname");
    expect(migration).toContain("birthday");
    expect(migration).toContain("joined_date");
    expect(migration).not.toContain("passcode_hash");
  });

  it("limits attendance history to the caller and the current three business months", () => {
    expect(migration).toContain("create or replace function public.crew_my_attendance_month(p_token text, p_month date)");
    expect(migration).toContain("v_month not in (v_current_month, (v_current_month - interval '1 month')::date, (v_current_month - interval '2 months')::date)");
    expect(migration).toContain("r.employee_id = v_employee_id");
    expect(migration).toContain("r.clock_in_at >= v_from and r.clock_in_at < v_to");
  });

  it("uses fixed search paths and authenticated-only execute grants", () => {
    expect(migration.match(/security definer/g)).toHaveLength(2);
    expect(migration.match(/set search_path = public/g)).toHaveLength(2);
    expect(migration).toContain("revoke all on function public.crew_my_profile(text) from public, anon, authenticated");
    expect(migration).toContain("grant execute on function public.crew_my_attendance_month(text, date) to anon, authenticated");
  });
});
