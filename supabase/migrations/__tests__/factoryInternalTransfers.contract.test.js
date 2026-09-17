import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260918120000_factory_internal_transfers.sql"), "utf8");

describe("Factory Internal Transfer migration contract", () => {
  it("uses a locked Malaysia-business-date reference and immutable document", () => {
    expect(migration).toContain("'TR' || to_char(v_date, 'YYMMDD')");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("request_id uuid not null unique");
    expect(migration).toContain("status text not null default 'completed' check (status = 'completed')");
  });

  it("preserves batch genealogy and writes paired transfer evidence", () => {
    expect(migration).toContain("origin_batch_balance_id");
    expect(migration).toContain("'Transfer Out'");
    expect(migration).toContain("'Transfer In'");
    expect(migration).toContain("source_type in ('receiving', 'stock_check_adjustment', 'legacy_unallocated', 'transfer')");
    expect(migration).toContain("source_type in ('production', 'adjustment', 'legacy_unallocated', 'transfer')");
  });
});
