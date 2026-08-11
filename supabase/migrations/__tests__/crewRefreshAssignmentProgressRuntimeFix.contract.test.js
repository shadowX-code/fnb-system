import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const sql=readFileSync(resolve(process.cwd(),"supabase/migrations/202608110018_crew_refresh_assignment_progress_runtime_fix.sql"),"utf8");
describe("Crew progress refresh runtime fix",()=>{
 it("uses a distinct module variable and remains internal",()=>{
  expect(sql).toContain("v_module_id uuid");
  expect(sql).toContain("values(a.id,v_module_id");
  expect(sql).toContain("revoke all on function public.crew_refresh_assignment_progress(uuid) from public,anon,authenticated;");
 });
});
