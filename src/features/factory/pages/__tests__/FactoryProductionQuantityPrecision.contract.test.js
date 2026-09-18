import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const migrationPath = path.resolve(process.cwd(), "supabase/migrations/20260918152000_factory_production_usage_quantity_precision.sql");

describe("Factory Production quantity precision contract", () => {
  it("rounds trusted recipe conversion to four decimals and rejects non-canonical usage precision", () => {
    const migration = fs.readFileSync(migrationPath, "utf8");

    expect(migration).toContain("v_expected := round(v_conversion.converted_quantity, 4)");
    expect(migration).toContain("Production % supports up to 4 decimal places.");
    expect(migration).toContain("Raw Material batch allocation quantity supports up to 4 decimal places.");
    expect(migration).toContain("factory_validate_production_usage_precision_internal");
  });

  it("uses the Raw Material storage UOM as the package conversion source", () => {
    const migration = fs.readFileSync(migrationPath, "utf8");

    expect(migration).toContain("v_storage := public.factory_normalize_uom(v_material.uom)");
    expect(migration).toContain("if v_from = v_storage then");
    expect(migration).toContain("if v_to = v_storage then");
    expect(migration).not.toContain("v_material.conversion_package_uom");
  });
});
