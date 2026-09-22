import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260812021500_crew_learning_admin_outlet_visibility.sql",
  ),
  "utf8",
).toLowerCase();

describe("Crew Learning Admin outlet visibility", () => {
  it("grants only scoped authenticated outlet reads for intended Learning permissions", () => {
    expect(sql).toContain("on public.outlets");
    expect(sql).toContain("for select");
    expect(sql).toContain("to authenticated");
    expect(sql).toContain("crew_learning.manage");
    expect(sql).toContain("crew_sop.manage");
    expect(sql).toContain("current_user_can_access_outlet(id)");
    expect(sql).not.toContain("for all");
    expect(sql).not.toContain("to anon");
  });
});
