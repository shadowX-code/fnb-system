import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = fs.readFileSync(path.resolve("supabase/migrations/20260814232104_crew_reward_campaign_participants.sql"), "utf8").toLowerCase();

describe("Crew Reward Campaign participant snapshot", () => {
  it("persists immutable Campaign membership and scopes creation", () => {
    expect(sql).toContain("create table public.crew_reward_participants");
    expect(sql).toContain("unique (cycle_id, employee_id)");
    expect(sql).toContain("current_user_has_permission('crew_reward.manage')");
    expect(sql).toContain("current_user_can_access_outlet(p_outlet_id)");
    expect(sql).toContain("one or more selected crew are outside this outlet or no longer eligible");
  });

  it("calculates only from frozen participants", () => {
    const start = sql.indexOf("create or replace function public.crew_reward_calculate");
    const end = sql.indexOf("create or replace function public.crew_reward_admin_data", start);
    const calculate = sql.slice(start, end);
    expect(calculate).toContain("from public.crew_reward_participants p");
    expect(calculate).toContain("participant_snapshot_id");
    expect(calculate).not.toContain("join public.crew_access ca");
  });

  it("keeps authorities explicit and fixed-path", () => {
    expect(sql.match(/security definer/g)?.length).toBeGreaterThanOrEqual(3);
    expect(sql.match(/set search_path = ''/g)?.length).toBeGreaterThanOrEqual(3);
    expect(sql).toContain("revoke all on function public.crew_reward_create_campaign");
    expect(sql).toContain("revoke all on function public.crew_reward_calculate");
    expect(sql).toContain("revoke all on function public.crew_reward_admin_data");
  });
});
