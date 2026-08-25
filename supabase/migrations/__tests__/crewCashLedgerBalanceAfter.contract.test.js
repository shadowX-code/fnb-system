import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = fs.readFileSync(path.resolve("supabase/migrations/20260826043000_crew_cash_ledger_balance_after.sql"), "utf8").toLowerCase();

describe("Crew Cash ledger balance read model", () => {
  it("keeps prior carry-forward and expected opening server-sourced", () => {
    expect(sql).toContain("public.crew_cash_previous_carry(outlet,p_business_date)");
    expect(sql).toContain("'cash_context'");
    expect(sql).toContain("'expected_opening_cash',floating + previous_carry");
  });

  it("returns deterministic, outlet-scoped running balances without client reconstruction", () => {
    expect(sql).toContain("sum(l.signed_amount) over(order by l.occurred_at,l.id rows between unbounded preceding and current row) balance_after");
    expect(sql).toContain("where l.outlet_id=outlet");
    expect(sql).toContain("order by occurred_at desc,id desc limit 100");
  });
});
