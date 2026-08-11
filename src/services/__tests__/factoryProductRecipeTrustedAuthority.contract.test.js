import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/202608100016_factory_product_recipe_bom_trusted_authority.sql"), "utf8");
describe("Factory Product Recipe trusted authority migration", () => {
  it("defines an authenticated, idempotent atomic Recipe/BOM save contract", () => {
    for (const text of ["factory_product_recipe_requests", "save_factory_product_recipe", "security definer set search_path=public", "auth.uid()", "factory_product_recipes.create", "factory_product_recipes.edit", "for update", "delete from public.factory_product_recipe_items", "insert into public.factory_product_recipe_items", "payload_fingerprint", "canonical_result"]) expect(migration).toContain(text);
  });
});
