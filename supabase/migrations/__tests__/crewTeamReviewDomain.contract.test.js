import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = fs.readFileSync(path.resolve("supabase/migrations/20260928113201_team_review_domain.sql"), "utf8").toLowerCase();
const body = (name, next) => sql.split(`function public.${name}`)[1]?.split(`function public.${next}`)[0] || "";

describe("Team Review authority", () => {
  it("requires real shared attendance and uses roster only as corroboration", () => {
    const subjects = body("crew_team_review_live_subjects", "crew_team_review_live_pairs");
    const pairs = body("crew_team_review_live_pairs", "crew_team_review_window");
    expect(subjects).toContain("lower(btrim(e.position))='service crew'");
    expect(subjects).toContain("a.status='completed'");
    expect(subjects).toContain("ca.access_state='active'");
    expect(pairs).toContain("b.clock_in_at<a.clock_out_at and b.clock_out_at>a.clock_in_at");
    expect(pairs).toContain("b.employee_id<>a.employee_id");
    expect(pairs).toContain("duty_roster_published_entries");
    expect(pairs).toContain("bool_or(exists");
    expect(pairs).toContain("count(*)::integer as attendance_overlap_count");
    expect(sql).toContain("'work_evidence'");
    expect(sql).not.toContain("required_count");
  });

  it("automatically opens for the last three days, closes after day two and freezes eligibility", () => {
    const window = body("crew_team_review_window", "crew_team_review_freeze");
    const freeze = body("crew_team_review_freeze", "crew_team_review_freeze_due");
    expect(window).toContain("interval '3 days'");
    expect(window).toContain("interval '2 days'");
    expect(window).toContain("asia/kuala_lumpur");
    expect(freeze).toContain("crew_team_review_subjects");
    expect(freeze).toContain("crew_team_review_eligible_pairs");
    expect(freeze).toContain("frozen_at=now()");
    expect(sql).toContain("feedx_team_review_freeze");
    expect(sql).toContain("crew_team_review_window_events");
  });

  it("rejects self, duplicate, ineligible and closed-window writes", () => {
    const submit = body("crew_team_review_submit", "crew_team_review_admin");
    expect(sql).toContain("unique (subject_id, reviewer_id, period_start)");
    expect(submit).toContain("p_subject_id=v_reviewer");
    expect(submit).toContain("v_window.state<>'open'");
    expect(submit).toContain("crew_team_review_live_pairs");
    expect(submit).toContain("on conflict(subject_id,reviewer_id,period_start) do nothing");
    expect(submit).toContain("status='finalized'");
    expect(sql).toContain("char_length(internal_comment) <= 1000");
    expect(sql).toContain("crew_team_review_mean(p_criteria)");
    const mobile = body("crew_team_review_mobile", "crew_team_review_submit");
    expect(mobile).toContain("union select period_start from public.crew_team_review_periods");
    expect(mobile).toContain("window_state.state='open'");
  });

  it("scores direct dimension averages from valid reviews, with one review sufficient", () => {
    const result = body("crew_team_review_result", "crew_team_review_performance_component");
    expect(result).toContain("left join public.crew_team_review_exclusions");
    expect(result).toContain("round(avg(public.crew_team_review_mean(criteria)),2)");
    expect(result).toContain("elsif v_count>0 then v_status:='ready'");
    expect(result).toContain("v_status:='admin_review_required'");
    expect(result).toContain("crew_team_admin_reviews");
    expect(result).toContain("v_window.state='open' then v_status:='provisional'");
    expect(result).not.toContain("5 * (");
    const adapter = body("crew_team_review_performance_component", "crew_team_review_mobile");
    expect(adapter).toContain("v_result->>'status'='ready'");
    expect(adapter).toContain("'status',case when v_result->>'status'='ready' then 'scored' else 'pending'");
    expect(adapter).not.toContain("'completed',v_result");
    expect(adapter).not.toContain("'source',v_result");
  });

  it("keeps Crew output anonymous and Admin-only evidence permission-scoped", () => {
    const mobile = body("crew_team_review_mobile", "crew_team_review_submit");
    expect(mobile).not.toContain("reviewer_name");
    expect(mobile).not.toContain("internal_comment");
    const admin = body("crew_team_review_admin", "crew_team_review_exclude");
    expect(admin).toContain("current_user_has_permission('crew_performance.review')");
    expect(admin).toContain("current_user_can_access_outlet(p_outlet_id)");
    expect(admin).toContain("'reviewer_name'");
    expect(admin).toContain("'comment',r.internal_comment");
    expect(admin).toContain("'reviewed_by_name'");
    expect(admin).toContain("'excluded_by_name'");
    expect(sql).toContain("revoke all on public.crew_team_review_launch");
  });

  it("removes old Peer RPC access and refreshes Performance from final Team Review only", () => {
    expect(sql).toContain("revoke execute on function public.crew_peer_review_submit");
    const refresh = body("crew_refresh_performance", "");
    expect(refresh).toContain("crew_team_review_performance_component");
    expect(refresh).not.toContain("crew_peer_review_component");
    expect(refresh).toContain("google_review_authority_not_available");
    expect(refresh).toContain("total_score=null");
  });
});
