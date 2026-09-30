import { supabase } from "../../lib/supabase.ts";
import { throwSupabaseError } from "../../services/supabaseError.js";

async function call(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  throwSupabaseError(name, error);
  return data;
}

export const recruitmentService = {
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
};
