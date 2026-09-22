import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260921220000_crew_admin_dashboard_projection.sql"), "utf8").toLowerCase();

describe("Crew Dashboard projection contract", () => {
  it("keeps the Dashboard read-only, outlet scoped, and permission aware", () => {
    expect(sql).toContain("create or replace function public.crew_dashboard_admin_data");
    expect(sql).toContain("current_user_has_permission('crew_dashboard.view')");
    expect(sql).toContain("current_user_can_access_outlet(p_outlet_id)");
    expect(sql).toContain("revoke all on function public.crew_dashboard_admin_data(uuid)");
    expect(sql).toContain("grant execute on function public.crew_dashboard_admin_data(uuid) to authenticated");
    expect(sql).not.toMatch(/\b(insert|update|delete)\s+into\b/);
  });

  it("uses canonical Workforce sources and does not expose birth years", () => {
    expect(sql).toContain("duty_roster_published_entries");
    expect(sql).toContain("crew_attendance_records");
    expect(sql).toContain("crew_leave_requests");
    expect(sql).toContain("employee_compliance_current");
    expect(sql).toContain("crew_performance_admin_data");
    expect(sql).toContain("'days_until'");
    expect(sql).not.toContain("'birthday', birthday");
  });
});
