import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = fs.readFileSync(path.resolve("supabase/migrations/20260920090000_crew_cash_settings_authority.sql"), "utf8").toLowerCase();

describe("Crew Cash Checkout settings authority", () => {
  it("stores canonical Job Position IDs and backfills legacy names", () => {
    expect(sql).toContain("required_position_ids uuid[]");
    expect(sql).toContain("from public.job_positions jp");
    expect(sql).toContain("lower(configured.name) = lower(jp.name)");
    expect(sql).toContain("every checkout position must match a canonical job position");
    expect(sql).toContain("required_positions=case when positions_supplied then next_position_names");
  });

  it("compares Floating Cash changes with the current effective value", () => {
    expect(sql).toContain("current_effective_float:=public.crew_cash_float_at");
    expect(sql).toContain("next_float is distinct from current_effective_float and reason is null");
    expect(sql).toContain("if next_float is distinct from current_effective_float then");
    expect(sql).toContain("select a.previous_amount from public.crew_cash_float_adjustments");
  });

  it("returns an outlet-scoped settings context through a fixed trusted authority", () => {
    expect(sql).toContain("crew_cash_settings_context(p_outlet_id uuid)");
    expect(sql).toContain("public.current_user_can_access_outlet(p_outlet_id)");
    expect(sql).toContain("set search_path=public");
    expect(sql).toContain("grant execute on function public.crew_cash_settings_context(uuid) to authenticated");
  });

  it("applies receiver confirmation to Admin-created internal handovers", () => {
    expect(sql).toContain("public.crew_cash_receiver_is_eligible(p_outlet_id,receiver)");
    expect(sql).toContain("s.require_receiver_confirmation");
    expect(sql).toContain("case when require_confirm then 'pending_receipt' else 'completed' end");
    expect(sql).toContain("case when not require_confirm then now() end");
  });
});
