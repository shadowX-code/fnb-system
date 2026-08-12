import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const sql = fs.readFileSync(
  path.resolve("supabase/migrations/20260812122231_crew_growth_requirement_summary_runtime_fix.sql"),
  "utf8",
);

describe("Crew Growth requirement summary runtime fix", () => {
  it("reads required flags from jsonb evidence and keeps the authority private", () => {
    expect(sql).toContain("(e->>'required')::boolean");
    expect(sql).not.toMatch(/filter\(where required\)/);
    expect(sql).toContain("set search_path=public");
    expect(sql).toContain(
      "revoke all on function public.crew_growth_employee_skill(uuid,uuid) from public,anon,authenticated",
    );
  });
});
