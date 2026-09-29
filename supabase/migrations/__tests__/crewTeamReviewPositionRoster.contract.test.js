import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = fs.readFileSync(path.resolve("supabase/migrations/20260928182323_team_review_position_roster_eligibility.sql"), "utf8").toLowerCase();
const domain = fs.readFileSync(path.resolve("supabase/migrations/20260928113201_team_review_domain.sql"), "utf8").toLowerCase();
const freezeBoundary = fs.readFileSync(path.resolve("supabase/migrations/20260929040148_team_review_position_freeze_boundary.sql"), "utf8").toLowerCase();
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

  it("recalculates open eligibility from both current Position flags but freezes closed months before a flag changes", () => {
    const mobile = domain.split("function public.crew_team_review_mobile")[1]?.split("function public.crew_team_review_submit")[0] || "";
    const submit = domain.split("function public.crew_team_review_submit")[1]?.split("function public.crew_team_review_admin")[0] || "";
    const result = domain.split("function public.crew_team_review_result")[1]?.split("function public.crew_team_review_performance_component")[0] || "";
    expect(pairs).toContain("crew_team_review_live_subjects(p_outlet_id,p_period) subject");
    expect(pairs).toContain("crew_team_review_live_subjects(p_outlet_id,p_period) reviewer");
    expect(mobile).toContain("crew_team_review_live_pairs(v_outlet,v_period)");
    expect(submit).toContain("crew_team_review_live_pairs(v_outlet,v_period)");
    expect(result).toContain("from public.crew_team_review_eligible_pairs");
    expect(result).toContain("where v_window.frozen");
    expect(freezeBoundary).toContain("before update of participates_in_team_review on public.job_positions");
    expect(freezeBoundary).toContain("old.participates_in_team_review is distinct from new.participates_in_team_review");
    expect(freezeBoundary).toContain("perform public.crew_team_review_freeze_due()");
  });

  it("preserves roster-only freeze evidence and never reopens or erases a closed review", () => {
    const control = domain.split("function public.crew_team_review_window_control")[1]?.split("function public.crew_team_review_result")[0] || "";
    const admin = domain.split("function public.crew_team_review_admin")[1]?.split("function public.crew_team_review_exclude")[0] || "";
    expect(freezeBoundary).toContain("check (attendance_overlap_count >= 0)");
    expect(control).toContain("v_before.state='unavailable' or v_before.frozen");
    expect(control).toContain("p_action='extend_deadline' and v_before.state='open'");
    expect(admin).toContain("from public.crew_team_reviews r");
    expect(domain).not.toContain("delete from public.crew_team_reviews");
    expect(freezeBoundary).not.toContain("delete from public.crew_team_reviews");
  });
});
