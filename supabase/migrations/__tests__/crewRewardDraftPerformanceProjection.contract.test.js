import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = fs.readFileSync(path.resolve("supabase/migrations/20260901072453_crew_reward_draft_performance_projection.sql"), "utf8").toLowerCase();

describe("Crew Reward draft Performance projection contract", () => {
  it("derives only a non-persistent estimate from the canonical Reward formula", () => {
    expect(sql).toContain("create or replace function public.crew_reward_draft_projection");
    expect(sql).toContain("cycle.configured_pool * contribution_share");
    expect(sql).toContain("public.crew_reward_earn_rate(performance.total_score)");
    expect(sql).toContain("public.crew_reward_eligible_hours");
    expect(sql).toContain("'is_draft_performance_projection', true");
    expect(sql).not.toContain("insert into public.crew_reward_entries");
    expect(sql).not.toContain("update public.crew_reward_entries");
    expect(sql).not.toContain("update public.crew_reward_cycles");
  });

  it("uses only the token-bound Crew member's current usable draft Performance", () => {
    expect(sql).toContain("employee := public.crew_session_employee(p_token)");
    expect(sql).toContain("perform public.crew_refresh_performance(employee, period)");
    expect(sql).toContain("result.employee_id = p_employee_id");
    expect(sql).toContain("result.status = 'draft'");
    expect(sql).toContain("result.total_score is not null");
    expect(sql).toContain("participant.cycle_id = cycle.id");
  });

  it("keeps final and paid Reward history on the existing immutable path", () => {
    expect(sql).toContain("when current_row.entry_status in ('finalized', 'paid') then current_row.final_payout");
    expect(sql).toContain("and c.status in ('finalized', 'paid')");
    expect(sql).toContain("revoke all on function public.crew_reward_draft_projection(uuid,uuid,date) from public, anon, authenticated");
  });
});
