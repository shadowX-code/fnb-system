import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = fs.readFileSync(path.resolve("supabase/migrations/20260901125737_crew_performance_service_standards_v2.sql"), "utf8").toLowerCase();

describe("Crew Performance Service Standards v2", () => {
  it("uses the five current criteria and an observed-only denominator", () => {
    for (const key of ["welcome_greeting", "thank_you_goodbye", "grooming", "work_area_cleanliness", "guest_interaction"]) expect(sql).toContain(`'${key}'`);
    expect(sql).not.toContain("'initiative'");
    expect(sql).toContain("jsonb_array_length(p_criteria)<>cardinality(required_keys)");
    expect(sql).toContain("if rating<>'not_observed' then observed:=observed+1");
    expect(sql).toContain("round(max_points*earned/observed,2)");
    expect(sql).toContain("'max_score',max_points");
  });

  it("keeps final Performance and review history closed to new review evidence", () => {
    expect(sql).toContain("where employee_id=p_employee_id and period_start=period and status='finalized'");
    expect(sql).toContain("message='finalized performance cannot receive new review evidence.'");
    expect(sql).toContain("public.crew_refresh_performance(p_employee_id,period)");
    expect(sql.match(/pg_advisory_xact_lock/g)).toHaveLength(2);
    expect(sql).toContain("revoke all on function public.crew_performance_submit_review(uuid,date,text,jsonb,text)");
    expect(sql).toContain("grant execute on function public.crew_performance_submit_review(uuid,date,text,jsonb,text) to authenticated");
  });
});
