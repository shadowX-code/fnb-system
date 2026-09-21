import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = fs.readFileSync(path.resolve("supabase/migrations/20260921210000_crew_performance_mobile_score_presentation.sql"), "utf8").toLowerCase();

describe("crew_performance_mobile score presentation contract", () => {
  it("projects mutable current scores without changing finalization authority", () => {
    expect(sql).toContain("create or replace function public.crew_performance_mobile");
    expect(sql).toContain("when result.status='finalized' then 'finalized'");
    expect(sql).toContain("when result.total_score is not null then 'complete'");
    expect(sql).toContain("when scored_components>0 then 'partial'");
    expect(sql).toContain("'current_score',result.current_score");
    expect(sql).toContain("'scored_components',scored_components");
    expect(sql).toContain("'pending_components',total_components-scored_components");
    expect(sql).toContain("when score_state='partial' then result.current_score");
    expect(sql).toContain("when score_state in ('complete','finalized') then result.total_score");
  });
});
