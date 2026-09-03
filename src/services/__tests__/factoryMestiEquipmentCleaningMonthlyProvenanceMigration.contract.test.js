import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260903220000_factory_mesti_equipment_cleaning_sop_after_production.sql"), "utf8");

describe("Factory MeSTI Equipment Cleaning Monthly provenance migration contract", () => {
  it("preserves canonical occurrence provenance in a Monthly drill-down", () => {
    expect(migration).toContain("'due_date',o.due_date");
    expect(migration).toContain("'source_type',source_type");
    expect(migration).toContain("'production_id',o.production_id");
    expect(migration).toContain("'production_snapshot',o.requirement_snapshot->'production_snapshot'");
    expect(migration).toContain("'completed_by_name'");
    expect(migration).toContain("'verified_by_name'");
  });
});
