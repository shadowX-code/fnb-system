import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260814064747_factory_raw_material_par_level_update_grant.sql"), "utf8");

describe("Factory Raw Material Par Level grant migration", () => {
  it("restores only Par Level updates while leaving RLS and aggregate-balance protection intact", () => {
    expect(migration).toContain("grant update (par_level) on table public.factory_raw_materials to authenticated");
    expect(migration).not.toMatch(/grant update\s+on table public\.factory_raw_materials/i);
  });
});
