import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260903200000_factory_mesti_cleaning_of_equipment.sql"), "utf8");

describe("Factory MeSTI Equipment Cleaning migration contract", () => {
  it("uses versioned logical requirements and database-enforced scheduled and usage-event identities", () => {
    expect(migration).toContain("factory_mesti_equipment_cleaning_requirements");
    expect(migration).toContain("logical_requirement_id uuid not null");
    expect(migration).toContain("factory_mesti_equipment_cleaning_scheduled_identity_key");
    expect(migration).toContain("where production_equipment_usage_id is null");
    expect(migration).toContain("factory_mesti_equipment_cleaning_after_operation_identity_key");
    expect(migration).toContain("where production_equipment_usage_id is not null");
    expect(migration).toContain("factory_mesti_equipment_cleaning_non_overlapping_versions");
  });

  it("materializes After Operation only from completed canonical usage evidence and preserves provenance", () => {
    expect(migration).toContain("from public.factory_production_equipment_usage usage");
    expect(migration).toContain("lower(production.status) = 'completed'");
    expect(migration).toContain("production_equipment_usage_id");
    expect(migration).toContain("production_step_execution_id");
    expect(migration).toContain("production_snapshot");
    expect(migration).toContain("on conflict (logical_requirement_id, production_equipment_usage_id)");
  });

  it("keeps authorization and lifecycle transitions inside trusted RPCs", () => {
    expect(migration).toContain("factory_mesti_equipment_cleaning.complete");
    expect(migration).toContain("factory_mesti_equipment_cleaning.review");
    expect(migration).toContain("Self-verification is not allowed.");
    expect(migration).toContain("factory_save_mesti_equipment_cleaning_requirement");
    expect(migration).toContain("v_version_created boolean := false");
    expect(migration).toContain("v_saved := v_current;");
  });
});
