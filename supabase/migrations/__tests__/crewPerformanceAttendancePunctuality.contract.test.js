import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const initial = fs.readFileSync(path.resolve("supabase/migrations/20260922010000_crew_performance_attendance_punctuality.sql"), "utf8").toLowerCase();
const sql = `${initial}\n${fs.readFileSync(path.resolve("supabase/migrations/20260922012000_crew_performance_attendance_punctuality_cross_midnight_fix.sql"), "utf8")}`.toLowerCase();

describe("Crew Performance Attendance punctuality contract", () => {
  it("uses a server-owned 15 point completeness and 15 point punctuality model", () => {
    expect(sql).toContain("v_completeness:=round(15*v_completed::numeric/v_expected,2)");
    expect(sql).toContain("greatest(0,15-v_minor*0.5-v_late*1.5-v_severe*3)");
    expect(sql).toContain("between 11 and 20");
    expect(sql).toContain("between 21 and 45");
    expect(sql).toContain("'grace_minutes',10");
    expect(sql).toContain("'performance-attendance-v2'");
  });

  it("uses immutable clock-in roster evidence and excludes late-published schedules", () => {
    expect(sql).toContain("scheduled_roster_publication_id");
    expect(sql).toContain("scheduled_start_at");
    expect(sql).toContain("publication.published_at <= a.clock_in_at");
    expect(sql).toContain("s.published_at<=s.scheduled_start");
  });

  it("keeps scoring exceptions auditable, reasoned, scoped, and recalculated server-side", () => {
    expect(sql).toContain("create table if not exists public.crew_attendance_performance_exceptions");
    expect(sql).toContain("create table if not exists public.crew_attendance_performance_exception_audit");
    expect(sql).toContain("if not public.current_user_has_permission('crew_attendance.manage')");
    expect(sql).toContain("a meaningful exception reason is required");
    expect(sql).toContain("perform public.crew_refresh_performance");
  });

  it("does not turn location exceptions into a direct score deduction", () => {
    expect(sql).toContain("'location_exceptions',v_location_exceptions");
    expect(sql).not.toContain("v_location_exceptions*");
  });
});
