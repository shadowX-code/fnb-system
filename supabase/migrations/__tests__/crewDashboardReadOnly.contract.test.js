import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260921221500_crew_dashboard_performance_read_only.sql"), "utf8").toLowerCase();

describe("crew Dashboard read-only Performance attention", () => {
  it("does not compose the mutating Performance Admin payload", () => {
    expect(sql).toContain("stable");
    expect(sql).toContain("from public.crew_performance_results result");
    expect(sql).not.toContain("crew_performance_admin_data");
    expect(sql).not.toContain("crew_refresh_performance");
    expect(sql).not.toMatch(/\binsert\s+into\b/i);
    expect(sql).not.toMatch(/\bupdate\s+public\./i);
    expect(sql).not.toMatch(/\bdelete\s+from\b/i);
  });
});
