import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const sql = fs.readFileSync(
  path.resolve("supabase/migrations/20260812125218_crew_growth_requirement_reference_scope_hardening.sql"),
  "utf8",
);

describe("Crew Growth requirement reference scope", () => {
  it("accepts only published evidence in the target outlet", () => {
    expect(sql).toMatch(/j\.outlet_id=v_outlet_id and j\.status='published'/);
    expect(sql).toMatch(/q\.status='published'/);
    expect(sql).toMatch(/v\.status='published' and s\.outlet_id=v_outlet_id/);
    expect(sql).toContain("Growth requirement evidence is unavailable for this outlet.");
  });

  it("keeps the authenticated authority narrow", () => {
    expect(sql).toContain("security definer set search_path=public");
    expect(sql).toContain("current_user_has_permission('crew_growth.manage')");
    expect(sql).toContain("revoke all on function public.crew_growth_save_skill(jsonb) from public,anon,authenticated");
    expect(sql).toContain("grant execute on function public.crew_growth_save_skill(jsonb) to authenticated");
  });
});
