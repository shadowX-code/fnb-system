import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260813030000_crew_roster_ownership_integration.sql"), "utf8");
const validationFix = readFileSync(resolve(process.cwd(), "supabase/migrations/20260813030001_duty_roster_week_snapshot_validation_fix.sql"), "utf8");
const multiOutletFix = readFileSync(resolve(process.cwd(), "supabase/migrations/20260813030002_duty_roster_multi_outlet_employee_scope.sql"), "utf8");
const resultFix = readFileSync(resolve(process.cwd(), "supabase/migrations/20260813030003_duty_roster_snapshot_result_ambiguity_fix.sql"), "utf8");

describe("Crew Duty Roster ownership integration migration", () => {
  it("keeps one roster domain and adds canonical Crew permissions", () => {
    expect(sql).toContain("'crew_roster.view'");
    expect(sql).toContain("'crew_roster.manage'");
    expect(sql).toContain("'crew_roster.publish'");
    expect(sql).not.toContain("create table if not exists public.crew_duty_rosters");
  });

  it("creates an immutable published projection without exposing its tables", () => {
    expect(sql).toContain("create table if not exists public.duty_roster_publications");
    expect(sql).toContain("create table if not exists public.duty_roster_published_entries");
    expect(sql).toContain("revoke all on table public.duty_roster_published_entries from public, anon, authenticated");
    expect(sql).toContain("select coalesce(max(revision),0)+1");
  });

  it("provides token-bound own reads and private downstream evidence", () => {
    expect(sql).toContain("public.crew_my_roster");
    expect(sql).toContain("v_employee_id:=public.crew_session_employee(p_token)");
    expect(sql).toContain("e.employee_id=v_employee_id");
    expect(sql).toContain("public.crew_performance_roster_attendance_evidence");
    expect(sql).toContain("public.crew_operations_today");
  });

  it("removes anon execution from all roster admin authorities", () => {
    for (const name of ["save_roster_week_snapshot", "copy_roster_week", "publish_roster_week", "unpublish_roster_week", "lock_roster_week"]) {
      expect(sql).toContain(`revoke all on function public.${name}`);
    }
  });

  it("keeps duplicate employee/date validation executable with nullable template checks", () => {
    expect(validationFix).toContain("having bool_or(r.employee_id is null or r.roster_date is null or r.shift_template_id is null)");
    expect(validationFix).toContain("or count(*) > 1");
    expect(validationFix).toContain("set search_path = public");
    expect(validationFix).toContain("revoke all on function public.save_roster_week_snapshot(uuid, uuid, date, jsonb) from public, anon, authenticated");
  });

  it("supports multi-outlet scheduling only when both target and employee home outlets are in scope", () => {
    expect(multiOutletFix).toContain("public.current_user_can_access_outlet(p_outlet_id)");
    expect(multiOutletFix).toContain("public.current_user_can_access_outlet(public.crew_resolve_employee_outlet(e.id))");
    expect(multiOutletFix).toContain("crew roster viewers can view schedulable employees");
    expect(multiOutletFix).toContain("revoke all on function public.save_roster_week_snapshot(uuid,uuid,date,jsonb) from public,anon,authenticated");
  });

  it("disambiguates the trusted snapshot result from the lifecycle result column", () => {
    expect(resultFix).toContain("v_result jsonb");
    expect(resultFix).toContain("set result=v_result,completed_at=now()");
    expect(resultFix).toContain("return v_result;");
  });
});
