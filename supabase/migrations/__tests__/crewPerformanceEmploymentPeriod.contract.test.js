import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const period = fs.readFileSync(path.resolve("supabase/migrations/20260929055243_crew_performance_employment_period.sql"), "utf8").toLowerCase();
const reads = fs.readFileSync(path.resolve("supabase/migrations/20260929060145_crew_performance_period_read_closure.sql"), "utf8").toLowerCase();
const team = fs.readFileSync(path.resolve("supabase/migrations/20260929061618_crew_performance_team_review_period_outlet.sql"), "utf8").toLowerCase();
const forward = fs.readFileSync(path.resolve("supabase/migrations/20260929140954_crew_performance_team_review_forward.sql"), "utf8").toLowerCase();
const section = (sql, start, end) => sql.split(`function public.${start}`)[1]?.split(`function public.${end}`)[0] || "";

describe("Performance period employment authority", () => {
  it("resolves People revisions by date, fails closed before cutover and rejects mixed months", () => {
    const resolver = section(period, "crew_performance_period_employment", "crew_performance_employment_needs_review");
    expect(resolver).toContain("employee_employment_assignment_at(p_employee_id,v_day)");
    expect(resolver).toContain("'state','unresolved'");
    expect(resolver).toContain("'state','mixed'");
    expect(resolver).toContain("v_revision.position,v_revision.workplace,v_revision.employment_status");
    expect(resolver).toContain("'revision_ids',v_revisions");
    expect(resolver).not.toContain("v_employee.position");
    expect(resolver).not.toContain("crew_access");
  });

  it("pins open assignment evidence and never recomputes finalized results", () => {
    const refresh = section(period, "crew_refresh_performance(p_employee_id uuid,p_period date,p_confirm_employment boolean)", "crew_refresh_performance(p_employee_id uuid,p_period date)");
    expect(refresh).toContain("if v_existing.status='finalized' then return v_existing.id");
    expect(refresh).toContain("if v_employment->>'state'<>'eligible' then return v_existing.id");
    expect(refresh).toContain("crew_performance_employment_needs_review");
    expect(refresh).toContain("'employment',v_employment");
    expect(refresh).toContain("and outlet_id=outlet");
    expect(refresh).toContain("'google_review_authority_not_available'");
    expect(refresh).not.toContain("crew_growth_employee_outlet");
  });

  it("moves Production's already-ledgered refresh to period-scoped Team Review with a forward migration", () => {
    const refresh = section(forward, "crew_refresh_performance(p_employee_id uuid,p_period date,p_confirm_employment boolean)", "crew_refresh_performance(p_employee_id uuid,p_period date)");
    expect(refresh).toContain("team_review:=public.crew_team_review_performance_component(p_employee_id,period)");
    expect(refresh).toContain("if v_existing.status='finalized' then return v_existing.id");
    expect(refresh).toContain("'employment',v_employment");
    expect(refresh).not.toContain("crew_peer_review_component");
    expect(forward).toContain("create or replace function public.crew_refresh_performance(p_employee_id uuid,p_period date)");
    expect(forward).toContain("public.crew_refresh_performance(p_employee_id,p_period,false)");
  });

  it("keeps corrections explicit and source evidence retained", () => {
    const correction = section(period, "crew_performance_recalculate_employment", "crew_performance_submit_review");
    expect(correction).toContain("status='finalized'");
    expect(correction).toContain("current_user_can_access_outlet(v_existing.outlet_id)");
    expect(correction).toContain("crew_refresh_performance(p_employee_id,v_period,true)");
    expect(correction).toContain("insert into public.audit_logs");
    expect(correction).not.toMatch(/delete from public\.(crew_team_reviews|crew_customer_feedback|crew_performance_reviews)/);
  });

  it("presents period position/outlet and masks stale Admin/Crew reads", () => {
    const admin = section(period, "crew_performance_admin_data", "crew_performance_mobile");
    expect(admin).toContain("crew_performance_period_employment(employee.id,period)");
    expect(admin).toContain("crew_performance_period_result_projection(v_result,v_employment,can_review)");
    expect(admin).toContain("v_result.components->'employment'->>'position'");
    expect(admin).not.toContain("e.position");
    expect(reads).toContain("employment_review_required");
    expect(reads).toContain("crew_performance_employment_needs_review(v_trend_result,v_trend_employment)");
    expect(reads).toContain("case when v_trend_pending then null else v_trend_result.total_score end");
  });

  it("consumes Team Review evidence from the Performance-period outlet without changing its own workflow", () => {
    const scoped = section(team, "crew_team_review_result_scoped", "crew_team_review_result(p_employee_id uuid,p_period date)");
    expect(team).toContain("crew_team_review_result_scoped(p_employee_id uuid,p_period date,p_outlet_id uuid)");
    for (const retainedAuthority of ["crew_team_review_eligible_pairs", "crew_team_review_live_pairs", "crew_team_review_exclusions", "crew_team_review_mean", "crew_team_admin_reviews", "v_window.frozen"]) {
      expect(scoped).toContain(retainedAuthority);
    }
    expect(team).toContain("public.crew_growth_employee_outlet(p_employee_id));");
    const adapter = section(team, "crew_team_review_performance_component", "crew_team_review_performance_component_not_present");
    expect(adapter).toContain("crew_performance_period_employment(p_employee_id,p_period)");
    expect(adapter).toContain("(v_assignment->>'outlet_id')::uuid");
    expect(adapter).not.toContain("crew_growth_employee_outlet");
    expect(team).not.toMatch(/delete from public\.crew_team_reviews/);
  });
});
