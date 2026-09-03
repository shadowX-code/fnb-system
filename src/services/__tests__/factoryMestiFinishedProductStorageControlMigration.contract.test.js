import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260903260000_factory_mesti_finished_product_storage_control.sql"), "utf8");
const packagingQtyFix = readFileSync(resolve(process.cwd(), "supabase/migrations/20260903270000_factory_mesti_finished_product_storage_control_packaging_qty.sql"), "utf8");

describe("Factory MeSTI Finished Product Storage Control migration contract", () => {
  it("projects only canonical completed Production Finished Goods batches without a new MeSTI ledger", () => {
    expect(migration).toContain("factory_mesti_finished_product_storage_control(");
    expect(migration).toContain("from public.factory_finished_good_batch_balances balance");
    expect(migration).toContain("balance.source_type = 'production'");
    expect(migration).toContain("lower(coalesce(production.status, '')) = 'completed'");
    expect(migration).toContain("balance.opening_qty");
    expect(migration).toContain("balance.storage_location_id");
    expect(migration).toContain("balance.expiry_date");
    expect(migration).toContain("production.created_by");
    expect(migration).not.toContain("create table public.factory_mesti_finished_product_storage");
  });

  it("keeps completed batches independently filterable by Finished Good, Packaging SKU, and Storage", () => {
    expect(migration).toContain("p_product_family_id uuid");
    expect(migration).toContain("p_packaging_sku_id uuid");
    expect(migration).toContain("p_storage_location_id uuid");
    expect(migration).toContain("finished_good.product_family_id = p_product_family_id");
    expect(migration).toContain("finished_good.id = p_packaging_sku_id");
    expect(migration).toContain("balance.storage_location_id = p_storage_location_id");
    expect(migration).toContain("factory_mesti_finished_product_storage_control_filter_options");
    expect(packagingQtyFix).toContain("finished_good.packaging_type");
  });

  it("reuses the existing MeSTI read boundary rather than introducing a new role or lifecycle", () => {
    expect(migration).toContain("factory_mesti_cleaning.view");
    expect(migration).toContain("factory_mesti_cleaning.manage");
    expect(migration).not.toContain("responsible_role");
    expect(migration).not.toContain("verifier_role");
  });
});
