import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = fs.readFileSync(path.resolve("supabase/migrations/20260820181109_crew_cash_count_denominations_ambiguity_fix.sql"), "utf8").toLowerCase();

describe("Crew Cash Checkout denomination ambiguity correction", () => {
  it("qualifies jsonb_each fields and preserves the strict MYR allowlist", () => {
    expect(sql).toContain("from jsonb_each(p_counts) as entry(key,value)");
    expect(sql).toContain("entry.value #>> '{}' as qty");
    expect(sql).toContain("denomination_value:=item.key::numeric");
    expect(sql).toContain("'0.50','0.20','0.10','0.05'");
  });

  it("keeps the low-level calculation helper unavailable to client roles", () => {
    expect(sql).toContain("set search_path=public");
    expect(sql).toContain("revoke all on function public.crew_cash_count_denominations(jsonb) from public,anon,authenticated");
  });
});
