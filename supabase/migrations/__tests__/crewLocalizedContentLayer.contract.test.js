import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const migration = fs.readFileSync(path.resolve("supabase/migrations/20260821123000_crew_localized_content_layer.sql"), "utf8");
const fallbackFix = fs.readFileSync(path.resolve("supabase/migrations/20260821123100_crew_localized_content_fallback_status_fix.sql"), "utf8");
const adminUnitIdsFix = fs.readFileSync(path.resolve("supabase/migrations/20260821150000_crew_localized_content_admin_unit_ids.sql"), "utf8");
const legacySnapshotBackfill = fs.readFileSync(path.resolve("supabase/migrations/20260821162000_backfill_crew_localized_snapshots.sql"), "utf8");
const edge = fs.readFileSync(path.resolve("supabase/functions/crew-content-translate/index.ts"), "utf8");

describe("Crew localized business content contract", () => {
  it("stores version-bound source units, translations and immutable audit history", () => {
    expect(migration).toContain("create table public.crew_localized_content_units");
    expect(migration).toContain("unique(domain, version_id, unit_key)");
    expect(migration).toContain("create table public.crew_localized_content_translations");
    expect(migration).toContain("create table public.crew_localized_content_audit");
    expect(migration).toContain("status='outdated'");
  });

  it("freezes language snapshots at publish, assignment and Task instance boundaries", () => {
    expect(migration).toContain("localized_content_snapshot");
    expect(migration).toContain("zz_crew_sop_localization_freeze");
    expect(migration).toContain("zz_crew_onboarding_localization_freeze");
    expect(migration).toContain("zz_crew_task_localization_freeze");
    expect(migration).toContain("zz_crew_assignment_localization_snapshot");
    expect(migration).toContain("zz_crew_task_instance_localization_snapshot");
  });

  it("backfills legacy published versions and historical Crew snapshots without overwriting existing frozen state", () => {
    expect(legacySnapshotBackfill).toContain("crew_localization_snapshot('onboarding', j.id)");
    expect(legacySnapshotBackfill).toContain("crew_localization_snapshot('task', t.id)");
    expect(legacySnapshotBackfill).toContain("where not (coalesce(a.journey_snapshot, '{}'::jsonb) ? 'localized_content')");
    expect(legacySnapshotBackfill).toContain("where not (coalesce(i.template_snapshot, '{}'::jsonb) ? 'localized_content')");
  });

  it("keeps Admin writes permission/outlet scoped and Crew reads session bound", () => {
    expect(migration).toContain("current_user_has_permission(context->>'permission')");
    expect(migration).toContain("current_user_can_access_outlet");
    expect(migration).toContain("crew_session_employee(p_token)");
    expect(migration).toContain("a.employee_id=v_employee_id");
    expect(migration).toContain("s.outlet_id=v_employee_outlet");
    expect(migration).toContain("revoke all on function public.crew_localized_content");
  });

  it("never serves an outdated translation as a Crew fallback", () => {
    expect(fallbackFix).toContain("in ('ai_translated','reviewed')");
    expect(fallbackFix).toContain("A translation marked outdated must never override the current source content.");
    expect(fallbackFix).toContain("crew_session_employee(p_token)");
  });

  it("fixes search paths and withholds internal helpers from clients", () => {
    for (const name of ["crew_localization_version_context", "crew_localization_assert_admin", "crew_localization_snapshot", "crew_localization_guard", "crew_localization_freeze_version", "crew_localization_attach_frozen_snapshot"]) {
      expect(migration).toMatch(new RegExp(`${name}\\([\\s\\S]*?security definer set search_path=public,extensions`, "i"));
      expect(migration).toMatch(new RegExp(`revoke all on function public\\.${name}\\(`, "i"));
    }
  });

  it("returns durable unit identifiers only to the permission-scoped Admin editor", () => {
    expect(adminUnitIdsFix).toContain("'id',u.id");
    expect(adminUnitIdsFix).toContain("crew_localization_assert_admin");
    expect(adminUnitIdsFix).toContain("security definer set search_path=public,extensions");
    expect(adminUnitIdsFix).toContain("revoke all on function public.crew_admin_localized_content");
  });

  it("uses explicit authenticated translation, server secrets, bounded input and retry", () => {
    expect(edge).toContain('request.headers.get("Authorization")');
    expect(edge).toContain('Deno.env.get("OPENAI_API_KEY")');
    expect(edge).toContain("crew_prepare_localized_translation");
    expect(edge).toContain("crew_apply_localized_translations");
    expect(edge).toContain("attempt < 2");
    expect(edge).toContain("25_000");
    expect(edge).toContain("Translation provider returned an incomplete result");
    expect(edge).toContain("requests.slice(index * 4, index * 4 + 4)");
    expect(edge).toContain("max_output_tokens: 4_000");
    expect(edge).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
  });
});
