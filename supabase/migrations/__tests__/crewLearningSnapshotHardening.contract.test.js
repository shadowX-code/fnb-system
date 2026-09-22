import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const sql=readFileSync(resolve(process.cwd(),"supabase/migrations/202608110012_crew_learning_snapshot_hardening.sql"),"utf8");
describe("Crew immutable quiz snapshot",()=>{
 it("pins question and option scoring semantics only in an internal builder",()=>{expect(sql).toContain("'questions'");expect(sql).toContain("'is_correct',o.is_correct");expect(sql).toContain("revoke all on function public.crew_assignment_snapshot(uuid) from public,anon,authenticated;");});
});
