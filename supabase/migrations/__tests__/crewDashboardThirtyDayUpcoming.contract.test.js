import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260921234500_crew_dashboard_30_day_upcoming.sql"), "utf8").toLowerCase();

describe("Crew Dashboard 30-day upcoming projection contract", () => {
  it("extends the applied daily projection through a new read-only authority", () => {
    expect(sql).toContain("create or replace function public.crew_dashboard_admin_data_v2");
    expect(sql).toContain("base_data := public.crew_dashboard_admin_data(p_outlet_id)");
    expect(sql).toContain("d + 30");
    expect(sql).toContain("event_date > d + 7");
    expect(sql).toContain("grant execute on function public.crew_dashboard_admin_data_v2(uuid) to authenticated");
    expect(sql).not.toMatch(/\b(insert|update|delete)\s+into\b/);
  });

  it("keeps upcoming events outlet scoped, permission aware, and date sorted", () => {
    expect(sql).toContain("current_user_has_permission('crew_leave.view')");
    expect(sql).toContain("current_user_has_permission('employee_compliance.view')");
    expect(sql).toContain("r.employment_outlet_id = p_outlet_id");
    expect(sql).toContain("crew_resolve_employee_outlet(e.id) = p_outlet_id");
    expect(sql).toContain("make_date");
    expect(sql).toContain("order by (event ->> 'date')::date");
    expect(sql).not.toContain("birthday', birthday");
  });
});
