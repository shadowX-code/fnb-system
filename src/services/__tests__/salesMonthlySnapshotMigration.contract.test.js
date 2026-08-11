import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/202608100011_sales_purchase_monthly_snapshot_authority.sql"), "utf8");

describe("Sales monthly snapshot migration contract", () => {
  it("defines one authenticated, idempotent, locked transactional Sales snapshot authority", () => {
    expect(migration).toContain("sales_purchase_monthly_save_requests");
    expect(migration).toContain("save_sales_period_snapshot");
    expect(migration).toContain("auth.uid()");
    expect(migration).toContain("current_user_has_permission('sales_input.create')");
    expect(migration).toContain("current_user_can_access_outlet(p_outlet_id)");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("payload_fingerprint");
    expect(migration).toContain("update public.sales_records");
    expect(migration).toContain("insert into public.sales_records");
    expect(migration).toContain("delete from public.sales_records");
    expect(migration).toContain("save_purchase_period_snapshot");
    expect(migration).toContain("purchase_period_snapshot");
    expect(migration).toContain("current_user_has_permission('purchase_input.create')");
    expect(migration).toContain("update public.purchase_records");
    expect(migration).toContain("insert into public.purchase_records");
    expect(migration).toContain("delete from public.purchase_records");
  });
});
