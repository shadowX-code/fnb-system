import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/202608110002_crew_attendance_geofence.sql"), "utf8");

describe("Crew attendance geofence migration contract", () => {
  it("keeps Outlet as the GPS source of truth and leaves unconfigured outlets disabled", () => {
    expect(migration).toContain("attendance_location_enabled boolean not null default false");
    expect(migration).toContain("attendance_latitude numeric(9,6)");
    expect(migration).toContain("attendance_radius_meters integer not null default 100");
    expect(migration).toContain("This outlet has location verification enabled but is not configured");
  });

  it("records immutable GPS evidence with a server-side Haversine decision", () => {
    expect(migration).toContain("clock_in_distance_meters");
    expect(migration).toContain("clock_out_accuracy_meters");
    expect(migration).toContain("create or replace function public.crew_haversine_meters");
    expect(migration).toContain("v_distance := round(public.crew_haversine_meters");
    expect(migration).toContain("v_verified := v_distance <= v_outlet.attendance_radius_meters");
    expect(migration).toContain("drop function if exists public.crew_clock(text, text)");
  });

  it("requires a clock-in exception outside a geofence but lets clock-out finish safely", () => {
    expect(migration).toContain("Choose an exception reason to continue");
    expect(migration).toContain("Location permission is required to verify this clock-in");
    expect(migration).toContain("Location unavailable at clock out.");
  });

  it("rechecks active Crew access and applies outlet-scoped admin policies", () => {
    expect(migration).toContain("and a.access_state = 'active'");
    expect(migration).toContain("public.current_user_can_access_outlet(outlet_id)");
    expect(migration).toContain("You cannot manage Crew Access for an employee assigned to an inaccessible outlet.");
    expect(migration).toContain("'temporary_passcode', v_passcode");
    expect(migration).not.toContain("'passcode_hash'");
  });

  it("lets a Crew member change a passcode only through their active session and revokes prior sessions", () => {
    expect(migration).toContain("create or replace function public.crew_change_passcode");
    expect(migration).toContain("Current passcode is incorrect.");
    expect(migration).toContain("update public.crew_sessions set revoked_at = now() where employee_id = v_employee_id and revoked_at is null");
    expect(migration).toContain("'crew_passcode_changed'");
  });
});
