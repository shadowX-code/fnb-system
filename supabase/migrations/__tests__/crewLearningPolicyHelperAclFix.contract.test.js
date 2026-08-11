import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260811171948_crew_learning_policy_helper_acl_fix.sql"), "utf8");

describe("Crew Learning policy helper ACL fix", () => {
  it("keeps policy helpers non-public while allowing authenticated RLS evaluation", () => {
    expect(sql).toContain("revoke all on function public.crew_learning_admin_can_access_journey(uuid) from public, anon, authenticated");
    expect(sql).toContain("grant execute on function public.crew_learning_admin_can_access_journey(uuid) to authenticated");
    expect(sql).toContain("revoke all on function public.crew_sop_admin_can_access_sop(uuid) from public, anon, authenticated");
    expect(sql).toContain("grant execute on function public.crew_sop_admin_can_access_sop(uuid) to authenticated");
  });
});
