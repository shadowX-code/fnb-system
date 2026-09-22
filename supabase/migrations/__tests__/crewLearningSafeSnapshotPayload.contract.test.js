import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const sql=readFileSync(resolve(process.cwd(),"supabase/migrations/202608110015_crew_learning_safe_snapshot_payload.sql"),"utf8");
describe("Crew safe snapshot payload",()=>{
 it("serializes all nested Crew content in deterministic sort order",()=>{
  expect(sql).toContain("jsonb_agg(module_payload order by module_sort)");
  expect(sql).toContain("jsonb_agg(lesson_payload order by lesson_sort)");
  expect(sql).toContain("order by (b->>'sort_order')::int");
  expect(sql).toContain("jsonb_agg(question_payload order by question_sort)");
  expect(sql).toContain("order by (o->>'sort_order')::int");
 });
 it("constructs only safe quiz fields without correct mappings",()=>{
  expect(sql).toContain("'question_type',q->'question_type'");
  expect(sql).toContain("'id',o->'id'");
  expect(sql).not.toContain("'is_correct',o->'is_correct'");
  expect(sql).not.toContain("correct_option_ids");
  expect(sql).not.toContain("journey_snapshot',a.journey_snapshot");
 });
 it("is session-owned and explicit-grant only",()=>{expect(sql).toContain("id=p_assignment_id and employee_id=e");expect(sql).toContain("set search_path=public");expect(sql).toContain("revoke all on function public.crew_learning_assignment(text,uuid) from public,anon,authenticated;");expect(sql).toContain("grant execute on function public.crew_learning_assignment(text,uuid) to anon,authenticated;");});
});
