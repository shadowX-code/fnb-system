import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260903220000_factory_mesti_equipment_cleaning_sop_after_production.sql"), "utf8");
const lifecycleMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260903200000_factory_mesti_cleaning_of_equipment.sql"), "utf8");

describe("Factory MeSTI Equipment Cleaning migration contract", () => {
  it("uses versioned scheduled requirements and production-plus-equipment identities", () => {
    expect(migration).toContain("factory_mesti_equipment_cleaning_requirements");
    expect(migration).toContain("factory_mesti_equipment_cleaning_scheduled_identity_key");
    expect(migration).toContain("factory_mesti_equipment_cleaning_after_production_identity_key");
    expect(migration).toContain("on public.factory_mesti_equipment_cleaning_occurrences(production_id, equipment_id)");
    expect(migration).toContain("where source_type = 'after_production'");
    expect(migration).toContain("v_existing=v_ids then v_saved:=v_current");
  });

  it("materializes After Production only from completed Production SOP equipment bindings", () => {
    expect(migration).toContain("factory_production_sop_equipment");
    expect(migration).toContain("Bind at least one active Equipment item to a Production SOP.");
    expect(migration).toContain("binding.sop_id = production.production_sop_id");
    expect(migration).toContain("lower(production.status) = 'completed'");
    expect(migration).toContain("'source_type', 'after_production'");
    expect(migration).toContain("'production_snapshot'");
    expect(migration).toContain("'completed_at', production.completed_at");
    expect(migration).toContain("on conflict (production_id, equipment_id)");
  });

  it("removes the retired configurable trigger and manual usage runtime model", () => {
    expect(migration).toContain("drop column if exists production_equipment_usage_id");
    expect(migration).toContain("drop column if exists trigger_type");
    expect(migration).toContain("drop table if exists public.factory_production_equipment_usage");
    expect(migration).toContain("drop function if exists public.factory_record_production_equipment_usage");
    expect(migration).not.toContain("p_requirement->>'trigger_type'");
    expect(migration).not.toContain("factory_mesti_materialize_equipment_cleaning_after_operation(p_");
  });

  it("keeps authorization and lifecycle transitions inside trusted RPCs", () => {
    expect(lifecycleMigration).toContain("factory_mesti_equipment_cleaning.complete");
    expect(lifecycleMigration).toContain("factory_mesti_equipment_cleaning.review");
    expect(lifecycleMigration).toContain("Self-verification is not allowed.");
    expect(migration).toContain("factory_save_mesti_equipment_cleaning_requirement");
    expect(migration).toContain("v_created boolean:=false");
    expect(migration).toContain("v_saved:=v_current");
  });
});
