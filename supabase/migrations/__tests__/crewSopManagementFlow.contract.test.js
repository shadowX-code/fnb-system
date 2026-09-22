import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const sql = fs.readFileSync(
  path.resolve("supabase/migrations/20260815000100_crew_sop_management_flow.sql"),
  "utf8",
).toLowerCase();

describe("Crew SOP management flow migration", () => {
  it("adds sanitized library dependency counts without returning snapshot content", () => {
    expect(sql).toContain("create or replace function public.crew_sop_admin_library");
    expect(sql).toContain("'current_onboarding_count'");
    expect(sql).toContain("'pinned_assignment_count'");
    expect(sql).not.toContain("'journey_snapshot', assignment.journey_snapshot");
    expect(sql).not.toContain("'body', section");
  });

  it("uses a controlled outlet-scoped category lifecycle", () => {
    expect(sql).toContain("create or replace function public.crew_manage_sop_category");
    expect(sql).toContain("current_user_has_permission('crew_sop.manage')");
    expect(sql).toContain("current_user_can_access_outlet(p_outlet_id)");
    expect(sql).toContain("reassign them before deleting it");
    expect(sql).toContain("perform public.crew_begin_learning_transition()");
  });

  it("fixes search paths and exposes both authorities only to authenticated admins", () => {
    expect(sql.match(/security definer/g)).toHaveLength(2);
    expect(sql.match(/set search_path = ''/g)).toHaveLength(2);
    for (const signature of [
      "crew_sop_admin_library(uuid)",
      "crew_manage_sop_category(uuid, text, uuid, text, integer)",
    ]) {
      expect(sql).toContain(`revoke all on function public.${signature} from public, anon, authenticated`);
      expect(sql).toContain(`grant execute on function public.${signature} to authenticated`);
    }
  });
});
