import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260922003000_crew_dashboard_operational_detail.sql"), "utf8");

describe("Crew Dashboard operational detail contract", () => {
  it("extends the established read-only dashboard projection with bounded staffing and task detail", () => {
    expect(migration).toContain("crew_dashboard_admin_data_v3");
    expect(migration).toContain("crew_dashboard_admin_data_v2(p_outlet_id)");
    expect(migration).toContain("duty_roster_published_entries");
    expect(migration).toContain("crew_attendance_records");
    expect(migration).toContain("crew_leave_requests");
    expect(migration).toContain("crew_operation_instances");
    expect(migration).toContain("'crew_today', crew_today");
    expect(migration).toContain("'tasks_today', tasks_today");
    expect(migration).toContain("limit 6");
  });

  it("keeps access controlled and does not create Dashboard-owned state", () => {
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path=public");
    expect(migration).toContain("revoke all on function public.crew_dashboard_admin_data_v3(uuid)");
    expect(migration).toContain("grant execute on function public.crew_dashboard_admin_data_v3(uuid) to authenticated");
    expect(migration).not.toMatch(/\b(insert|update|delete)\s+into\b/i);
  });
});
