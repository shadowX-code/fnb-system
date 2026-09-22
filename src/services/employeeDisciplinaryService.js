import { supabase } from "../lib/supabase";
import { throwSupabaseError } from "./supabaseError";

async function invokeEvidence(body) {
  const { data, error } = await supabase.functions.invoke("employee-disciplinary-evidence", { body });
  if (error) throw new Error(data?.error || "Supporting evidence is unavailable.");
  if (data?.error) throw new Error(data.error);
  return data;
}

export const employeeDisciplinaryService = {
  async adminDetail(employeeId) {
    const { data, error } = await supabase.rpc("employee_disciplinary_admin_detail", { p_employee_id: employeeId });
    throwSupabaseError("employeeDisciplinary.detail", error);
    return data ?? { warnings: [] };
  },
  async saveDraft({ warningId = null, employeeId, payload, requestId, supersedesWarningId = null }) {
    const { data, error } = await supabase.rpc("employee_disciplinary_save_draft", { p_warning_id: warningId, p_employee_id: employeeId, p_payload: payload, p_request_id: requestId, p_supersedes_warning_id: supersedesWarningId });
    throwSupabaseError("employeeDisciplinary.saveDraft", error);
    return data;
  },
  async uploadEvidence({ warningId, requestId, file }) {
    const form = new FormData();
    form.append("warning_id", warningId);
    form.append("request_id", requestId);
    form.append("file", file, file.name || "supporting-evidence");
    return invokeEvidence(form);
  },
  async issue(warningId) {
    const { data, error } = await supabase.rpc("employee_disciplinary_issue", { p_warning_id: warningId });
    throwSupabaseError("employeeDisciplinary.issue", error);
    return data;
  },
  async transition({ warningId, action, reason = null }) {
    const { data, error } = await supabase.rpc("employee_disciplinary_admin_transition", { p_warning_id: warningId, p_action: action, p_reason: reason });
    throwSupabaseError("employeeDisciplinary.transition", error);
    return data;
  },
  async adminEvidence(warningId) { return invokeEvidence({ action: "admin_read", warning_id: warningId }); },
  async crewOverview(token) {
    const { data, error } = await supabase.rpc("crew_employee_disciplinary", { p_token: token });
    throwSupabaseError("employeeDisciplinary.crewOverview", error);
    return data ?? { warnings: [] };
  },
  async crewDetail(token, warningId) {
    const { data, error } = await supabase.rpc("crew_employee_disciplinary_detail", { p_token: token, p_warning_id: warningId });
    throwSupabaseError("employeeDisciplinary.crewDetail", error);
    return data;
  },
  async crewRespond(token, warningId, response) {
    const { data, error } = await supabase.rpc("crew_employee_disciplinary_respond", { p_token: token, p_warning_id: warningId, p_response: response });
    throwSupabaseError("employeeDisciplinary.crewRespond", error);
    return data;
  },
  async crewAcknowledge(token, warningId) {
    const { data, error } = await supabase.rpc("crew_employee_disciplinary_acknowledge", { p_token: token, p_warning_id: warningId });
    throwSupabaseError("employeeDisciplinary.crewAcknowledge", error);
    return data;
  },
  async crewEvidence(token, warningId) { return invokeEvidence({ action: "crew_read", token, warning_id: warningId }); },
};
