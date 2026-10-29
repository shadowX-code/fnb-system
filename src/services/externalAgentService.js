import { supabase } from "../lib/supabase.ts";

// Do not use the generic error logger on credential-bearing operations.
async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.code === "42501" ? "You do not have Role Settings authority for this action." : error.code === "40001" ? "Access changed. Refresh the agent and try again." : error.code === "55000" ? "This request was already completed. Refresh the agent; access keys can only be shown once." : "The request could not be completed. Refresh the connection before trying again.");
  return data;
}
export const externalAgentService = {
  list: () => rpc("external_agents_admin_data", { p_identity_id: null }),
  details: (id) => rpc("external_agents_admin_data", { p_identity_id: id }),
  register: (requestId, name, provider, adapterKey, tools) => rpc("external_agents_register", { p_request_id: requestId, p_name: name, p_provider: provider, p_adapter_key: adapterKey, p_tool_ids: tools }),
  setEnabled: (id, enabled, expected) => rpc("external_agents_set_enabled", { p_identity_id: id, p_enabled: enabled, p_expected_enabled: expected }),
  setCapability: (id, toolId, granted, expected) => rpc("external_agents_set_capability", { p_identity_id: id, p_tool_id: toolId, p_granted: granted, p_expected_granted: expected }),
  revoke: (id, credentialId) => rpc("external_agents_revoke_credential", { p_identity_id: id, p_credential_id: credentialId }),
  // Only this explicit issuance response may contain a newly generated credential.
  rotate: (id, expectedCredentialId, requestId) => rpc("external_agents_rotate_credential", { p_identity_id: id, p_expected_credential_id: expectedCredentialId, p_request_id: requestId }),
  async test(id, credential = "") {
    const { data, error } = await supabase.functions.invoke("external-agent-management", { body: { identity_id: id, ...(credential ? { credential } : {}) } });
    if (error || data?.error) throw new Error("Connection test failed. Check your authority and, if supplied, the agent credential.");
    return data;
  },
};
