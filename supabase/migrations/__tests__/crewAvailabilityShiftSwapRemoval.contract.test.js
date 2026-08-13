import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260813071558_remove_crew_availability_shift_swap_v1.sql"), "utf8").toLowerCase();
const sessionCleanupSql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260813072908_remove_crew_availability_shift_swap_qa_sessions.sql"), "utf8").toLowerCase();

describe("Crew Availability and Shift Swap withdrawal migration", () => {
  it("removes every feature authority and trigger explicitly", () => {
    for (const fn of [
      "crew_availability_save",
      "crew_availability_mobile",
      "crew_shift_candidates",
      "crew_shift_request_submit",
      "crew_shift_request_respond",
      "crew_shift_request_cancel",
      "crew_shift_requests_mobile",
      "crew_shift_requests_admin",
      "crew_shift_request_review",
      "crew_roster_availability_check",
      "crew_roster_capture_availability_conflict",
      "crew_shift_candidate_eligible",
      "crew_employee_availability",
    ]) expect(sql).toContain(`drop function if exists public.${fn}`);

    expect(sql).toContain("drop trigger if exists crew_roster_capture_availability_conflict");
    expect(sql).toContain("drop trigger if exists crew_published_roster_capture_availability_conflict");
  });

  it("removes only feature tables, metadata and permissions", () => {
    for (const table of [
      "crew_shift_request_audit",
      "crew_shift_requests",
      "crew_availability_exceptions",
      "crew_availability_windows",
    ]) expect(sql).toContain(`drop table if exists public.${table}`);

    for (const permission of [
      "crew_availability.view",
      "crew_availability.manage",
      "crew_shift_requests.view",
      "crew_shift_requests.review",
    ]) expect(sql).toContain(`'${permission}'`);
  });

  it("retains immutable publications and all non-feature Crew domains", () => {
    expect(sql).not.toMatch(/drop table(?: if exists)? public\.duty_roster_publications/);
    expect(sql).not.toMatch(/drop table(?: if exists)? public\.duty_roster_published_entries/);
    expect(sql).not.toMatch(/delete from public\.duty_roster_publications/);
    expect(sql).not.toMatch(/delete from public\.duty_roster_published_entries/);
    for (const protectedDomain of ["crew_leave", "crew_attendance", "crew_operations", "crew_performance", "crew_reward"]) {
      expect(sql).not.toMatch(new RegExp(`drop (?:table|function)[^;]*${protectedDomain}`));
    }
  });

  it("cleans only dedicated feature seed draft rows", () => {
    expect(sql).toContain("where source = 'manual_roster'");
    expect(sql).toContain("'qa availability warning'");
    expect(sql).not.toContain("delete from public.employees");
    expect(sql).not.toContain("delete from public.crew_approved_leaves");
    expect(sessionCleanupSql).toContain("delete from public.crew_sessions");
    expect(sessionCleanupSql).toContain("'availability-demo-' || e.employee_code");
    expect(sessionCleanupSql).not.toContain("delete from public.employees");
    expect(sessionCleanupSql).not.toContain("delete from public.crew_access");
  });
});
