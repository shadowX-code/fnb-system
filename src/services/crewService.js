import { supabase } from "../lib/supabase";
import { throwSupabaseError } from "./supabaseError";

export const CREW_ACCESS_STATE_LABEL = {
  active: "Active",
  disabled: "Disabled",
  locked: "Locked",
  not_enabled: "Not Enabled",
};

export function crewAccessState(access) {
  return access?.access_state || "not_enabled";
}

export const crewService = {
  async manageAccess(employeeId, action, passcode = "") {
    const { data, error } = await supabase.rpc("manage_crew_access", {
      p_employee_id: employeeId,
      p_action: action,
      p_passcode: passcode || null,
    });
    throwSupabaseError("crew.manageAccess", error);
    return data;
  },

  async signIn(mobile, passcode) {
    const { data, error } = await supabase.rpc("crew_authenticate", {
      p_mobile: mobile,
      p_passcode: passcode,
      p_ip_hash: null,
    });
    throwSupabaseError("crew.signIn", error);
    return data;
  },

  async attendanceContext(token) {
    const { data, error } = await supabase.rpc("crew_attendance_context", { p_token: token });
    throwSupabaseError("crew.attendanceContext", error);
    return data;
  },

  async clock(token, action, location = null, exceptionReason = "") {
    const { data, error } = await supabase.rpc("crew_clock", {
      p_token: token,
      p_action: action,
      p_location: location,
      p_exception_reason: exceptionReason || null,
    });
    throwSupabaseError("crew.clock", error);
    return data;
  },

  async changePasscode(token, currentPasscode, newPasscode) {
    const { data, error } = await supabase.rpc("crew_change_passcode", {
      p_token: token,
      p_current_passcode: currentPasscode,
      p_new_passcode: newPasscode,
    });
    throwSupabaseError("crew.changePasscode", error);
    return data;
  },

  async myAttendance(token) {
    const { data, error } = await supabase.rpc("crew_my_attendance", { p_token: token, p_limit: 60 });
    throwSupabaseError("crew.myAttendance", error);
    return data || [];
  },

  async listAttendance() {
    const { data, error } = await supabase
      .from("crew_attendance_records")
      .select("*, employee:employees(id,full_name,nickname,position,workplace), outlet:outlets(id,name)")
      .order("clock_in_at", { ascending: false })
      .limit(200);
    throwSupabaseError("crew.listAttendance", error);
    return data || [];
  },
};
