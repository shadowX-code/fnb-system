import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const sql = fs.readFileSync(
  path.resolve("supabase/migrations/20260814130204_crew_learning_admin_read_models.sql"),
  "utf8",
).toLowerCase();

describe("Crew Learning Admin read models", () => {
  it("defines lightweight list and deferred detail authorities", () => {
    for (const functionName of [
      "crew_admin_onboarding_list",
      "crew_admin_onboarding_detail",
      "crew_sop_admin_library",
      "crew_sop_admin_detail",
    ]) expect(sql).toContain(`create or replace function public.${functionName}`);
    expect(sql).toContain("'modules'");
    expect(sql).toContain("'lessons'");
    expect(sql).toContain("'versions'");
    expect(sql).toContain("'sections'");
  });

  it("keeps heavy editor content out of the initial list functions", () => {
    const onboardingList = sql.split("create or replace function public.crew_admin_onboarding_list")[1]
      .split("create or replace function public.crew_admin_onboarding_detail")[0];
    const sopList = sql.split("create or replace function public.crew_sop_admin_library")[1]
      .split("create or replace function public.crew_sop_admin_detail")[0];
    expect(onboardingList).not.toContain("crew_lesson_blocks");
    expect(onboardingList).not.toContain("crew_quiz_questions");
    expect(onboardingList).not.toContain("crew_quiz_options");
    expect(onboardingList).not.toContain("is_correct");
    expect(sopList).not.toContain("crew_sop_sections");
    expect(sopList).not.toContain("'body'");
  });

  it("uses fixed search paths, one permission boundary and explicit authenticated grants", () => {
    expect(sql.match(/security definer/g)).toHaveLength(4);
    expect(sql.match(/set search_path = ''/g)).toHaveLength(4);
    expect(sql.match(/current_user_has_permission\('crew_learning\.manage'\)/g)).toHaveLength(2);
    expect(sql.match(/current_user_has_permission\('crew_sop\.manage'\)/g)).toHaveLength(2);
    for (const signature of [
      "crew_admin_onboarding_list(uuid)",
      "crew_admin_onboarding_detail(uuid)",
      "crew_sop_admin_library(uuid)",
      "crew_sop_admin_detail(uuid)",
    ]) {
      expect(sql).toContain(`revoke all on function public.${signature} from public, anon, authenticated`);
      expect(sql).toContain(`grant execute on function public.${signature} to authenticated`);
    }
  });
});
