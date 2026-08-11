import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const sql=readFileSync(resolve(process.cwd(),"supabase/migrations/202608110017_crew_pinned_sop_acknowledgement_gating.sql"),"utf8");
describe("Pinned SOP acknowledgement gating",()=>{
 it("freezes published SOP version metadata in the assignment snapshot",()=>{
  expect(sql).toContain("'sop_version_id',sv.sop_version_id");
  expect(sql).toContain("'required_acknowledgement',sv.require_acknowledgement");
  expect(sql).toContain("order by v.version desc limit 1");
 });
 it("gates lesson completion on employee acknowledgement of the exact pinned version",()=>{
  expect(sql).toContain("ack.employee_id=e and ack.sop_version_id=(sop_ref->'payload'->>'sop_version_id')::uuid");
  expect(sql).toContain("'type','sop_acknowledgement'");
  expect(sql).toContain("id=p_assignment_id and employee_id=e for update");
 });
 it("keeps the controlled authorities session-bound and explicit",()=>{
  expect(sql).toContain("e:=public.crew_session_employee(p_token)");
  expect(sql).toContain("revoke all on function public.crew_complete_lesson(text,uuid,uuid) from public,anon,authenticated;");
 });
});
