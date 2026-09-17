import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260918100000_factory_fg_storage_and_raw_stock_check_reconciliation.sql"), "utf8");
const verification = readFileSync(resolve(process.cwd(), "supabase/migrations/20260918101000_factory_raw_stock_check_reconciliation_repair_verification.sql"), "utf8");

describe("Factory Raw Material Stock Check reconciliation batches migration", () => {
  it("pins Production completion to the Packaging SKU's active storage-enabled location", () => {
    expect(migration).toContain("v_finished_good.storage_location_id");
    expect(migration).toContain("Production storage must match the Packaging SKU Storage Location.");
    expect(migration).toContain("v_location.is_storage_location is not true");
    expect(migration).not.toContain("Select an active Finished Goods Area for Production storage.");
  });

  it("creates daily Malaysia-date ADJ-RMSC batches under an advisory lock", () => {
    expect(migration).toContain("ADJ-RMSC");
    expect(migration).toContain("timezone('Asia/Kuala_Lumpur', now())::date");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("factory_raw_material_batch_balances_adjustment_batch_no_key");
    expect(migration).toContain("source is Stock Check, not Receiving");
  });

  it("makes only active stock-check reconciliation batches FEFO eligible", () => {
    expect(migration).toContain("balance.source_type in ('receiving', 'stock_check_adjustment')");
    expect(migration).toContain("v_batch.source_type not in ('receiving', 'stock_check_adjustment')");
  });

  it("repairs only the three whitelisted source-linked Production batches without a movement or aggregate change", () => {
    expect(migration).toContain("1095488e-eac5-4592-bb88-ca5819a46451");
    expect(migration).toContain("cf832e87-2ec9-495e-ade9-fe81a7213e62");
    expect(migration).toContain("23111ec4-2de8-49b6-adb4-0c69e9667a18");
    expect(migration).toContain("Expected exactly % whitelisted legacy Raw Material Stock Check reconciliation batches");
    expect(migration).toContain("RMSC-260915-01");
    expect(migration).toContain("5::numeric");
    expect(migration).toContain("15::numeric");
    expect(migration).toContain("10::numeric");
    expect(migration).toContain("batch.raw_material_stock_check_item_id");
    expect(migration).toContain("movement.raw_material_batch_balance_id = batch.id");
    expect(migration).toContain("abs(material.current_balance - coalesce((");
    expect(migration).toContain("set status = 'active'");
    expect(migration).not.toContain("insert into public.factory_raw_material_movements");
  });

  it("verifies the complete whitelist set without replaying the repair on Staging", () => {
    expect(verification).toContain("v_present_count not in (0, 3)");
    expect(verification).toContain("v_valid_count <> 3");
    expect(verification).toContain("status = 'active'");
  });
});
