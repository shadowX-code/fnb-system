import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const hardening = readFileSync(resolve(process.cwd(), "supabase/migrations/202608110003_crew_foundation_security_hardening.sql"), "utf8");

describe("Crew Foundation security hardening migration contract", () => {
  it("explicitly removes client execution from internal SECURITY DEFINER helpers", () => {
    for (const signature of ["crew_resolve_employee_outlet(uuid)", "crew_session_employee(text)", "crew_normalize_mobile(text)", "crew_valid_passcode(text)"]) {
      expect(hardening).toContain(`revoke all on function public.${signature} from public, anon, authenticated;`);
    }
  });

  it("makes every externally callable Crew RPC an explicit grant rather than PUBLIC default access", () => {
    expect(hardening).toContain("grant execute on function public.manage_crew_access(uuid, text, text) to authenticated;");
    for (const signature of ["crew_authenticate(text, text, text)", "crew_clock(text, text, jsonb, text)", "crew_my_attendance(text, integer)", "crew_attendance_context(text)", "crew_change_passcode(text, text, text)"]) {
      expect(hardening).toContain(`revoke all on function public.${signature} from public, anon, authenticated;`);
      expect(hardening).toContain(`grant execute on function public.${signature} to anon, authenticated;`);
    }
  });

  it("recovers only an expired eligible lock and resets the failure window after success", () => {
    expect(hardening).toContain("v_access_found := found;");
    expect(hardening).toContain("v_access.access_state = 'locked' and v_access.locked_until is not null and v_access.locked_until <= now()");
    expect(hardening).toContain("coalesce(v_employee.employment_status, 'active') not in ('resigned', 'terminated')");
    expect(hardening).toContain("select max(attempted_at) into v_last_success");
    expect(hardening).toContain("attempted_at > v_last_success");
  });

  it("permits authorized disable cleanup before employment eligibility is evaluated", () => {
    const disableIndex = hardening.indexOf("if v_action = 'disable' then");
    const eligibilityIndex = hardening.indexOf("if v_employee.employment_status in ('resigned', 'terminated') then");
    expect(disableIndex).toBeGreaterThan(-1);
    expect(disableIndex).toBeLessThan(eligibilityIndex);
    expect(hardening).toContain("update public.crew_sessions set revoked_at = now()");
  });

  it("rejects contradictory and physically invalid GPS evidence while retaining nullable legacy records", () => {
    expect(hardening).toContain("and not (clock_in_location_verified and clock_in_location_exception)");
    expect(hardening).toContain("and not (clock_out_location_verified and clock_out_location_exception)");
    expect(hardening).toContain("clock_in_accuracy_meters is null or clock_in_accuracy_meters >= 0");
    expect(hardening).toContain("clock_out_distance_meters is null or clock_out_distance_meters >= 0");
    expect(hardening).toContain("not clock_in_location_exception and clock_in_exception_reason is null");
  });
});
