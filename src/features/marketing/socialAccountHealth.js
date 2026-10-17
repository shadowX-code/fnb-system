export const socialStateLabel = (state, capability) =>
  state === "connected" && capability === "insights" ? "Access Granted" : ({
    verified: "Ready",
    operational: "Operational",
    connected: "OAuth Connected",
    configuration_verified: "Configuration Verified",
    awaiting_first_delivery: "Awaiting First Delivery",
    delivery_verified: "Delivery Verified",
    needs_attention: "Needs Attention",
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
      state: "connected",
      reason: "verification_pending",
    },
    messaging: c.checks?.error_code
      ? { state: "needs_attention", reason: c.checks.error_code }
      : c.messaging?.delivery_verified && c.messaging?.receiving_verified
      ? { state: "delivery_verified", reason: "ready" }
      : (c.messaging?.receiving_verified === false || ["connection_unavailable", "authorization_unverified", "configuration_unverified", "permission_unavailable"].includes(c.messaging?.state))
      ? { state: c.messaging.state === "permission_unavailable" ? "permission_required" : "action_required", reason: c.messaging.state === "permission_unavailable" ? "permission_missing" : c.messaging.state === "configuration_unverified" ? "subscriptions_missing" : "authorization_unverified" }
      : c.messaging?.receiving_verified && c.messaging?.configuration_verified
      ? { state: "awaiting_first_delivery", reason: "inbound_pending" }
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
  if (capabilities.some((x) => ["action_required", "needs_attention"].includes(x.state)))
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
      "Account access could not be verified. Check the authorizing person’s Meta Page access. FeedX will recheck automatically.",
    subscriptions_missing:
      "FeedX is setting up eligible Inbox updates automatically.",
    app_setup_required:
      "The FeedX app needs administrator setup. You do not need to enter secrets or webhook URLs.",
    subscription_install_rejected: "Meta rejected the Inbox update installation. Your administrator should review Page access and app configuration.",
    subscription_read_unavailable:
      "Meta could not confirm Inbox updates. FeedX will retry automatically.",
    inbound_pending:
      "Configuration verified. Delivery will be verified when a genuine incoming message arrives.",
    metrics_unavailable:
      "Access granted; supported metrics have not been returned.",
    verification_pending: "FeedX is checking this account automatically.",
    metrics_from_sync: "Supported metrics refresh automatically with posts.",
    meta_temporarily_unavailable: "Meta is temporarily unavailable. FeedX will retry automatically.",
    subscription_reconciling: "FeedX is confirming the Inbox update installation. No action is needed yet.",
    connection_check_unavailable: "FeedX could not complete the check. It will retry automatically.",
    bounded_history_gap: "Recent messages were checked within a limited window. Older or unavailable messages may be missing.",
    reconnect: "Reconnect this account to restore access.",
    required_scopes_missing: "Meta has not granted the required access.",
    page_tasks_unverified:
      "Your Page assignment could not be verified. Check the authorizing person’s Page access.",
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
  "FeedX could not verify this capability. Automatic checks will retry; account access may need review.";

export function socialAccountIssues(c) {
  const pending = new Set(["verification_pending", "inbound_pending", "subscriptions_missing", "meta_temporarily_unavailable", "subscription_reconciling", "connection_check_unavailable"]);
  if (pending.has(c.checks?.error_code)) return [];
  return Object.entries(socialCapabilities(c)).filter(([, value]) => ["permission_required", "action_required", "needs_attention"].includes(value.state) && !pending.has(value.reason));
}

export function socialNeedsReconnect(c) {
  return ["expired", "error", "disconnected"].includes(c.status) ||
    (c.expires_at && Date.parse(c.expires_at) <= Date.now()) ||
    (c.health?.credential_valid === false && !c.checks?.error_code);
}
