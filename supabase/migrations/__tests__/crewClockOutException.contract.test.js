import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/202608110005_crew_clock_out_exception_confirmation.sql"), "utf8");

describe("Crew clock-out exception confirmation migration contract", () => {
  it("requires an explicit reason before a non-verified clock-out can complete", () => {
    expect(migration).toContain("Choose an exception reason to clock out.");
    expect(migration).toContain("Location could not be verified. Choose an exception reason to clock out.");
    expect(migration).not.toContain("Location unavailable at clock out.");
  });

  it("retains server-computed location evidence and explicit mobile RPC access only", () => {
    expect(migration).toContain("clock_out_distance_meters = v_distance");
    expect(migration).toContain("clock_out_location_exception = v_exception");
    expect(migration).toContain("revoke all on function public.crew_clock(text, text, jsonb, text) from public, anon, authenticated;");
    expect(migration).toContain("grant execute on function public.crew_clock(text, text, jsonb, text) to anon, authenticated;");
  });
});
