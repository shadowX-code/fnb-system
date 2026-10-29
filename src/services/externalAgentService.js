import { supabase } from "../lib/supabase.ts";

// Do not use the generic error logger on credential-bearing operations.
async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.code === "42501" ? "You do not have Role Settings authority for this action." : error.code === "40001" ? "Credential state changed. Refresh the connection and try again." : error.code === "55000" ? "This rotation was already issued. Refresh before starting a new rotation; credentials cannot be retrieved again." : "The request could not be completed. Refresh the connection before trying again.");
  return data;
}
export const externalAgentService = {
  list: () => rpc("external_agents_admin_data", { p_identity_id: null }),
  details: (id) => rpc("external_agents_admin_data", { p_identity_id: id }),
  revoke: (id, credentialId) => rpc("external_agents_revoke_credential", { p_identity_id: id, p_credential_id: credentialId }),
  // Only this explicit issuance response may contain a newly generated credential.
  rotate: (id, expectedCredentialId, requestId) => rpc("external_agents_rotate_credential", { p_identity_id: id, p_expected_credential_id: expectedCredentialId, p_request_id: requestId }),
  async test(id, credential = "") {
    const { data, error } = await supabase.functions.invoke("external-agent-management", { body: { identity_id: id, ...(credential ? { credential } : {}) } });
    if (error || data?.error) throw new Error("Connection test failed. Check your authority and, if supplied, the agent credential.");
    return data;
  },
};
