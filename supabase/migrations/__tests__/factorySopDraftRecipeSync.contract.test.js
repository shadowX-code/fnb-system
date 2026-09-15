import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260915100000_factory_sop_draft_recipe_sync.sql"), "utf8");

describe("Factory SOP Draft Recipe synchronization authority", () => {
  it("pins only an active Recipe on an unused Draft SOP without replacing SOP structure", () => {
    expect(migration).toContain("factory_update_draft_production_sop_recipe");
    expect(migration).toContain("lower(coalesce(v_sop.status, '')) <> 'draft'");
    expect(migration).toContain("production.production_sop_id = v_sop.id");
    expect(migration).toContain("lower(coalesce(recipe.status, '')) = 'active'");
    expect(migration).toContain("recipe_id = v_recipe.id");
    expect(migration).toContain("recipe_version = v_recipe.version");
    expect(migration).not.toContain("factory_production_sop_steps");
  });
});
