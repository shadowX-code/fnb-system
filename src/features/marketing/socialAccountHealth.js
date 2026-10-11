export const socialStateLabel = (state) =>
  ({
    verified: "Ready",
    operational: "Operational",
    connected: "Connected",
    action_required: "Action Required",
    permission_required: "Permission Required",
    expired: "Expired",
    not_connected: "Not connected",
  })[state] || "Action Required";
export function socialCapabilities(c) {
  const live =
    ["test_authorized", "production_authorized"].includes(c.status) &&
    Date.parse(c.expires_at) > Date.now();
  if (!live)
    return {
      publishing: { state: "action_required", reason: "reconnect" },
      messaging: { state: "action_required", reason: "reconnect" },
      insights: { state: "action_required", reason: "reconnect" },
    };
  return {
    publishing: c.health?.publishing || {
      state: c.capabilities?.publishing ? "verified" : "connected",
      reason: c.capabilities?.publishing ? "ready" : "verification_pending",
    },
    messaging: c.messaging?.receiving_verified
      ? { state: "operational", reason: "ready" }
      : c.health?.messaging || {
          state:
            c.messaging?.state === "permission_unavailable"
              ? "permission_required"
              : "connected",
          reason:
            c.messaging?.state === "permission_unavailable"
              ? "permission_missing"
              : "verification_pending",
        },
    insights: c.health?.insights || {
      state: c.capabilities?.insights ? "connected" : "permission_required",
      reason: c.capabilities?.insights
        ? "verification_pending"
        : "permission_missing",
    },
  };
}
export function socialAccountStatus(c) {
  if (c.status === "not_connected") return "not_connected";
  if (
    c.status === "expired" ||
    (c.expires_at && Date.parse(c.expires_at) <= Date.now())
  )
    return "expired";
  if (c.status === "error" || c.health?.credential_valid === false)
    return "action_required";
  const capabilities = Object.values(socialCapabilities(c));
  if (capabilities.some((x) => x.state === "action_required"))
    return "action_required";
  if (capabilities.some((x) => x.state === "permission_required"))
    return "permission_required";
  return c.messaging?.receiving_verified &&
    c.capabilities?.posts &&
    c.last_synced_at
    ? "operational"
    : "connected";
}
export const socialReason = (reason) =>
  ({
    ready: "Verified for this account.",
    permission_missing:
      "Meta has not granted access. Your FeedX administrator can review the app’s approved access.",
    authorization_unverified:
      "Account access could not be verified. Check your Meta Page access, then refresh status.",
    subscriptions_missing:
      "Inbox updates need installation. Review and enable updates for this account.",
    app_setup_required:
      "The FeedX app needs administrator setup. You do not need to enter secrets or webhook URLs.",
    subscription_read_unavailable:
      "Meta could not confirm Inbox updates. Refresh status before trying again.",
    inbound_pending:
      "Connected. Waiting for the first real incoming message to verify delivery.",
    metrics_unavailable:
      "Access granted; supported metrics have not been returned.",
    verification_pending: "Refresh status to verify this capability.",
    reconnect: "Reconnect this account to restore access.",
    required_scopes_missing: "Meta has not granted the required access.",
    page_tasks_unverified:
      "Your Page assignment could not be verified. Check Page access and refresh status.",
    content_task_not_granted:
      "Your Meta Page access does not include creating content.",
    business_manager_ads_read_required:
      "Meta requires additional approved app access for this business-assigned Instagram account.",
    professional_account_unverified:
      "Confirm this is a Professional account linked to the selected Page.",
    page_assignment_provenance_unverified:
      "The authorizer’s Page assignment could not be verified.",
    required_scope_target_unavailable:
      "The required access was not granted for this exact account.",
    page_credential_unverified:
      "Reconnect this account to refresh Meta authorization.",
    credential_account_unverified:
      "Meta could not confirm the account’s current identity.",
  })[reason] ||
  "Meta could not verify this capability. Refresh status or ask your FeedX administrator to review account access.";
