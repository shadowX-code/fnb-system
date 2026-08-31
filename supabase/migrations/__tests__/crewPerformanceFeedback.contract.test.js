import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const sql = fs.readFileSync(path.resolve("supabase/migrations/20260812154112_crew_performance_feedback_engine.sql"), "utf8").toLowerCase();
const scopeFix = fs.readFileSync(path.resolve("supabase/migrations/20260812155805_crew_performance_admin_payload_scope_fix.sql"), "utf8").toLowerCase();
const integrity = fs.readFileSync(path.resolve("supabase/migrations/20260831171519_crew_feedback_evidence_integrity.sql"), "utf8").toLowerCase();

describe("Crew Performance and Customer Feedback engine", () => {
  it("keeps the 100 point calculation server-derived and versioned", () => {
    expect(sql).toContain("check(attendance_score between 0 and 30)");
    expect(sql).toContain("check(service_score between 0 and 30)");
    expect(sql).toContain("check(customer_score between 0 and 15)");
    expect(sql).toContain("check(knowledge_score between 0 and 15)");
    expect(sql).toContain("check(conduct_score between 0 and 10)");
    expect(sql).toContain("performance-v1");
    expect(sql).toContain("finalized performance is immutable");
  });

  it("uses session-bound safe mobile reads and controlled public feedback", () => {
    expect(sql).toContain("employee:=public.crew_session_employee(p_token)");
    expect(sql).not.toMatch(/crew_performance_mobile\([\s\S]*p_employee_id/);
    expect(sql).toContain("grant execute on function public.crew_feedback_submit");
    expect(sql).toContain("feedback was already submitted");
    expect(sql).toContain("too many feedback submissions");
  });

  it("locks table access and explicitly grants each authority", () => {
    expect(sql).toContain("revoke all on public.crew_performance_reviews,public.crew_customer_feedback");
    for (const name of ["crew_performance_submit_review", "crew_performance_finalize", "crew_performance_admin_data", "crew_feedback_moderate", "crew_feedback_public_crew", "crew_feedback_submit", "crew_performance_mobile"]) {
      expect(sql).toContain(`revoke all on function public.${name}`);
    }
    expect(sql.match(/security definer set search_path=public/g)?.length).toBeGreaterThanOrEqual(10);
  });

  it("does not expose manager notes or moderation reasons to Crew", () => {
    expect(sql).toContain("-('manager_note'::text)");
    expect(sql).toContain("-('moderation_reason'::text)");
    expect(sql).not.toContain("guest_performance_score");
  });

  it("segments Admin payload fields by Performance, Review and Feedback permission", () => {
    expect(scopeFix).toContain("can_performance boolean:=public.current_user_has_permission('crew_performance.view')");
    expect(scopeFix).toContain("can_feedback boolean:=public.current_user_has_permission('crew_feedback.view')");
    expect(scopeFix).toContain("can_review boolean:=public.current_user_has_permission('crew_performance.review')");
    expect(scopeFix).toContain("if can_feedback then");
    expect(scopeFix).toContain("if can_review then");
    expect(scopeFix).toContain("-('manager_note'::text)-('criteria'::text)");
  });

  it("keeps feedback moderation and attribution corrections server-authoritative and append-only", () => {
    expect(integrity).toContain("create table public.crew_feedback_attribution_audit");
    expect(integrity).toContain("create or replace function public.crew_feedback_moderate");
    expect(integrity).toContain("create or replace function public.crew_feedback_correct_attribution");
    expect(integrity).toContain("a meaningful moderation reason is required");
    expect(integrity).toContain("a meaningful attribution correction reason is required");
    expect(integrity).toContain("insert into public.crew_feedback_moderation_audit");
    expect(integrity).toContain("insert into public.crew_feedback_attribution_audit");
    expect(integrity).toContain("crew_feedback.correct_attribution");
  });

  it("refreshes only mutable evidence paths while preserving finalized Performance", () => {
    expect(integrity).toContain("r.status='finalized'");
    expect(integrity).toContain("perform public.crew_refresh_performance");
    expect(sql).toContain("if exists(select 1 from public.crew_performance_results where employee_id=p_employee_id and period_start=period and status='finalized') then return");
  });
});
