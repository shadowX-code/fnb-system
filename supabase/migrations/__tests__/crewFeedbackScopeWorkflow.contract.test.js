import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
const sql = fs.readFileSync(path.resolve("supabase/migrations/20260831185157_crew_feedback_scope_workflow.sql"), "utf8").toLowerCase();
describe("Customer Feedback scope workflow", () => {
  it("backfills legacy feedback as Crew evidence and separates employee attribution", () => { expect(sql).toContain("set scope = 'crew'"); expect(sql).toContain("scope in ('crew', 'food', 'outlet')"); expect(sql).toContain("scope = 'crew' and employee_id is not null"); expect(sql).toContain("scope in ('food', 'outlet') and employee_id is null"); });
  it("keeps non-Crew feedback out of Performance and scoring controls", () => { expect(sql).toContain("scope='crew' and submitted_at>=p_period"); expect(sql).toContain("only crew feedback has a scoring status"); expect(sql).toContain("only crew feedback can be attributed"); expect(sql).toContain("case when p_scope='crew' then 'included' else 'not_applicable' end"); });
  it("uses scoped server validation, token submission and existing rate/dedupe controls", () => { expect(sql).toContain("crew_feedback_submit_scoped"); expect(sql).toContain("crew_feedback_submit_public_v2"); expect(sql).toContain("too many feedback submissions"); expect(sql).toContain("feedback was already submitted for this visit"); expect(sql).toContain("taste','portion','temperature','presentation','value','freshness"); expect(sql).toContain("cleanliness','service speed','atmosphere','ordering','waiting time','comfort','overall value"); });
  it("keeps raw tables private and grants only the public RPC", () => { expect(sql).toContain("revoke all on function public.crew_feedback_submit_scoped"); expect(sql).toContain("grant execute on function public.crew_feedback_submit_public_v2"); });
});
