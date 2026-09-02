import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260903210000_factory_mesti_equipment_cleaning_monthly_provenance.sql"), "utf8");

describe("Factory MeSTI Equipment Cleaning Monthly provenance migration contract", () => {
  it("preserves canonical occurrence provenance in a Monthly drill-down", () => {
    expect(migration).toContain("'due_date', due_date");
    expect(migration).toContain("'trigger_type', trigger_type");
    expect(migration).toContain("'production_equipment_usage_id', production_equipment_usage_id");
    expect(migration).toContain("'production_snapshot', requirement_snapshot->'production_snapshot'");
    expect(migration).toContain("'completed_by', completed_by");
    expect(migration).toContain("'verified_by', verified_by");
  });
});
