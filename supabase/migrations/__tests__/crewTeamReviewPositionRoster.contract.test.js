import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = fs.readFileSync(path.resolve("supabase/migrations/20260928182323_team_review_position_roster_eligibility.sql"), "utf8").toLowerCase();
const subjects = sql.split("function public.crew_team_review_live_subjects")[1]?.split("function public.crew_team_review_live_pairs")[0] || "";
const pairs = sql.split("function public.crew_team_review_live_pairs")[1]?.split("function public.crew_team_review_admin_dimensions")[0] || "";

describe("Team Review final position and roster authority", () => {
  it("uses an explicit Position switch rather than a Service Crew name", () => {
    expect(sql).toContain("add column participates_in_team_review boolean not null default false");
    expect(subjects).toContain("job_position.participates_in_team_review");
    expect(subjects).toContain("employee.is_active");
    expect(subjects).not.toContain("service crew");
    expect(subjects).not.toContain("crew_attendance_records");
  });

  it("requires current published roster overlap and rejects affirmative contradictions", () => {
    expect(pairs).toContain("b.employee_id <> a.employee_id");
    expect(pairs).toContain("a.publication_id = (");
    expect(pairs).toContain("overlap_start < overlap_end");
    expect(pairs).toContain("crew_leave_roster_projections");
    expect(pairs).toContain("attendance.status = 'completed'");
    expect(pairs).toContain("attendance.clock_in_at < overlap_end");
    expect(pairs).not.toContain("ca.access_state");
  });

  it("keeps Admin dimensions permission-scoped", () => {
    expect(sql).toContain("current_user_has_permission('crew_performance.review')");
    expect(sql).toContain("current_user_can_access_outlet(v_outlet)");
    expect(sql).toContain("grant execute on function public.crew_team_review_admin_dimensions(uuid,date) to authenticated");
  });
});
