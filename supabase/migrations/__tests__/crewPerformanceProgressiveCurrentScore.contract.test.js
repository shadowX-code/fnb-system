import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = fs.readFileSync(path.resolve("supabase/migrations/20260901132039_crew_performance_progressive_current_score.sql"), "utf8").toLowerCase();
const reward = fs.readFileSync(path.resolve("supabase/migrations/20260813121018_crew_reward_tier_formula_v2.sql"), "utf8").toLowerCase();

describe("Crew Performance progressive current score contract", () => {
  it("projects mutable canonical components out of 100 without renormalizing", () => {
    expect(sql).toContain("add column if not exists current_score numeric(6,2)");
    expect(sql).toContain("current_total:=round(coalesce((attendance->>'score')::numeric,0)+coalesce(service_review.score,0)+coalesce((customer->>'score')::numeric,0)+coalesce((knowledge->>'score')::numeric,0)+coalesce(conduct_review.score,0),2)");
    expect(sql).toContain("total:=case when service_review.id is null or conduct_review.id is null then null else current_total end");
    expect(sql).toContain("'current_score',r.current_score");
  });

  it("does not weaken finalization immutability or Reward's finalized-only input", () => {
    expect(sql).toContain("status='finalized') then");
    expect(reward).toContain("and r.status = 'finalized'");
    expect(reward).toContain("'finalized performance is required.'");
  });
});
