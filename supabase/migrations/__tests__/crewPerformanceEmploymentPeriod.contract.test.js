import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const period = fs.readFileSync(path.resolve("supabase/migrations/20260929055243_crew_performance_employment_period.sql"), "utf8").toLowerCase();
const reads = fs.readFileSync(path.resolve("supabase/migrations/20260929060145_crew_performance_period_read_closure.sql"), "utf8").toLowerCase();
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
    expect(refresh).toContain("public.crew_peer_review_component(p_employee_id,period)");
    expect(refresh).toContain("prs.outlet_id is distinct from outlet");
    expect(refresh).not.toContain("crew_team_review");
    expect(refresh).toContain("'google_review_authority_not_available'");
    expect(refresh).not.toContain("crew_growth_employee_outlet");
  });

  it("keeps corrections explicit and source evidence retained", () => {
    const correction = section(period, "crew_performance_recalculate_employment", "crew_performance_submit_review");
    expect(correction).toContain("status='finalized'");
    expect(correction).toContain("current_user_can_access_outlet(v_existing.outlet_id)");
    expect(correction).toContain("crew_refresh_performance(p_employee_id,v_period,true)");
    expect(correction).toContain("insert into public.audit_logs");
    expect(correction).not.toMatch(/delete from public\.(crew_peer_review_assignments|crew_customer_feedback|crew_performance_reviews)/);
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
});
