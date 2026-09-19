import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260919105545_factory_mesti_equipment_cleaning_production_end_date_legacy_repair.sql"), "utf8");

const occurrenceIds = [
  "c9e168d6-ab0f-481c-92d2-ca8ccd33db85",
  "dbf9f9ac-86df-4bcd-bc24-6e99646fa8c9",
  "879127bf-3e07-4e34-a42b-309b3db4edbc",
  "9f6b9b1a-4c66-44e0-826e-c891c7bc36ef",
  "71501d51-212f-4622-9511-b664a5f25c7e",
  "5792fed5-0ee7-4abc-ae54-0f26b50acd65",
  "61712b7d-041f-4129-9b79-dc3412848ae9",
  "42dcd7d5-6fe4-4d37-a2ac-1ca0b1f12820",
  "2268d0ac-22dd-4cef-b2fe-49a29e2e259f",
];

describe("Factory MeSTI equipment-cleaning Production legacy repair", () => {
  it("whitelists only the nine audited occurrence identities", () => {
    for (const occurrenceId of occurrenceIds) expect(migration).toContain(occurrenceId);
    expect((migration.match(/::uuid/g) || []).length).toBeGreaterThanOrEqual(27);
    expect(migration).toContain("Expected all 9 audited Production equipment-cleaning occurrences");
    expect(migration).toContain("Audited Production equipment-cleaning occurrence state changed; repair aborted");
  });

  it("requires the audited source, production, equipment, date, lifecycle, and evidence state before repair", () => {
    expect(migration).toContain("occurrence.source_type = 'after_production'");
    expect(migration).toContain("occurrence.production_id = targets.production_id");
    expect(migration).toContain("occurrence.equipment_id = targets.equipment_id");
    expect(migration).toContain("occurrence.status = targets.expected_status");
    expect(migration).toContain("occurrence.due_date = targets.current_due_date");
    expect(migration).toContain("production.end_date = targets.corrected_due_date");
    expect(migration).toContain("occurrence.completed_at is not null");
    expect(migration).toContain("occurrence.verified_at is null");
  });

  it("changes only due dates for matching target IDs and leaves non-Production environments untouched", () => {
    expect(migration).toContain("if v_present_count = 0 then\n    return;");
    expect(migration).toContain("set due_date = targets.corrected_due_date");
    expect(migration).toContain("where occurrence.id = targets.occurrence_id");
    expect(migration).toContain("if v_updated_count <> 9 then");
    expect(migration).not.toContain("insert into public.factory_mesti_equipment_cleaning_occurrences");
    expect(migration).not.toContain("delete from public.factory_mesti_equipment_cleaning_occurrences");
  });
});
