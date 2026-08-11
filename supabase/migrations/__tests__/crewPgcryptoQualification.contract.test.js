import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const corrective = readFileSync(resolve(process.cwd(), "supabase/migrations/202608110004_crew_pgcrypto_schema_qualification.sql"), "utf8");

describe("Crew pgcrypto schema qualification corrective migration contract", () => {
  it("qualifies every pgcrypto call used by live Crew credential and session authorities", () => {
    for (const call of ["extensions.crypt(", "extensions.gen_salt(", "extensions.digest(", "extensions.gen_random_bytes("]) {
      expect(corrective).toContain(call);
    }
    expect(corrective).not.toMatch(/(?<!extensions\.)\b(?:crypt|gen_salt|digest|gen_random_bytes)\s*\(/);
  });

  it("keeps the security hardening execute boundary intact", () => {
    expect(corrective).toContain("revoke all on function public.crew_session_employee(text) from public, anon, authenticated;");
    expect(corrective).toContain("grant execute on function public.crew_authenticate(text, text, text) to anon, authenticated;");
    expect(corrective).toContain("grant execute on function public.crew_change_passcode(text, text, text) to anon, authenticated;");
    expect(corrective).toContain("grant execute on function public.manage_crew_access(uuid, text, text) to authenticated;");
  });
});
