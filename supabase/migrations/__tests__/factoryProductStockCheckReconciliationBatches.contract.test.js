import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260915110000_factory_product_stock_check_reconciliation_batches.sql"), "utf8");

describe("Finished Goods Stock Check reconciliation batch authority", () => {
  it("keeps positive Stock Check evidence separate from Production and creates one traceable adjustment batch", () => {
    expect(migration).toContain("positive_adjustment_batch_balance_id");
    expect(migration).toContain("source_type = 'adjustment'");
    expect(migration).toContain("source_reference_id, finished_good_id");
    expect(migration).toContain("'ADJ-' || v_check.check_no");
    expect(migration).toContain("'product_stock_check'");
    expect(migration).not.toContain("insert into public.factory_productions");
  });

  it("allows Draft reconciliation intent while requiring an active storage-enabled destination on Submit and Approval", () => {
    expect(migration).toContain("lower(coalesce(p_target_status, 'draft')) = 'submitted'");
    expect(migration).toContain("default_location.is_storage_location is not true");
    expect(migration).toContain("v_location.is_storage_location is not true");
    expect(migration).toContain("Only submitted stock checks can be approved.");
  });
});
