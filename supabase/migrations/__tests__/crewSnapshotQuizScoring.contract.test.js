import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const sql=readFileSync(resolve(process.cwd(),"supabase/migrations/202608110014_crew_snapshot_quiz_scoring.sql"),"utf8");
describe("Crew snapshot quiz scoring",()=>{
 it("scores only from assignment snapshot and safe response",()=>{expect(sql).toContain("a.journey_snapshot->'modules'");expect(sql).toContain("q->'questions'");expect(sql).toContain("'attempt_id'");expect(sql).not.toContain("correct_option_ids");});
 it("rejects malformed, duplicate and unexpected answer shapes",()=>{expect(sql).toContain("Quiz answers must be a non-empty array.");expect(sql).toContain("Duplicate quiz option.");expect(sql).toContain("unexpected question");});
});
