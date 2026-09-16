import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const reconciliationMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260915110000_factory_product_stock_check_reconciliation_batches.sql"), "utf8");
const submitMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260915111000_factory_product_stock_check_reconciliation_submit.sql"), "utf8");
const submitCorrectionMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260915112000_factory_product_stock_check_reconciliation_submit_fix.sql"), "utf8");
const numberingMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260916130000_factory_product_stock_check_adjustment_batch_number.sql"), "utf8");

describe("Finished Goods Stock Check reconciliation batch authority", () => {
  it("keeps positive Stock Check evidence separate from Production and creates one traceable adjustment batch", () => {
    expect(reconciliationMigration).toContain("positive_adjustment_batch_balance_id");
    expect(reconciliationMigration).toContain("source_type = 'adjustment'");
    expect(reconciliationMigration).toContain("source_reference_id, finished_good_id");
    expect(reconciliationMigration).toContain("'product_stock_check'");
    expect(reconciliationMigration).not.toContain("insert into public.factory_productions");
  });

  it("numbers only new reconciliation batches by Malaysia approval date with a locked daily sequence", () => {
    expect(numberingMigration).toContain("timezone('Asia/Kuala_Lumpur', now())::date");
    expect(numberingMigration).toContain("'ADJ-FGSC' || to_char");
    expect(numberingMigration).toContain("pg_advisory_xact_lock");
    expect(numberingMigration).toContain("factory_product_stock_check_adjustment:");
    expect(numberingMigration).toContain("factory_format_business_sequence(v_adjustment_sequence)");
    expect(numberingMigration).toContain("factory_finished_good_batch_balances_adjustment_batch_no_key");
    expect(numberingMigration).toContain("balance.source_type = 'adjustment'");
    expect(numberingMigration).toContain("source_reference_id, source_reference_no");
    expect(numberingMigration).not.toContain("insert into public.factory_productions");
  });

  it("allows Draft reconciliation intent while requiring an active storage-enabled destination on Submit and Approval", () => {
    expect(reconciliationMigration).toContain("default_location.is_storage_location is not true");
    expect(reconciliationMigration).toContain("v_location.is_storage_location is not true");
    expect(reconciliationMigration).toContain("Only submitted stock checks can be approved.");
    expect(submitMigration).toContain("p_target_status, 'draft'");
    expect(submitMigration).toContain("set status = 'submitted'");
    expect(submitCorrectionMigration).toContain("where stock_check.id = v_saved_id");
  });

  it("keeps selected existing-batch identity in the canonical save request", () => {
    const factoryService = readFileSync(resolve(process.cwd(), "src/services/factoryService.js"), "utf8");
    expect(factoryService).toContain("positive_adjustment_batch_balance_id: item.positive_adjustment_batch_balance_id");
  });
});
