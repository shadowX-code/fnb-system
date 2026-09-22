import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = fs.readFileSync(path.resolve("supabase/migrations/20260820171620_crew_outlet_cash_checkout.sql"), "utf8").toLowerCase();

describe("Crew outlet Cash Checkout migration contract", () => {
  it("keeps every final amount and ledger balance server-derived", () => {
    expect(sql).toContain("crew_cash_count_denominations(p_counts jsonb)");
    expect(sql).toContain("variance_amount:=case when pos_expected is null then null else counted-pos_expected end");
    expect(sql).toContain("deposit_amount:=counted-float_amount-carry");
    expect(sql).toContain("crew_cash_balance(p_outlet_id uuid)");
    expect(sql).toContain("sum(l.signed_amount)");
    expect(sql).toContain("payload contains server-controlled fields");
  });

  it("binds Crew writes to the opaque session, active employee and outlet", () => {
    expect(sql).toContain("ctx:=public.crew_operations_employee_context(p_token)");
    expect(sql).toContain("employee:=public.crew_session_employee(p_token)");
    expect(sql).toContain("ca.primary_outlet_id=outlet");
    expect(sql).toContain("c.checked_out_by_employee_id<>employee");
    expect(sql).not.toMatch(/crew_cash_(mobile|save_checkout|record_collection)\([^)]*p_employee_id/);
  });

  it("protects completed history and uses append-only corrections", () => {
    expect(sql).toContain("completed cash checkout is immutable");
    expect(sql).toContain("crew_cash_checkout_adjustments");
    expect(sql).toContain("checkout_reversal");
    expect(sql).toContain("on delete restrict");
    expect(sql).not.toContain("delete from public.crew_cash");
  });

  it("reserves pending handovers and serializes collection balance checks", () => {
    expect(sql).toContain("crew_cash_available_balance(p_outlet_id uuid)");
    expect(sql).toContain("c.status='pending_receipt'");
    expect(sql).toContain("pg_advisory_xact_lock(hashtextextended(outlet::text,0))");
    expect(sql).toContain("cannot exceed the available deposit balance");
  });

  it("denies direct table access and fixes every authority search_path", () => {
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("from public,anon,authenticated");
    const definitions = [...sql.matchAll(/create or replace function public\.(crew_cash_[^(]+)(\([^]*?\$\$;)/g)];
    expect(definitions.length).toBeGreaterThanOrEqual(15);
    definitions.forEach(([, name, body]) => {
      expect(body, `${name} needs a fixed search_path`).toContain("set search_path=public");
    });
    expect(sql).toContain("grant execute on function public.crew_cash_mobile(text,date) to anon,authenticated");
    expect(sql).toContain("grant execute on function public.crew_cash_admin_data(uuid,date,date) to authenticated");
  });

  it("keeps checkout history snapshot-bound, outlet-scoped, and limited to the last 30 business days", () => {
    const historySql = fs.readFileSync(path.resolve("supabase/migrations/20260826162112_crew_cash_checkout_history_projection.sql"), "utf8").toLowerCase();
    expect(historySql).toContain("crew_operations_employee_context(p_token)");
    expect(historySql).toContain("c.outlet_id = outlet");
    expect(historySql).toContain("c.status = 'completed'");
    expect(historySql).toContain("p_business_date - 29 and p_business_date");
    expect(historySql).toContain("order by c.business_date desc, c.completed_at desc");
    expect(historySql).toContain("set search_path=public");
    expect(historySql).toContain("revoke all on function public.crew_cash_checkout_history(text, date) from public, anon, authenticated");
    expect(historySql).toContain("grant execute on function public.crew_cash_checkout_history(text, date) to anon, authenticated");
    expect(historySql).not.toContain("crew_cash_ledger_entries");
  });
});
