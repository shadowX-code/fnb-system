import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/202608110021_crew_learning_admin_lifecycle.sql"), "utf8");

describe("Crew Learning Admin lifecycle contract", () => {
  it("keeps published content behind scoped transition authorities", () => {
    expect(sql).toContain("create or replace function public.crew_publish_journey");
    expect(sql).toContain("create or replace function public.crew_new_journey_version");
    expect(sql).toContain("create or replace function public.crew_publish_sop_version");
    expect(sql).toContain("create or replace function public.crew_new_sop_version");
    expect(sql).toContain("current_user_has_permission('crew_learning.manage')");
    expect(sql).toContain("current_user_has_permission('crew_sop.manage')");
    expect(sql).toContain("revoke all on function public.crew_publish_journey(uuid) from public, anon, authenticated");
    expect(sql).toContain("grant execute on function public.crew_publish_journey(uuid) to authenticated");
  });

  it("guards published Journey and SOP content from loose draft CRUD", () => {
    expect(sql).toContain("Published journeys require a new version.");
    expect(sql).toContain("Published SOP versions are immutable.");
    expect(sql).toContain("create trigger crew_guard_published_journeys");
    expect(sql).toContain("create trigger crew_guard_published_sop_versions");
  });
});
