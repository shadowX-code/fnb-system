import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/202608110009_crew_learning_snapshot_reads.sql"), "utf8");
describe("Crew Learning snapshot and safe read authority", () => {
  it("pins ordered modules, lessons and blocks at assignment", () => { expect(sql).toContain("journey_snapshot"); expect(sql).toContain("order by m.sort_order"); expect(sql).toContain("order by l.sort_order"); expect(sql).toContain("order by b.sort_order"); });
  it("binds reads to the Crew session employee and explicit mobile grant", () => { expect(sql).toContain("where id=p_assignment_id and employee_id=v_employee"); expect(sql).toContain("revoke all on function public.crew_learning_assignment(text,uuid) from public,anon,authenticated;"); expect(sql).toContain("grant execute on function public.crew_learning_assignment(text,uuid) to anon,authenticated;"); });
  it("does not serialise correct quiz-answer fields into the Crew payload", () => expect(sql).not.toContain("is_correct"));
});
