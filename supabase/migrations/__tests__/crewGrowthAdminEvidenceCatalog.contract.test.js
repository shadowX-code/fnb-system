import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const sql = fs.readFileSync(
  path.resolve("supabase/migrations/20260812135044_crew_growth_admin_evidence_catalog.sql"),
  "utf8",
);

describe("Crew Growth admin evidence catalog", () => {
  it("returns only published outlet-scoped evidence", () => {
    expect(sql).toMatch(/j\.outlet_id=p_outlet_id and j\.status='published' and m\.status='published'/);
    expect(sql).toMatch(/q\.status='published'/);
    expect(sql).toMatch(/s\.outlet_id=p_outlet_id and v\.status='published'/);
  });

  it("uses explicit authenticated permission and outlet authority", () => {
    expect(sql).toContain("security definer set search_path=public");
    expect(sql).toContain("current_user_can_access_outlet(p_outlet_id)");
    expect(sql).toContain("revoke all on function public.crew_growth_admin_evidence(uuid) from public,anon,authenticated");
    expect(sql).toContain("grant execute on function public.crew_growth_admin_evidence(uuid) to authenticated");
  });
});
