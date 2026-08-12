import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const sql = fs.readFileSync(path.resolve("supabase/migrations/20260812121447_crew_growth_state_runtime_fix.sql"), "utf8");

describe("Crew Growth state runtime fix", () => {
  it("qualifies certification state and keeps the state authority private", () => {
    expect(sql).toContain("c.status='certified'");
    expect(sql).toContain("v_status text");
    expect(sql).toContain("'status',v_status");
    expect(sql).toContain("revoke all on function public.crew_growth_employee_skill(uuid,uuid) from public,anon,authenticated");
  });
});
