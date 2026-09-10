import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260908151715_factory_supplier_raw_material_links.sql"), "utf8");

describe("Factory Supplier Raw Material link migration contract", () => {
  it("defines an auditable many-to-many relationship and active-only eligibility authority", () => {
    expect(migration).toContain("create table if not exists public.factory_supplier_raw_material_links");
    expect(migration).toContain("primary key (supplier_id, raw_material_id)");
    expect(migration).toContain("create or replace function public.factory_supplier_raw_material_eligibility");
    expect(migration).toContain("lower(coalesce(material.status, '')) = 'active'");
    expect(migration).toContain("factory_save_supplier_raw_material_links");
  });

  it("enforces Supplier eligibility in the existing trusted receiving save authority without rewriting receipt history", () => {
    expect(migration).toContain("factory_save_raw_material_receiving_impl_supplier_material_links_0908");
    expect(migration).toContain("Raw Material is not linked to the selected Supplier.");
    expect(migration).not.toContain("update public.factory_raw_material_receivings");
  });
});
