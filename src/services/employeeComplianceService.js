import { supabase } from "../lib/supabase";
import { throwSupabaseError } from "./supabaseError";

async function invokeEvidence(body) {
  const { data, error } = await supabase.functions.invoke("employee-compliance-evidence", { body });
  if (error) throw new Error(data?.error || "Compliance evidence is unavailable.");
  if (data?.error) throw new Error(data.error);
  return data;
}

export const employeeComplianceService = {
  async adminPage({ outletId, filters = {}, page = 1, pageSize = 20 }) {
    const { data, error } = await supabase.rpc("employee_compliance_admin_page", {
      p_outlet_id: outletId === "all" ? null : outletId || null,
      p_filters: filters,
      p_page: page,
      p_page_size: pageSize,
    });
    throwSupabaseError("employeeCompliance.page", error);
    return { rows: data?.rows ?? [], totalCount: data?.total_count ?? 0, page: data?.page ?? page, pageSize: data?.page_size ?? pageSize, summary: data?.summary ?? {} };
  },
  async adminDetail(employeeId) {
    const { data, error } = await supabase.rpc("employee_compliance_admin_detail", { p_employee_id: employeeId });
    throwSupabaseError("employeeCompliance.detail", error);
    return data ?? { current: [], history: [] };
  },
  async review({ submissionId, decision, rejectionReason }) {
    const { data, error } = await supabase.rpc("employee_compliance_review", { p_submission_id: submissionId, p_decision: decision, p_rejection_reason: rejectionReason || null });
    throwSupabaseError("employeeCompliance.review", error);
    return data;
  },
  async adminEvidenceUrl(submissionId) {
    return (await invokeEvidence({ action: "admin_read", submission_id: submissionId })).evidence_url;
  },
  async crewOverview(token) {
    const { data, error } = await supabase.rpc("crew_employee_compliance", { p_token: token });
    throwSupabaseError("employeeCompliance.crewOverview", error);
    return data ?? { requirements: [] };
  },
  async crewEvidenceUrl(token, submissionId) {
    return (await invokeEvidence({ action: "crew_read", token, submission_id: submissionId })).evidence_url;
  },
  async submit({ token, requirementCode, expiryDate, requestId, file }) {
    const form = new FormData();
    form.append("token", token);
    form.append("requirement_code", requirementCode);
    form.append("expiry_date", expiryDate || "");
    form.append("request_id", requestId);
    form.append("file", file, `${requirementCode}.webp`);
    return invokeEvidence(form);
  },
};
