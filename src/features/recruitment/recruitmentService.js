import { supabase } from "../../lib/supabase.ts";
import { throwSupabaseError } from "../../services/supabaseError.js";

async function call(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  throwSupabaseError(name, error);
  return data;
}

export const recruitmentService = {
  generateReport: async (applicationId, requestId, newVersion = false, attemptId = null) => {
    const {data,error} = await supabase.functions.invoke("recruitment-report", {body:{application_id:applicationId,request_id:requestId,new_version:newVersion,attempt_id:attemptId}});
    if(error){const detail=await error.context?.json?.().catch(()=>null);throw new Error(detail?.error||"Report generation unavailable.");} return data;
  },
  reviewReport: (reportId) => call("recruitment_report_review", {p_report_id:reportId}),
  decide: ({applicationId,requestId,expectedState,decision,reason,hire,reportId}) => call("recruitment_decide", {p_application_id:applicationId,p_request_id:requestId,p_expected_state:expectedState,p_decision:decision,p_reason:reason,p_hire:hire,p_report_id:reportId}),
  adminData: (page = 1) => call("recruitment_admin_data", { p_page: page, p_page_size: 20 }),
  findApplicants: (query) => call("recruitment_find_applicants", { p_query: query }),
  saveOpening: (opening) => call("recruitment_save_opening", { p_opening: opening }),
  registerApplication: (openingId, applicant, applicantId = null) => call("recruitment_register_application", { p_opening_id: openingId, p_applicant: applicant, p_applicant_id: applicantId }),
  issueInvitation: (applicationId, expiresAt) => call("recruitment_issue_invitation", { p_application_id: applicationId, p_expires_at: expiresAt }),
  revokeInvitation: (applicationId) => call("recruitment_revoke_invitation", { p_application_id: applicationId }),
  publicEntry: (token) => call("recruitment_public_entry", { p_token: token }),
  confirmProfile: (token, name, contact) => call("recruitment_public_confirm_profile", { p_token: token, p_name: name, p_contact: contact }),
  consent: (token, version) => call("recruitment_public_consent", { p_token: token, p_copy_version: version, p_accepted: { ai: true, recording: true, review: true } }),
  ready: (token) => call("recruitment_public_ready", { p_token: token, p_device_check: { camera: "ready", microphone: "ready" } }),
  evidence: async (action, token, clientId, payload = {}) => {
    const { data, error } = await supabase.functions.invoke("recruitment-evidence", { body: { action, token, client_id: clientId, payload } });
    if (error) { const detail = await error.context?.json?.().catch(() => null); throw new Error(detail?.error || "Interview evidence request failed. Please retry."); }
    if (data?.error) throw new Error(data.error);
    return data;
  },
  managerEvidence: async (applicationId, attemptId = null) => {
    const { data, error } = await supabase.functions.invoke("recruitment-evidence", { body: { action: "manager", application_id: applicationId, attempt_id: attemptId } });
    throwSupabaseError("recruitment-evidence", error); return data;
  },
  interruption: (token, clientId, reason) => call("recruitment_public_interruption", { p_token: token, p_client_id: clientId, p_reason: reason }),
  finish: (token, clientId, reason) => call("recruitment_public_finish", { p_token: token, p_client_id: clientId, p_reason: reason }),
  annotation: (token, clientId, generation, itemId, kind, elapsedMs) => call("recruitment_public_annotation", { p_token: token, p_client_id: clientId, p_generation: generation, p_item_id: itemId, p_kind: kind, p_elapsed_ms: elapsedMs }),
  trace: (token, clientId, records) => call("recruitment_public_traces", {p_token:token,p_client_id:clientId,p_records:records}),
  begin: (token, clientId) => call("recruitment_public_begin", { p_token: token, p_client_id: clientId }),
  heartbeat: (token, clientId) => call("recruitment_public_heartbeat", { p_token: token, p_client_id: clientId }),
  providerConnected: (token, clientId, generation) => call("recruitment_public_provider_connected", { p_token: token, p_client_id: clientId, p_generation: generation }),
  providerDisconnected: (token, clientId, generation) => call("recruitment_public_provider_disconnected", { p_token: token, p_client_id: clientId, p_generation: generation }),
  transcriptTurn: (token, clientId, item) => call("recruitment_public_transcript_turn", { p_token: token, p_client_id: clientId, p_generation: item.generation, p_provider_order: item.providerOrder, p_item_id: item.itemId, p_speaker: item.speaker, p_transcript: item.transcript, p_start_ms: item.startMs ?? null, p_end_ms: item.elapsedMs }),
  realtimeSecret: async (token, clientId) => {
    const { data, error } = await supabase.functions.invoke("recruitment-realtime", { body: { token, client_id: clientId } });
    throwSupabaseError("recruitment-realtime", error);
    return data;
  },
};
