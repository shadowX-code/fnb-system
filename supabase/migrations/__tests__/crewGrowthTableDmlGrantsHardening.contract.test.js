import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const sql = fs.readFileSync(
  path.resolve("supabase/migrations/20260812123742_crew_growth_table_dml_grants_hardening.sql"),
  "utf8",
);

describe("Crew Growth table DML grants hardening", () => {
  it("keeps authenticated reads but routes every Growth write through authorities", () => {
    expect(sql).toMatch(/revoke insert, update, delete, truncate, references, trigger[\s\S]+from authenticated/);
    expect(sql).toContain("public.crew_practical_assessments");
    expect(sql).toContain("public.crew_skill_certifications");
    expect(sql).toMatch(/grant select[\s\S]+to authenticated/);
  });
});
