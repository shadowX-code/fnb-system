import { supabase } from "../lib/supabase.ts";

// Do not use the generic error logger on credential-bearing operations.
async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.code === "42501" ? "You do not have Role Settings authority for this action." : error.code === "40001" ? "Access changed. Refresh the agent and try again." : error.code === "55000" ? "This request was already completed. Refresh the agent; access keys can only be shown once." : "The request could not be completed. Refresh the connection before trying again.");
  return data;
}
export const externalAgentService = {
  review: (id, desired) => rpc("external_agents_review_access",{p_identity_id:id,p_desired:desired}),
  confirmAccess: (id, desired, hash) => rpc("external_agents_confirm_access",{p_identity_id:id,p_desired:desired,p_review_hash:hash}),
  registerReviewed: (request,name,provider,adapter,tools,validity,hash) => rpc("external_agents_register_reviewed",{p_request_id:request,p_name:name,p_provider:provider,p_adapter_key:adapter,p_tool_ids:tools,p_validity_days:validity,p_review_hash:hash}),
  resolve: (id, moduleId, resource, action = "view") => rpc("external_agents_resolve_access", {p_identity_id:id,p_module_id:moduleId,p_resource:resource,p_action:action}),
  list: () => rpc("external_agents_admin_data", { p_identity_id: null }),
  details: (id) => rpc("external_agents_admin_data", { p_identity_id: id }),
  register: (requestId, name, provider, adapterKey, tools, validity = 90) => rpc("external_agents_register", { p_request_id: requestId, p_name: name, p_provider: provider, p_adapter_key: adapterKey, p_tool_ids: tools, p_validity_days: validity }),
  setEnabled: (id, enabled, expected) => rpc("external_agents_set_enabled", { p_identity_id: id, p_enabled: enabled, p_expected_enabled: expected }),
  setCapabilities: (id, changes) => rpc("external_agents_set_capabilities", { p_identity_id: id, p_changes: changes }),
  setCapability: (id, toolId, granted, expected) => rpc("external_agents_set_capability", { p_identity_id: id, p_tool_id: toolId, p_granted: granted, p_expected_granted: expected }),
  revoke: (id, credentialId) => rpc("external_agents_revoke_credential", { p_identity_id: id, p_credential_id: credentialId }),
  // Only this explicit issuance response may contain a newly generated credential.
  rotate: (id, expectedCredentialId, requestId, validity = 90) => rpc("external_agents_rotate_credential", { p_identity_id: id, p_expected_credential_id: expectedCredentialId, p_request_id: requestId, p_validity_days: validity }),
  async test(id, credential = "") {
    const { data, error } = await supabase.functions.invoke("external-agent-management", { body: { identity_id: id, ...(credential ? { credential } : {}) } });
    if (error || data?.error) throw new Error("Connection test failed. Check your authority and, if supplied, the agent credential.");
    return data;
  },
};
