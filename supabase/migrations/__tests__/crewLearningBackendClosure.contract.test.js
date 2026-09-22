import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const sql=readFileSync(resolve(process.cwd(),"supabase/migrations/202608110010_crew_learning_backend_closure.sql"),"utf8");
describe("Crew Learning backend closure",()=>{
 it("derives module and journey state from assignment snapshots",()=>{expect(sql).toContain("jsonb_array_elements(coalesce(a.journey_snapshot->'modules'");expect(sql).toContain("crew_module_progress");expect(sql).toContain("required_modules=0 or completed_modules=required_modules");});
 it("keeps SOP read and acknowledgement session-bound and explicit",()=>{expect(sql).toContain("e:=public.crew_session_employee(p_token)");expect(sql).toContain("revoke all on function public.crew_sop_version");expect(sql).toContain("grant execute on function public.crew_acknowledge_sop");});
});
