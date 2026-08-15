import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260815113000_crew_leave_adjustment_history_read.sql"), "utf8");

describe("Crew Leave adjustment history read authority", () => {
  it("keeps history authenticated, permission checked and outlet scoped", () => {
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = public");
    expect(sql).toContain("current_user_has_permission('crew_leave_balance.view')");
    expect(sql).toContain("current_user_can_access_outlet(v_outlet_id)");
    expect(sql).toContain("revoke all on function public.crew_leave_adjustment_history(uuid) from public, anon, authenticated");
    expect(sql).toContain("grant execute on function public.crew_leave_adjustment_history(uuid) to authenticated");
  });

  it("preserves exact before and after balance evidence at write time", () => {
    expect(sql).toContain("previous_available numeric(7,2)");
    expect(sql).toContain("resulting_available numeric(7,2)");
    expect(sql).toContain("v_before := public.crew_leave_entitlement_balance(v_entitlement.id)");
    expect(sql).toContain("v_after := public.crew_leave_entitlement_balance(v_entitlement.id)");
  });
});
