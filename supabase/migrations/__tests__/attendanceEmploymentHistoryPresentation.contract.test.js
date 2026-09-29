import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260929073343_attendance_employment_history_presentation.sql"), "utf8");

describe("Attendance historical employment presentation", () => {
  it("resolves one dated People assignment per distinct employee/business date in the server projection", () => {
    expect(sql).toContain("select distinct employee_id,business_date from attendance");
    expect(sql).toContain("public.employee_employment_assignment_at(k.employee_id,k.business_date)");
    expect(sql).toContain("'state',case when (em.assignment).id is null then 'unverified'");
    expect(sql).toContain("'position',(em.assignment).position");
    expect(sql).toContain("'workplace',(em.assignment).workplace");
    expect(sql).toContain("value->'employee'->>'position'=p_filters->>'position'");
  });

  it("keeps attendance outlet and pinned published roster separate from employment context", () => {
    expect(sql).toContain("'outlet',jsonb_build_object('id',a.outlet_id");
    expect(sql).toContain("r.id=a.scheduled_roster_entry_id");
    expect(sql).toContain("r.position_snapshot");
    expect(sql).toContain("r.outlet_name_snapshot");
    expect(sql).not.toMatch(/(?:update|delete from|insert into) public\.(?:crew_attendance_records|duty_roster_published_entries)/i);
  });

  it("keeps Attendance permission and outlet checks in the owning read", () => {
    expect(sql).toContain("current_user_has_permission('crew_attendance.view')");
    expect(sql).toContain("current_user_can_access_outlet(p_outlet_id)");
    expect(sql).toContain("current_user_can_access_outlet(a.outlet_id)");
    expect(sql).toContain("grant execute on function public.crew_attendance_admin_page(date,date,uuid,jsonb,integer,integer) to authenticated");
  });
});
