import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20261001133222_crew_attendance_location_hardening.sql"), "utf8");

describe("Crew attendance location hardening migration", () => {
  it("keeps separate in/out geofence evidence and requires accurate GPS for verification", () => {
    expect(migration).toContain("clock_in_geofence_latitude");
    expect(migration).toContain("clock_out_geofence_radius_meters");
    expect(migration).toContain("v_accuracy_ok:=v_accuracy is not null and v_accuracy<=v_accuracy_limit");
    expect(migration).toContain("v_verified:=v_distance<=v_outlet.attendance_radius_meters and v_accuracy_ok");
    expect(migration).toContain("v_outlet_id:=v_record.outlet_id");
    expect(migration).toContain("v_open_shift:=found");
    expect(migration).toContain("v_exception:=true");
  });
});
