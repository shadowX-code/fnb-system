import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = fs.readFileSync(path.resolve("supabase/migrations/20260919220000_factory_completed_dispatch_reversal.sql"), "utf8").toLowerCase();
const uuidFixSql = fs.readFileSync(path.resolve("supabase/migrations/20260919221000_factory_completed_dispatch_reversal_uuid_aggregate_fix.sql"), "utf8").toLowerCase();
const traceabilitySql = fs.readFileSync(path.resolve("supabase/migrations/20260919222000_factory_dispatch_reversal_batch_traceability.sql"), "utf8").toLowerCase();

describe("completed Finished Goods Dispatch reversal migration", () => {
  it("records immutable header/detail evidence and canonical authority", () => {
    expect(sql).toContain("factory_finished_goods_dispatch.reverse");
    expect(sql).toContain("factory_finished_good_dispatch_reversals");
    expect(sql).toContain("factory_finished_good_dispatch_reversal_items");
    expect(sql).toContain("original_movement_id");
    expect(sql).toContain("reversal_movement_id");
    expect(sql).toContain("allocation_id uuid not null unique");
  });

  it("locks and restores the exact allocated batch and matching aggregate", () => {
    expect(sql).toContain("for update");
    expect(sql).toContain("allocation.storage_location_id is distinct from batch.storage_location_id");
    expect(sql).toContain("set current_balance = current_balance + v_allocation.allocation_quantity");
    expect(sql).toContain("movement_type, quantity");
    expect(sql).toContain("'dispatch reversal'");
    expect(sql).toContain("finished_good_batch_balance_id");
    expect(sql).toContain("aggregate and batch balances do not reconcile");
    expect(uuidFixSql).toContain("array_agg(movement.id order by movement.id)");
    expect(uuidFixSql).toContain("pg_get_functiondef");
  });

  it("is request-idempotent and rejects a second logical reversal", () => {
    expect(sql).toContain("factory_dispatch_reversal_request:");
    expect(sql).toContain("where reversal.request_id = p_request_id");
    expect(sql).toContain("has already been reversed");
    expect(sql).toContain("status = 'reversed'");
  });

  it("does not fabricate inventory sources or erase dispatch history", () => {
    expect(sql).not.toMatch(/delete\s+from\s+public\.factory_finished_good/);
    expect(sql).not.toMatch(/insert\s+into\s+public\.factory_finished_good_batch_balances/);
    expect(sql).not.toContain("stock adjustment");
    expect(sql).not.toContain("internal_transfer_id");
    expect(traceabilitySql).toContain("in ('completed', 'reversed')");
    expect(traceabilitySql).toContain("completed_allocations");
  });
});
