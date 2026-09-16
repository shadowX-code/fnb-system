import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = fs.readFileSync(path.resolve(process.cwd(), "supabase/migrations/20260916160000_factory_petty_cash.sql"), "utf8");

describe("Factory Petty Cash migration contract", () => {
  it("keeps posted cash immutable and balance derived from posted signed entries", () => {
    expect(sql).toContain("Posted Petty Cash transactions are immutable.");
    expect(sql).toContain("factory_petty_cash_protect_posted_trigger");
    expect(sql).toContain("sum(public.factory_petty_cash_signed_amount");
    expect(sql).not.toMatch(/\bbalance\s+numeric/i);
  });

  it("uses a Malaysia-date, concurrency-safe daily reference sequence", () => {
    expect(sql).toContain("at time zone 'Asia/Kuala_Lumpur'");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("'PC' || to_char(v_business_date, 'YYMMDD')");
    expect(sql).toContain("lpad(v_sequence::text, 2, '0')");
  });

  it("allows only trusted RPC mutation paths and private receipt access", () => {
    expect(sql).toContain("revoke all on table public.factory_petty_cash_transactions from public, anon, authenticated");
    expect(sql).toContain("public.current_user_has_permission('factory_petty_cash.post')");
    expect(sql).toContain("public.current_user_has_permission('factory_petty_cash.reverse')");
    expect(sql).toContain("permission.code like 'factory_petty_cash.%'");
    expect(sql).toContain("lower(role.name) in ('owner', 'admin')");
    expect(sql).toContain("'factory-petty-cash-receipts', 'factory-petty-cash-receipts', false");
  });

  it("links one posted reversal without deleting or mutating the original cash event", () => {
    expect(sql).toContain("factory_petty_cash_one_reversal_idx");
    expect(sql).toContain("reversal_of_id");
    expect(sql).toContain("reversed_by_id");
    expect(sql).toContain("This Petty Cash transaction has already been reversed.");
  });
});
