import { supabase } from "../../lib/supabase.ts";
import { throwSupabaseError } from "../../services/supabaseError.js";

async function call(name, args, signal) {
  const request = supabase.rpc(name, args);
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
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
  workspace: ({openingId=null,stage="all",page=1,includeQa=false}={}) => call("recruitment_workspace", {p_opening_id:openingId,p_stage:stage,p_page:page,p_include_qa:includeQa}),
  publishProfile: (definition, expectedVersion) => call("recruitment_publish_profile", {p_definition:definition,p_expected_version:expectedVersion}),
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
  evidence: async (action, token, clientId, payload = {}, signal) => {
    const { data, error } = await supabase.functions.invoke("recruitment-evidence", { body: { action, token, client_id: clientId, payload }, signal });
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
  recoveryState: (token, clientId, signal) => call("recruitment_recovery_state", {p_token:token,p_client_id:clientId}, signal),
  recoverBegin: (token, clientId, requestId, expectedId, signal) => call("recruitment_recovery_begin", {p_token:token,p_client_id:clientId,p_request_id:requestId,p_expected_id:expectedId}, signal),
  recoverPause: (token, clientId, requestId, reason) => call("recruitment_recovery_pause", {p_token:token,p_client_id:clientId,p_request_id:requestId,p_reason:reason}),
  observeRecovery: (token, clientId, key, record) => call("recruitment_recovery_observe", {p_token:token,p_client_id:clientId,p_key:key,p_record:record}),
  begin: (token, clientId) => call("recruitment_public_begin", { p_token: token, p_client_id: clientId }),
  heartbeat: (token, clientId) => call("recruitment_public_heartbeat", { p_token: token, p_client_id: clientId }),
  providerConnected: (token, clientId, generation, recoveryId, signal) => call(recoveryId ? "recruitment_recovery_connected" : "recruitment_public_provider_connected", { p_token: token, p_client_id: clientId, p_generation: generation, ...(recoveryId ? {p_request_id:recoveryId} : {}) }, signal),
  providerDisconnected: (token, clientId, generation) => call("recruitment_public_provider_disconnected", { p_token: token, p_client_id: clientId, p_generation: generation }),
  transcriptTurn: (token, clientId, item) => call("recruitment_public_transcript_turn", { p_token: token, p_client_id: clientId, p_generation: item.generation, p_provider_order: item.providerOrder, p_item_id: item.itemId, p_speaker: item.speaker, p_transcript: item.transcript, p_start_ms: item.startMs ?? null, p_end_ms: item.elapsedMs }),
  realtimeContext: async (token,clientId,recoveryId,generation,signal) => {
    const {data,error}=await supabase.functions.invoke("recruitment-realtime",{body:{action:"context",token,client_id:clientId,recovery_id:recoveryId,generation},signal});
    throwSupabaseError("recruitment-realtime",error);return data;
  },
  realtimeSecret: async (token, clientId, recoveryId, signal) => {
    const { data, error } = await supabase.functions.invoke("recruitment-realtime", { body: { token, client_id: clientId, recovery_id: recoveryId, conversation_version:"provider-owned-v1" }, signal });
    throwSupabaseError("recruitment-realtime", error);
    return data;
  },
};
