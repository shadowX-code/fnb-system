import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/202608100016_factory_product_recipe_bom_trusted_authority.sql"), "utf8");
const updateGuardMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260903101335_factory_product_recipe_update_code_guard.sql"), "utf8");
const usageUomMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260903293000_factory_recipe_usage_uom_conversions.sql"), "utf8");
describe("Factory Product Recipe trusted authority migration", () => {
  it("defines an authenticated, idempotent atomic Recipe/BOM save contract", () => {
    for (const text of ["factory_product_recipe_requests", "save_factory_product_recipe", "security definer set search_path=public", "auth.uid()", "factory_product_recipes.create", "factory_product_recipes.edit", "for update", "delete from public.factory_product_recipe_items", "insert into public.factory_product_recipe_items", "payload_fingerprint", "canonical_result"]) expect(migration).toContain(text);
  });

  it("preserves the stored Recipe code during a draft update instead of trusting an omitted or replacement client value", () => {
    for (const text of ["v_code := v_existing.recipe_code", "select * into v_existing from public.factory_product_recipes where id=v_recipe_id for update", "update public.factory_product_recipes set recipe_code=v_code"]) expect(updateGuardMigration).toContain(text);
  });

  it("backfills independent Recipe Usage UOM and preserves it in the trusted save contract", () => {
    for (const text of ["add column if not exists recipe_usage_uom", "set recipe_usage_uom = uom", "recipe_usage_uom,wastage_percent", "Every BOM row requires a Usage UOM", "v_code := v_existing.recipe_code"]) expect(usageUomMigration).toContain(text);
  });

  it("uses a validated material-specific package conversion before recipe-linked stock deduction", () => {
    for (const text of ["conversion_package_uom", "conversion_package_quantity", "conversion_base_uom", "factory_convert_raw_material_quantity_internal", "factory_validate_production_recipe_usage_internal", "factory_complete_production_with_raw_batch_allocations_impl_050031"]) expect(usageUomMigration).toContain(text);
  });
});
