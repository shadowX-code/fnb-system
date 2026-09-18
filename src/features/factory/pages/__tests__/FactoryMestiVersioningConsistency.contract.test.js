import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260918153000_factory_mesti_versioning_and_verification_consistency.sql"),
  "utf8",
);

describe("MeSTI versioning and verification SQL contract", () => {
  it("keeps future requirements editable but versions effective requirement changes forward", () => {
    [
      "factory_save_mesti_cleaning_requirement",
      "factory_save_mesti_equipment_cleaning_requirement",
      "factory_save_mesti_calibration_requirement",
      "factory_save_mesti_waste_disposal_requirement",
    ].forEach((name) => expect(migration).toContain(`create or replace function public.${name}`));
    expect((migration.match(/elsif v_current\.effective_from > v_today then/g) || [])).toHaveLength(4);
    expect((migration.match(/set effective_until = v_effective/g) || [])).toHaveLength(4);
  });

  it("uses only canonical permissions for MeSTI verification and scopes hygiene monthly rows to evidence", () => {
    expect(migration).not.toContain("Self-verification is not allowed.");
    expect(migration).toContain("from public.factory_mesti_operator_hygiene_entries entry");
    expect(migration).toContain("join public.factory_mesti_operator_hygiene_sessions session on session.id = entry.session_id");
    expect(migration).not.toContain("from public.employees employee\n  left join public.factory_mesti_operator_hygiene_entries entry");
  });
});
