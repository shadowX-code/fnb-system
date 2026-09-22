import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const sql=readFileSync(resolve(process.cwd(),"supabase/migrations/202608110016_crew_learning_safe_snapshot_runtime_fix.sql"),"utf8");
describe("Crew safe snapshot runtime fix",()=>{
 it("uses unambiguous jsonb key deletion",()=>{
  expect(sql).toContain("(m->'module') - ('created_by'::text)");
  expect(sql).toContain("(a.journey_snapshot->'journey') - ('created_by'::text)");
  expect(sql).not.toContain("m->'module'-'created_by'");
 });
 it("retains safe ordering and ACLs",()=>{
  expect(sql).toContain("jsonb_agg(module_payload order by module_sort)");
  expect(sql).toContain("jsonb_agg(lesson_payload order by lesson_sort)");
  expect(sql).toContain("order by (b->>'sort_order')::int");
  expect(sql).toContain("jsonb_agg(question_payload order by question_sort)");
  expect(sql).toContain("order by (o->>'sort_order')::int");
  expect(sql).toContain("set search_path=public");
  expect(sql).toContain("revoke all on function public.crew_learning_assignment(text,uuid) from public,anon,authenticated;");
 });
});
