import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260902031725_crew_onboarding_clone_integrity.sql"),
  "utf8",
);

describe("Crew Onboarding clone integrity", () => {
  it("uses the source outlet latest published onboarding and leaves destination publication intact", () => {
    expect(sql).toContain("crew_current_onboarding_for_outlet(p_source_outlet_id)");
    expect(sql).toContain("status = 'draft'");
    expect(sql).toContain("The destination already has an Onboarding draft");
    expect(sql).not.toContain("status in ('draft', 'published')");
  });

  it("copies independent learning structure, quizzes and localization without Crew history", () => {
    for (const table of [
      "crew_journey_modules",
      "crew_lessons",
      "crew_lesson_blocks",
      "crew_quizzes",
      "crew_quiz_questions",
      "crew_quiz_options",
      "crew_localized_content_units",
      "crew_localized_content_translations",
    ]) expect(sql).toContain(`public.${table}`);
    expect(sql).not.toContain("insert into public.crew_journey_assignments");
    expect(sql).not.toContain("insert into public.crew_lesson_progress");
    expect(sql).not.toContain("insert into public.crew_quiz_attempts");
  });

  it("maps only destination-owned published SOPs and copies learning media through an explicit manifest", () => {
    expect(sql).toContain("target_sop.outlet_id = p_target_outlet_id");
    expect(sql).toContain("target_sop.status = 'published'");
    expect(sql).toContain("crew_onboarding_clone_media_map");
    expect(sql).toContain("'media_copies', media_manifest");
    expect(sql).toContain("crew_abort_onboarding_clone");
  });

  it("keeps clone preview and clone RPC permission- and outlet-scoped", () => {
    expect(sql).toContain("crew_admin_onboarding_clone_preview");
    expect(sql).toContain("current_user_has_permission('crew_learning.manage')");
    expect(sql).toContain("current_user_can_access_outlet(p_source_outlet_id)");
    expect(sql).toContain("current_user_can_access_outlet(p_target_outlet_id)");
    expect(sql).toContain("revoke all on function public.crew_clone_onboarding(uuid, uuid) from public, anon, authenticated");
  });
});
