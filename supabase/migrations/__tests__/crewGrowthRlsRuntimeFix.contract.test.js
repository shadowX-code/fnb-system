import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const sql = fs.readFileSync(path.resolve("supabase/migrations/20260812121319_crew_growth_rls_policy_runtime_fix.sql"), "utf8");

describe("Crew Growth RLS runtime fix", () => {
  it("inlines permission and outlet predicates without exposing the private helper", () => {
    for (const policy of ["crew_skill_positions_view", "crew_skill_outlets_view", "crew_skill_requirements_view", "crew_practical_assessments_view", "crew_skill_certifications_view"]) expect(sql).toContain(`create policy ${policy}`);
    expect(sql).toContain("current_user_has_permission('crew_growth.view')");
    expect(sql).toContain("current_user_can_access_outlet(s.outlet_id)");
    expect(sql).toContain("revoke all on function public.crew_growth_can_access_skill(uuid,text) from public,anon,authenticated");
  });
});
