import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260812012742_crew_learning_architecture_reset.sql",
  ),
  "utf8",
);

describe("Crew Learning architecture reset migration", () => {
  it("keeps immutable history while identifying outlet onboarding lineages", () => {
    expect(sql).toContain("add column if not exists lineage_id uuid");
    expect(sql).toContain("is_mandatory_onboarding boolean not null default false");
    expect(sql).toContain("enrollment_source in ('automatic', 'admin', 'legacy')");
    expect(sql).not.toContain("delete from public.crew_journey_assignments");
    expect(sql).not.toContain("delete from public.crew_lesson_progress");
    expect(sql).not.toContain("delete from public.crew_quiz_attempts");
    expect(sql).not.toContain("delete from public.crew_sop_acknowledgements");
  });

  it("creates one outlet category architecture with RLS", () => {
    expect(sql).toContain("create table public.crew_sop_categories");
    expect(sql).toContain("alter table public.crew_sop_categories enable row level security");
    expect(sql).toContain("public.current_user_can_access_outlet(outlet_id)");
    expect(sql).toContain("SOP category must belong to the same outlet");
  });

  it("automatically enrolls eligible Crew without replacing an existing snapshot", () => {
    expect(sql).toContain("crew_ensure_onboarding_assignment");
    expect(sql).toContain("crew_auto_enroll_on_access_change");
    expect(sql).toContain("crew_sync_onboarding_enrollments");
    expect(sql).toContain("if existing_assignment_id is not null then");
    expect(sql).toContain("snapshot := public.crew_assignment_snapshot(onboarding_id)");
    expect(sql).toContain("'automatic'");
  });

  it("provides the documented eight-module default shell", () => {
    for (const title of [
      "Welcome & Workplace",
      "Customer Arrival & Greeting",
      "Taking Orders",
      "Serving & Table Service",
      "Cleaning & Hygiene",
      "Take Away & Packaging",
      "Opening & Closing",
      "Final & Role Readiness",
    ]) {
      expect(sql).toContain(title);
    }
    expect(sql).toContain("New Crew Onboarding must contain exactly eight modules");
  });

  it("clones into independent target draft rows and remaps SOP references", () => {
    expect(sql).toContain("crew_clone_learning_setup");
    expect(sql).toContain("Choose a different source outlet");
    expect(sql).toContain("pg_temp.crew_clone_sop_map");
    expect(sql).toContain("jsonb_set(source_block.payload, '{sop_id}'");
    expect(sql).toContain("'status', 'draft'");
  });

  it("exposes only session-bound Crew onboarding and outlet SOP authorities", () => {
    for (const signature of [
      "public.crew_learning_home(text)",
      "public.crew_sop_library(text)",
      "public.crew_sop_version(text, uuid)",
      "public.crew_acknowledge_sop(text, uuid, text)",
    ]) {
      expect(sql).toContain(`revoke all on function ${signature} from public, anon, authenticated`);
      expect(sql).toContain(`grant execute on function ${signature} to anon, authenticated`);
    }
    expect(sql).toContain("public.crew_session_employee(p_token)");
    expect(sql).toContain("'direct_library', 'journey', 'required_update'");
    expect(sql).not.toContain("service_role");
  });

  it("keeps privileged helpers private and Admin authorities permission-scoped", () => {
    for (const signature of [
      "public.crew_current_onboarding_for_outlet(uuid)",
      "public.crew_ensure_onboarding_assignment(uuid)",
      "public.crew_auto_enroll_on_access_change()",
    ]) {
      expect(sql).toContain(`revoke all on function ${signature} from public, anon, authenticated`);
    }
    expect(sql).toContain("current_user_has_permission('crew_learning.manage')");
    expect(sql).toContain("current_user_has_permission('crew_sop.manage')");
    expect(sql).toContain("set search_path = public");
  });
});
