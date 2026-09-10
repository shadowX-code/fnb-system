import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260903090000_factory_equipment_foundation.sql"), "utf8");

describe("Factory Equipment foundation migration", () => {
  it("uses Factory Locations and protects completion-level usage identity", () => {
    expect(migration).toContain("create table if not exists public.factory_equipment");
    expect(migration).toContain("current_location_id uuid not null references public.factory_storage_locations");
    expect(migration).toContain("unique (production_id, equipment_id)");
    expect(migration).toContain("on conflict (production_id, equipment_id) do nothing");
    expect(migration).toContain("factory_record_production_equipment_usage");
  });
});
