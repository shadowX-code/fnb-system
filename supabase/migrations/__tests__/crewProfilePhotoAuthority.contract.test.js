import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260831135145_crew_profile_photo_authority.sql"), "utf8");
const edge = readFileSync(resolve(process.cwd(), "supabase/functions/crew-profile-photo/index.ts"), "utf8");

describe("Crew profile photo authority", () => {
  it("keeps the employee master record and a private bucket as the canonical authority", () => {
    expect(migration).toContain("add column if not exists profile_photo_path text");
    expect(migration).toContain("'crew-profile-photos'");
    expect(migration).toContain("false,");
    expect(migration).toContain("public.crew_session_employee(p_token)");
    expect(migration).toContain("p_profile_photo_path is distinct from v_expected_path");
    expect(migration).toContain("'crew_profile_photo_changed'");
  });

  it("keeps only narrowly granted token-bound RPC contracts", () => {
    for (const signature of ["crew_profile_photo_context(text)", "crew_set_profile_photo(text, text)", "crew_my_profile(text)"]) {
      expect(migration).toContain(`revoke all on function public.${signature} from public, anon, authenticated`);
      expect(migration).toContain(`grant execute on function public.${signature} to anon, authenticated`);
    }
  });

  it("uses the edge boundary for private Storage and never accepts a client-selected employee or object path", () => {
    expect(edge).toContain('rpc("crew_profile_photo_context", { p_token: token })');
    expect(edge).toContain('rpc("crew_set_profile_photo",');
    expect(edge).toContain("context.object_path");
    expect(edge).not.toContain("employee_id");
    expect(edge).toContain("createSignedUrl");
  });
});
