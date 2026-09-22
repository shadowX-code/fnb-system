import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const sql = fs.readFileSync(
  path.resolve("supabase/migrations/20260812144214_crew_growth_mobile_read.sql"),
  "utf8",
).toLowerCase();
const runtimeFix = fs.readFileSync(
  path.resolve("supabase/migrations/20260812152030_crew_growth_mobile_session_runtime_fix.sql"),
  "utf8",
).toLowerCase();

describe("Crew Growth mobile read authority", () => {
  it("binds identity to the opaque Crew session and fixes search_path", () => {
    expect(sql).toContain("v_employee_id := public.crew_session_employee(p_token)");
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = public");
    expect(sql).not.toMatch(/p_employee_id/);
  });

  it("returns only applicable active skills and safe employee evidence", () => {
    expect(sql).toContain("public.crew_growth_skill_applicable(v_employee_id, s.id)");
    expect(sql).toContain("'requirements', coalesce(x.state->'requirements'");
    expect(sql).not.toContain("certification_history");
    expect(sql).not.toContain("evidence_snapshot");
    expect(sql).not.toContain("'note'");
    expect(sql).not.toContain("certified_by");
  });

  it("uses explicit Crew mobile grants", () => {
    expect(sql).toContain("revoke all on function public.crew_growth_mobile(text) from public, anon, authenticated");
    expect(sql).toContain("grant execute on function public.crew_growth_mobile(text) to anon, authenticated");
  });

  it("allows the session authority to refresh last-seen state", () => {
    expect(runtimeFix).toContain("alter function public.crew_growth_mobile(text) volatile");
    expect(runtimeFix).toContain("revoke all on function public.crew_growth_mobile(text) from public, anon, authenticated");
    expect(runtimeFix).toContain("grant execute on function public.crew_growth_mobile(text) to anon, authenticated");
  });
});
