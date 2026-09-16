import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260916164251_factory_petty_cash_receipt_lifecycle.sql"), "utf8");

describe("Factory Petty Cash receipt lifecycle migration", () => {
  it("allows cleanup only for unreferenced private receipt objects", () => {
    expect(migration).toContain("factory_petty_cash_receipt_can_delete");
    expect(migration).toContain("current_user_has_permission('factory_petty_cash.create')");
    expect(migration).toContain("transaction.receipt_path = p_path");
    expect(migration).toContain("on storage.objects for delete to authenticated");
    expect(migration).toContain("bucket_id = 'factory-petty-cash-receipts'");
  });
});
