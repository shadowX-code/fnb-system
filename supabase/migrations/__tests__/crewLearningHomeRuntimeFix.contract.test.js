import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260812015242_crew_learning_home_runtime_fix.sql",
  ),
  "utf8",
);

describe("Crew Learning home reset runtime fix", () => {
  it("uses unambiguous variables and preserves the mobile authority boundary", () => {
    expect(sql).toContain("v_assignment_id uuid");
    expect(sql).toContain("p.assignment_id = v_assignment_id");
    expect(sql).not.toMatch(/\bassignment_id\s+uuid/);
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = public");
    expect(sql).toContain(
      "revoke all on function public.crew_learning_home(text) from public, anon, authenticated",
    );
    expect(sql).toContain(
      "grant execute on function public.crew_learning_home(text) to anon, authenticated",
    );
  });
});
