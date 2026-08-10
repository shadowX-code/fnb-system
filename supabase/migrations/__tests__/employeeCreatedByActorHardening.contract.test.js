import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/202608100008_employee_created_by_actor_hardening.sql"), "utf8");

describe("employee creator attribution migration contract", () => {
  it("derives creator identity from auth.uid on insert, rejects anonymous create, and preserves it on update", () => {
    expect(migration).toMatch(/v_actor uuid := auth\.uid\(\)/);
    expect(migration).toMatch(/if v_actor is null then[\s\S]*Authenticated actor is required to create an employee\./);
    expect(migration).toMatch(/new\.created_by := v_actor/);
    expect(migration).toMatch(/new\.created_by := old\.created_by/);
    expect(migration).toMatch(/before insert or update on public\.employees/);
  });
});
