import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = fs.readFileSync(path.resolve("supabase/migrations/20260812163541_crew_monthly_reward_engine.sql"), "utf8").toLowerCase();
const runtimeFix = fs.readFileSync(path.resolve("supabase/migrations/20260812164410_crew_reward_mark_paid_runtime_fix.sql"), "utf8").toLowerCase();
const strictCap = fs.readFileSync(path.resolve("supabase/migrations/20260812164932_crew_reward_strict_pool_cap.sql"), "utf8").toLowerCase();
const mobileRuntimeFix = fs.readFileSync(path.resolve("supabase/migrations/20260812170155_crew_reward_mobile_runtime_fix.sql"), "utf8").toLowerCase();
const tierV2 = fs.readFileSync(path.resolve("supabase/migrations/20260813121018_crew_reward_tier_formula_v2.sql"), "utf8").toLowerCase();

describe("Crew Reward engine migration contract", () => {
  it("keeps calculation server-derived and versioned", () => {
    expect(sql).toContain("calculation_version text not null default 'reward-v1'");
    expect(sql).toContain("crew_reward_eligible_hours");
    expect(sql).toContain("crew_reward_performance_factor");
    expect(sql).toContain("crew_reward_pool_unlock");
    expect(sql).toContain("payout_scale");
    expect(sql).toContain("estimated>unlocked+.01");
  });

  it("uses only finalized performance and completed attendance", () => {
    expect(sql).toContain("r.status='finalized'");
    expect(sql).toContain("status='completed'");
    expect(sql).toContain("clock_out_at is not null");
    expect(sql).not.toMatch(/employment_status[^\n]+part_time[^\n]+factor/);
  });

  it("makes finalized history immutable with audited adjustments", () => {
    expect(sql).toContain("finalized reward cycles are immutable");
    expect(sql).toContain("create table public.crew_reward_adjustments");
    expect(sql).toContain("adjusted_by uuid not null");
    expect(sql).toContain("adjustment reason is required");
  });

  it("denies direct table access and scopes all exposed authorities", () => {
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("revoke all on public.crew_reward_cycles");
    expect(sql).toContain("current_user_can_access_outlet");
    expect(sql).toContain("employee:=public.crew_session_employee(p_token)");
    expect(sql).toContain("set search_path=public");
    expect(sql).not.toMatch(/grant execute on function public\.crew_reward_(performance_factor|pool_unlock|eligible_hours)/);
  });

  it("returns a safe own-result mobile payload", () => {
    expect(sql).toContain("create or replace function public.crew_reward_mobile");
    expect(sql).not.toMatch(/crew_reward_mobile[\s\S]*employee_name/);
    expect(sql).not.toMatch(/crew_reward_mobile[\s\S]*adjustment.*reason/);
  });

  it("marks only finalized eligible entries paid", () => {
    expect(runtimeFix).toContain("where cycle_id=cycle.id and status='finalized'");
    expect(runtimeFix).not.toContain("status=case");
  });

  it("reconciles rounding and strictly caps every review payout", () => {
    expect(strictCap).toContain("crew_reward_reconcile_rounded_pool");
    expect(strictCap).toContain("rounding_reconciliation");
    expect(strictCap).toContain("crew_reward_enforce_entry_pool_cap");
    expect(strictCap).toContain("actual_payout <= unlocked_pool");
    expect(strictCap).toContain("set search_path=public");
    expect(strictCap).toContain("from public,anon,authenticated");
  });

  it("keeps token-bound mobile reads writable for session activity", () => {
    expect(mobileRuntimeFix).toContain("alter function public.crew_reward_mobile(text,date) volatile");
  });

  it("uses the approved contribution-share and exact performance tier formula", () => {
    expect(tierV2).toContain("when p_score >= 95 then 1.00");
    expect(tierV2).toContain("when p_score >= 90 then 0.90");
    expect(tierV2).toContain("when p_score >= 85 then 0.80");
    expect(tierV2).toContain("when p_score >= 80 then 0.65");
    expect(tierV2).toContain("when p_score >= 75 then 0.45");
    expect(tierV2).toContain("when p_score >= 70 then 0.20");
    expect(tierV2).toContain("cycle.configured_pool * (eligible_hours / total_hours) * performance_factor");
    expect(tierV2).not.toContain("payout_scale");
  });

  it("returns projections and formula inputs without other Crew or adjustment data", () => {
    expect(tierV2).toContain("'maximum_share', maximum_share");
    expect(tierV2).toContain("'total_eligible_hours', round(total_hours, 2)");
    expect(tierV2).toContain("'earn_rate_tiers'");
    expect(tierV2).toContain("employee := public.crew_session_employee(p_token)");
    expect(tierV2).not.toMatch(/create or replace function public\.crew_reward_mobile[\s\S]*'employee_name'/);
    expect(tierV2).not.toMatch(/create or replace function public\.crew_reward_mobile[\s\S]*adjustment.*reason/);
    expect(tierV2).toContain("revoke all on function public.crew_reward_mobile(text,date) from public, anon, authenticated");
  });
});
