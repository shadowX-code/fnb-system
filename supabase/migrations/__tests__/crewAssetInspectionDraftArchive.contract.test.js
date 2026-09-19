import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const sql = fs.readFileSync(path.resolve(process.cwd(), "supabase/migrations/20260919160000_crew_asset_inspection_draft_archive.sql"), "utf8");

describe("Crew Asset inspection draft archive contract", () => {
  it("allows only the owning Crew inspector to archive a resumable draft", () => {
    expect(sql).toContain("public.crew_asset_context(p_token)");
    expect(sql).toContain("can_perform_asset_inspections");
    expect(sql).toContain("v_inspection.checked_by_employee_id <> v_employee_id");
    expect(sql).toContain("v_inspection.status not in ('draft', 'in_progress')");
    expect(sql).toContain("set status = 'archived'");
  });

  it("is retry-safe and records the canonical archive lifecycle event", () => {
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("operation = 'inspection_archive'");
    expect(sql).toContain("actor_employee_id");
    expect(sql).toContain("grant execute on function public.crew_asset_archive_inspection_draft(text, uuid, uuid) to anon, authenticated");
  });
});
