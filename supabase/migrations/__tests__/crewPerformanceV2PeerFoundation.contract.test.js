import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = fs.readFileSync(path.resolve("supabase/migrations/20260925052459_crew_performance_v2_peer_foundation.sql"), "utf8").toLowerCase();
const section = (start, end) => sql.split(`create or replace function public.${start}`)[1]?.split(`create or replace function public.${end}`)[0] || "";

describe("Performance V2 Peer Review authority", () => {
  it("is dormant until a future whole month is configured and pins existing result models", () => {
    expect(sql).toContain("create table public.crew_performance_model_periods");
    expect(sql).not.toMatch(/insert into public\.crew_performance_model_periods/);
    expect(section("crew_performance_model", "crew_refresh_performance")).toContain("if found then return v_model");
    expect(section("crew_performance_model", "crew_refresh_performance")).toContain("'performance-v1'");
  });

  it("assigns only from completed overlapping coworker attendance and balances idempotently", () => {
    const overlap = section("crew_peer_worked_overlap", "crew_peer_worked_team");
    for (const condition of ["a.status = 'completed'", "b.status = 'completed'", "b.clock_in_at < a.clock_out_at", "b.clock_out_at > a.clock_in_at", "a.outlet_id = p_outlet_id", "lower(btrim(subject.position)) = 'service crew'"]) expect(overlap).toContain(condition);
    const open = section("crew_peer_open_month", "crew_peer_review_mobile");
    expect(open).toContain("when v_team_size >= 4 then 3 when v_team_size = 3 then 2 else 0");
    expect(open).toContain("on conflict (employee_id, period_start) do nothing");
    expect(open).toContain("on conflict (subject_id, reviewer_id, period_start) do nothing");
    expect(open).toContain("o.overlap_minutes desc");
    expect(open).toContain("where a.reviewer_id = o.reviewer_id");
    expect(open).toContain("performance v2 is not active for this month");
    expect(open).toContain("public.crew_performance_model(v_subject.employee_id, v_period) <> 'performance-v2'");
  });

  it("rejects self, duplicate, unassigned and unauthorized submissions", () => {
    expect(sql).toContain("check (subject_id <> reviewer_id)");
    expect(sql).toContain("unique (subject_id, reviewer_id, period_start)");
    const submit = section("crew_peer_review_submit", "crew_peer_review_component");
    expect(submit).toContain("public.crew_session_employee(p_token)");
    expect(submit).toContain("v_assignment.reviewer_id <> v_employee");
    expect(submit).toContain("v_assignment.submitted_at is not null");
    expect(submit).toContain("public.crew_peer_worked_overlap");
    expect(submit).toContain("status = 'finalized'");
    expect(sql).toContain("peer review ratings must be whole numbers from 1 to 5");
  });

  it("scores only sufficient non-excluded reviews and keeps Crew output anonymous", () => {
    const component = section("crew_peer_review_component", "crew_peer_review_admin");
    expect(component).toContain("v_valid < v_subject.required_count");
    expect(component).toContain("'score', null");
    expect(component).toContain("round(5 * (avg(public.crew_peer_review_score(a.criteria)) - 1) / 4, 2)");
    expect(component).toContain("left join public.crew_peer_review_exclusions");
    const mobile = section("crew_peer_review_mobile", "crew_peer_review_submit");
    expect(mobile).not.toContain("reviewer_name");
    expect(mobile).not.toContain("'criteria', a.criteria");
    expect(section("crew_peer_review_admin", "crew_peer_review_exclude")).toContain("'reviewer_name'");
    expect(section("crew_peer_review_exclude", "crew_performance_model")).toContain("excluded_by");
  });

  it("keeps V2 Customer pending and blocks finalization and Reward eligibility", () => {
    const refresh = section("crew_refresh_performance", "crew_performance_finalize");
    expect(refresh).toContain("'google_review_authority_not_available'");
    expect(refresh).toContain("customer_score = null");
    expect(refresh).toContain("total_score = null");
    expect(refresh).toContain("public.crew_performance_customer_component(p_employee_id, period)");
    const finalize = section("crew_performance_finalize", "crew_performance_mobile");
    expect(finalize).toContain("if result.calculation_version = 'performance-v2' then");
    expect(finalize).toContain("v2 customer review evidence is pending");
    expect(sql).toContain("'pending_component_names'");
  });

  it("does not grant direct table access or expose reviewer detail to Crew", () => {
    for (const name of ["crew_peer_review_subjects", "crew_peer_review_assignments", "crew_peer_review_exclusions"]) expect(sql).toContain(`alter table public.${name} enable row level security`);
    expect(sql).toContain("revoke all on public.crew_peer_review_subjects, public.crew_peer_review_assignments, public.crew_peer_review_exclusions from public, anon, authenticated");
    expect(sql).toContain("grant execute on function public.crew_peer_review_admin(uuid, date) to authenticated");
  });
});
