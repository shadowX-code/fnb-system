import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = fs.readFileSync(path.resolve("supabase/migrations/20260901074534_reward_campaign_finalization_readiness.sql"), "utf8").toLowerCase();

describe("Crew Reward finalization readiness contract", () => {
  it("allows only complete, legitimate Reward outcomes", () => {
    expect(sql).toContain("create or replace function public.crew_reward_finalization_readiness");
    expect(sql).toContain("e.status = 'awaiting_performance'");
    expect(sql).toContain("e.status = 'estimated'");
    expect(sql).toContain("e.status not in ('awaiting_performance', 'estimated', 'qualified', 'not_eligible')");
    expect(sql).toContain("participant_count > 0");
    expect(sql).toContain("entry_count = participant_count");
    expect(sql).toContain("cycle.calculated_at is not null");
  });

  it("blocks direct finalization atomically before any lifecycle mutation", () => {
    const finalizeStart = sql.indexOf("create or replace function public.crew_reward_finalize");
    const finalizeEnd = sql.indexOf("create or replace function public.crew_reward_admin_data", finalizeStart);
    const finalize = sql.slice(finalizeStart, finalizeEnd);
    expect(finalize).toContain("readiness := public.crew_reward_finalization_readiness(cycle.id)");
    expect(finalize).toContain("message = 'reward campaign is not ready to finalize.'");
    expect(finalize).toContain("detail = readiness::text");
    expect(finalize.indexOf("detail = readiness::text")).toBeLessThan(finalize.indexOf("update public.crew_reward_entries"));
    expect(finalize).toContain("for update");
    expect(finalize).toContain("current_user_has_permission('crew_reward.finalize')");
  });

  it("keeps readiness private while exposing the scoped Admin projection", () => {
    expect(sql).toContain("revoke all on function public.crew_reward_finalization_readiness(uuid) from public, anon, authenticated");
    expect(sql).toContain("'finalization_readiness', readiness");
    expect(sql).toContain("current_user_has_permission('crew_reward.view')");
    expect(sql).toContain("current_user_can_access_outlet(p_outlet_id)");
    expect(sql).toContain("revoke all on function public.crew_reward_finalize(uuid) from public, anon, authenticated");
    expect(sql).toContain("grant execute on function public.crew_reward_finalize(uuid) to authenticated");
  });
});
