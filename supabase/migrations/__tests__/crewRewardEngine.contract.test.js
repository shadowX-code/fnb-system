import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = fs.readFileSync(path.resolve("supabase/migrations/20260812163541_crew_monthly_reward_engine.sql"), "utf8").toLowerCase();
const runtimeFix = fs.readFileSync(path.resolve("supabase/migrations/20260812164410_crew_reward_mark_paid_runtime_fix.sql"), "utf8").toLowerCase();
const strictCap = fs.readFileSync(path.resolve("supabase/migrations/20260812164932_crew_reward_strict_pool_cap.sql"), "utf8").toLowerCase();

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
});
