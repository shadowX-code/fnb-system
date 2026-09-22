import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/202608110008_crew_learning_authorities.sql"), "utf8");
describe("Crew Learning authorities", () => {
  it("keeps quiz answers server-scored and non-public", () => { expect(sql).toContain("v_selected=v_correct_ids"); expect(sql).toContain("revoke all on function public.crew_submit_quiz"); expect(sql).not.toContain("grant execute on function public.crew_submit_quiz(text,uuid,uuid,jsonb) to public"); });
  it("captures assignment version and an immutable snapshot", () => { expect(sql).toContain("journey_version_assigned"); expect(sql).toContain("journey_snapshot"); expect(sql).toContain("Journey must be published before assignment."); });
});
