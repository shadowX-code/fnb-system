import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260826181601_crew_profile_employment_type_projection.sql"), "utf8");

describe("Crew employment type profile projection", () => {
  it("projects the existing employee field through the token-bound read only", () => {
    expect(migration).toContain("create or replace function public.crew_my_profile(p_token text)");
    expect(migration).toContain("public.crew_session_employee(p_token)");
    expect(migration).toContain("'employment_type', v_employee.employment_type");
    expect(migration).not.toContain("employment_type =");
    expect(migration).not.toContain("crew_authenticate");
    expect(migration).not.toContain("role_permissions");
    expect(migration).not.toMatch(/\b(?:insert|update|delete)\b/i);
  });

  it("preserves outlet scoping, fixed search path, and the existing execute boundary", () => {
    expect(migration).toContain("join public.crew_access a on a.primary_outlet_id = o.id");
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = public");
    expect(migration).toContain("revoke all on function public.crew_my_profile(text) from public, anon, authenticated");
    expect(migration).toContain("grant execute on function public.crew_my_profile(text) to anon, authenticated");
  });
});
