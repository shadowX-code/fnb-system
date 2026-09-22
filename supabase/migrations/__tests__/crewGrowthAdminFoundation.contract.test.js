import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const sql = fs.readFileSync(path.resolve("supabase/migrations/20260812115538_crew_growth_admin_foundation.sql"), "utf8");

describe("Crew Growth Admin Foundation migration", () => {
  it("creates the versioned Growth domain and exact permission catalog", () => {
    for (const table of ["crew_skills", "crew_skill_positions", "crew_skill_outlets", "crew_skill_requirements", "crew_practical_assessments", "crew_skill_certifications"]) {
      expect(sql).toContain(`create table public.${table}`);
      expect(sql).toContain(`alter table public.${table} enable row level security`);
    }
    for (const permission of ["crew_growth.view", "crew_growth.manage", "crew_growth.assess", "crew_growth.certify"]) expect(sql).toContain(permission);
  });

  it("derives evidence from existing Learning, SOP and Quiz authorities", () => {
    expect(sql).toMatch(/crew_growth_requirement_evidence[\s\S]*crew_module_progress/i);
    expect(sql).toMatch(/crew_growth_requirement_evidence[\s\S]*crew_lesson_progress/i);
    expect(sql).toMatch(/crew_growth_requirement_evidence[\s\S]*crew_sop_acknowledgements/i);
    expect(sql).toMatch(/crew_growth_requirement_evidence[\s\S]*crew_quiz_attempts/i);
  });

  it("keeps applicability and state server-derived", () => {
    expect(sql).toMatch(/crew_growth_skill_applicable[\s\S]*crew_access/i);
    expect(sql).toMatch(/crew_growth_employee_skill[\s\S]*ready_for_review/i);
    expect(sql).toContain("needs_renewal");
    expect(sql).toContain("not_applicable");
  });

  it("enforces outlet scope and distinct management authorities", () => {
    expect(sql).toMatch(/crew_growth_save_skill[\s\S]*current_user_can_access_outlet/i);
    expect(sql).toMatch(/crew_growth_submit_assessment[\s\S]*crew_growth\.assess/i);
    expect(sql).toMatch(/crew_growth_certify[\s\S]*crew_growth\.certify/i);
  });

  it("uses fixed search paths and explicit grants", () => {
    for (const fn of ["crew_growth_admin_data", "crew_growth_save_skill", "crew_growth_submit_assessment", "crew_growth_certify"]) {
      expect(sql).toMatch(new RegExp(`${fn}\\([\\s\\S]*?security definer set search_path=public`, "i"));
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${fn}\\(`, "i"));
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${fn}\\(`, "i"));
    }
  });

  it("freezes certification evidence and guards history", () => {
    expect(sql).toContain("evidence_snapshot jsonb not null");
    expect(sql).toContain("crew_practical_assessments_append_only");
    expect(sql).toContain("crew_skill_certifications_append_only");
    expect(sql).toContain("requirements_version");
  });
});
