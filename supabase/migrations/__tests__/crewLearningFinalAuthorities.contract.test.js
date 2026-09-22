import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const sql=readFileSync(resolve(process.cwd(),"supabase/migrations/202608110011_crew_learning_final_authorities.sql"),"utf8");
describe("Crew Learning final lesson authority",()=>{
 it("binds completion to session ownership and immutable snapshot",()=>{expect(sql).toContain("public.crew_session_employee(p_token)");expect(sql).toContain("id=p_assignment_id and employee_id=e");expect(sql).toContain("a.journey_snapshot->'modules'");});
 it("blocks required quizzes and derives progress internally",()=>{expect(sql).toContain("unmet_requirements");expect(sql).toContain("public.crew_refresh_assignment_progress(a.id)");expect(sql).toContain("x.passed");});
 it("has explicit mobile-only execute ACL",()=>{expect(sql).toContain("revoke all on function public.crew_complete_lesson(text,uuid,uuid) from public,anon,authenticated;");expect(sql).toContain("grant execute on function public.crew_complete_lesson(text,uuid,uuid) to anon,authenticated;");});
});
